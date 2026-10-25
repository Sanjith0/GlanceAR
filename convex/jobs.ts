import { anyApi } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, type Doc, type QueryCtx } from "./server";
import { participants, purgeAudio, clearPresenceTickets, clearMessages, currentEventGrants, revokeEventConversations } from "./glance";
import { recapValidator } from "./schema";
import { MAX_RECORDING_MS, RAW_AUDIO_RETENTION_MS } from "../src/domain";

const jobArgs = { conversationId: v.id("conversations"), generation: v.number() };
async function ready(ctx: QueryCtx, c: Doc<"conversations"> | null, generation: number) {
  return !!c && c.status === "processing" && c.generation === generation &&
    !!c.audioStorageId && !!c.audioExpiresAt && c.audioExpiresAt > Date.now() &&
    participants(c).every((id) => c.recordingConsent.includes(id) && c.exchangeConsent.includes(id)) &&
    (c.consentMode !== "event" || c.connectedAt !== undefined) && await currentEventGrants(ctx, c);
}
export const claim = internalMutation({
  args: jobArgs,
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    if (!await ready(ctx, c, args.generation) || c!.claimedGeneration === args.generation) return null;
    await ctx.db.patch(c!._id, { claimedGeneration: args.generation });
    return {
      storageId: c!.audioStorageId!, startedAt: c!.startedAt!, endedAt: c!.endedAt!,
    };
  },
});
export const canProcess = internalQuery({
  args: jobArgs,
  handler: async (ctx, args) => ready(ctx, await ctx.db.get(args.conversationId), args.generation),
});
export const finish = internalMutation({
  args: { ...jobArgs, recap: v.optional(recapValidator), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.conversationId);
    // Cancellation, deletion, expiration, or a newer attempt makes this result inert.
    if (!await ready(ctx, c, args.generation) || c!.claimedGeneration !== args.generation) return false;
    await purgeAudio(ctx, c!);
    if (args.recap && !args.error) {
      await ctx.db.patch(c!._id, { status: "shared", recap: args.recap, error: undefined });
    } else {
      await ctx.db.patch(c!._id, { status: "failed", recap: undefined, error: args.error ?? "Processing failed." });
    }
    return true;
  },
});
export const deleteMessages = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => clearMessages(ctx, conversationId),
});
export const revokeEventSessions = internalMutation({
  args: { eventId: v.id("events"), profileId: v.id("profiles"), beforeRevision: v.number() },
  handler: async (ctx, { eventId, profileId, beforeRevision }) =>
    revokeEventConversations(ctx, eventId, profileId, beforeRevision),
});
export const expireRecording = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const c = await ctx.db.get(conversationId);
    if (!c || c.status !== "recording") return;
    const now = Date.now();
    const deadline = Math.min(c.leaseUntil ?? now, c.startedAt! + MAX_RECORDING_MS);
    if (deadline <= now) {
      await ctx.db.patch(c._id, { status: "ended", endedAt: deadline, leaseUntil: undefined });
      await clearPresenceTickets(ctx, c._id);
    } else {
      await ctx.scheduler.runAfter(deadline - now, anyApi.jobs.expireRecording, { conversationId });
    }
  },
});
export const expireConsent = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const c = await ctx.db.get(conversationId);
    if (c?.status === "consent") {
      await clearPresenceTickets(ctx, c._id);
      await ctx.db.patch(c._id, {
        status: "cancelled", endedAt: Date.now(), exchangeConsent: [],
        error: "Pairing timed out before recording started.",
      });
    }
  },
});
export const expireAudio = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const c = await ctx.db.get(conversationId);
    if (!c || !c.audioStorageId || !c.audioExpiresAt || c.audioExpiresAt > Date.now()) return;
    await purgeAudio(ctx, c);
    if (c.status !== "shared" && c.status !== "cancelled") {
      await ctx.db.patch(c._id, { status: "failed", generation: c.generation + 1, error: "Temporary audio expired before processing completed." });
    }
  },
});
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tickets = await ctx.db.query("presenceTickets")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now())).take(100);
    for (const ticket of tickets) await ctx.db.delete(ticket._id);
    if (tickets.length === 100) await ctx.scheduler.runAfter(0, anyApi.jobs.sweep, {});
    // Uploaded but unattached objects are swept too. No storage download URLs are public.
    const files = await ctx.db.system.query("_storage")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", Date.now() - RAW_AUDIO_RETENTION_MS))
      .take(100);
    for (const file of files) {
      const c = await ctx.db.query("conversations").withIndex("by_audio", (q) => q.eq("audioStorageId", file._id)).unique();
      if (c) {
        await purgeAudio(ctx, c);
        if (c.status !== "cancelled" && c.status !== "shared") {
          await ctx.db.patch(c._id, { status: "failed", generation: c.generation + 1, error: "Temporary audio expired." });
        }
      } else {
        await ctx.storage.delete(file._id);
      }
    }
    if (files.length === 100) await ctx.scheduler.runAfter(0, anyApi.jobs.sweep, {});
    // A missed per-session timer is not allowed to leave an indefinite server recording.
    const active = await ctx.db.query("conversations").withIndex("by_status", (q) => q.eq("status", "recording")).take(100);
    for (const c of active) {
      if (!c.leaseUntil || c.leaseUntil <= Date.now()) {
        await ctx.db.patch(c._id, { status: "ended", endedAt: c.leaseUntil ?? Date.now(), leaseUntil: undefined });
        await clearPresenceTickets(ctx, c._id);
      }
    }
  },
});

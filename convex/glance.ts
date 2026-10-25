import { anyApi } from "convex/server";
import { v, ConvexError } from "convex/values";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { query, mutation, type QueryCtx, type MutationCtx, type Doc, type Id } from "./server";
import { MAX_RECORDING_MS, RAW_AUDIO_RETENTION_MS, RECORDING_FRESHNESS_MS, EVENT_PERMISSION_POLICY_VERSION } from "../src/domain";
import type { Profile, Event, Conversation, Snapshot } from "../src/domain";

const authArgs = { token: v.string() };
const sessionArgs = { ...authArgs, conversationId: v.id("conversations") };
const profileArgs = { name: v.string(), role: v.string(), photoUrl: v.string() };
const fail = (message: string): never => { throw new ConvexError(message); };
export const participants = (c: Doc<"conversations">) => [c.participantA, c.participantB];
const complete = (ids: Id<"profiles">[], c: Doc<"conversations">) =>
  participants(c).every((id) => ids.includes(id));

function tokenHash(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Invalid device credential.");
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}
export async function authenticate(ctx: QueryCtx, token: string) {
  const me = await ctx.db.query("profiles").withIndex("by_token", (q) =>
    q.eq("tokenHash", tokenHash(token))).unique();
  return me ?? fail("This device is not registered.");
}
async function session(ctx: QueryCtx, token: string, id: Id<"conversations">) {
  const me = await authenticate(ctx, token);
  const c = await ctx.db.get(id);
  if (!c || !participants(c).includes(me._id)) fail("Conversation unavailable.");
  return { me, c: c! };
}
async function member(ctx: QueryCtx, eventId: Id<"events">, profileId: Id<"profiles">) {
  const row = await ctx.db.query("memberships").withIndex("by_pair", (q) =>
    q.eq("eventId", eventId).eq("profileId", profileId)).unique();
  if (!row) fail("Event unavailable.");
  return row!;
}
function enabled(membership: Doc<"memberships">) {
  return membership.eventPermission?.enabled === true &&
    membership.eventPermission.policyVersion === EVENT_PERMISSION_POLICY_VERSION;
}
export async function currentEventGrants(ctx: QueryCtx, c: Doc<"conversations">): Promise<boolean> {
  if (c.consentMode !== "event") return true;
  const rows = await Promise.all(participants(c).map((id) =>
    ctx.db.query("memberships").withIndex("by_pair", (q) => q.eq("eventId", c.eventId).eq("profileId", id)).unique()));
  return rows.every((row, i) => !!row && enabled(row) &&
    row.eventPermission!.revision === (i === 0 ? c.eventGrantA : c.eventGrantB));
}
function validateProfile(input: { name: string; role: string; photoUrl: string }) {
  if (!input.name.trim() || input.name.length > 80 || input.role.length > 120) {
    fail("Use a name up to 80 characters and role up to 120 characters.");
  }
  if (input.photoUrl.length > 350_000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.photoUrl)) {
    fail("A JPEG, PNG, or WebP selfie under 350 KB encoded is required.");
  }
  // A file signature check rejects non-image payloads masquerading as images.
  const [header, body] = input.photoUrl.split(",");
  const valid = header.includes("jpeg") ? body.startsWith("/9j/") :
    header.includes("png") ? body.startsWith("iVBORw0KGgo") :
      body.startsWith("UklGR") && atob(body.slice(0, 20)).slice(8, 12) === "WEBP";
  if (!valid) fail("The selfie image format does not match its data.");
  return { name: input.name.trim(), role: input.role.trim(), photoUrl: input.photoUrl };
}
function profile(p: Doc<"profiles">, glanceEnabled?: boolean): Profile {
  return {
    id: p._id, name: p.name, role: p.role, photoUrl: p.photoUrl,
    ...(glanceEnabled !== undefined ? { glanceEnabled } : {}),
  };
}
function event(e: Doc<"events">): Event {
  return { id: e._id, title: e.title, location: e.location, inviteCode: e.inviteCode, hostId: e.hostId };
}
async function viewConversation(ctx: QueryCtx, c: Doc<"conversations">): Promise<Conversation> {
  const people = await Promise.all(participants(c).map((id) => ctx.db.get(id)));
  const validGrants = await currentEventGrants(ctx, c);
  // Membership revision is the immediate fence; larger revocation cleanups are
  // chunked. Never present a queued-for-cleanup session as still connected/live.
  if (c.consentMode === "event" && !validGrants && c.status !== "shared") {
    c = {
      ...c, status: "cancelled", exchangeConsent: [], connectedAt: undefined,
      finishMethod: undefined, leaseUntil: undefined, recap: undefined,
      error: c.error ?? "An event recording permission was revoked. This unfinished session was cancelled.",
    };
  }
  const chatAllowed = c.status !== "cancelled" &&
    (c.status === "shared" || (c.connectedAt !== undefined && validGrants));
  const messages = chatAllowed ? await ctx.db.query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", c._id)).order("desc").take(50) : [];
  return {
    id: c._id, eventId: c.eventId, participants: people.filter((p) => p !== null).map((p) => profile(p)),
    recorderId: c.recorderId, status: c.status, recordingConsent: c.recordingConsent,
    exchangeConsent: c.exchangeConsent,
    ...(c.startedAt !== undefined ? { startedAt: c.startedAt } : {}),
    ...(c.endedAt !== undefined ? { endedAt: c.endedAt } : {}),
    ...(c.leaseUntil !== undefined ? { leaseUntil: c.leaseUntil } : {}),
    ...(c.status === "shared" && c.recap && complete(c.exchangeConsent, c) ? { recap: c.recap } : {}),
    ...(c.error ? { error: c.error } : {}),
    consentMode: c.consentMode ?? "conversation",
    ...(c.captureSource ? { captureSource: c.captureSource } : {}),
    ...(c.connectedAt !== undefined ? { connectedAt: c.connectedAt } : {}),
    ...(c.finishMethod ? { finishMethod: c.finishMethod } : {}),
    readyToRecord: c.status === "consent" && validGrants && complete(c.recordingConsent, c) &&
      participants(c).every((id) => (c.lastSeen[id] ?? 0) + RECORDING_FRESHNESS_MS > Date.now()),
    ...(chatAllowed ? { messages: messages.reverse().map((message) => ({
      id: message._id, conversationId: message.conversationId, senderId: message.senderId,
      text: message.text, createdAt: message.createdAt,
    })) } : {}),
  };
}
export async function purgeAudio(ctx: MutationCtx, c: Doc<"conversations">) {
  if (c.audioStorageId) await ctx.storage.delete(c.audioStorageId);
  await ctx.db.patch(c._id, {
    audioStorageId: undefined, audioMimeType: undefined,
    audioExpiresAt: undefined, uploadGrantedUntil: undefined,
  });
}
export async function clearPresenceTickets(ctx: MutationCtx, conversationId: Id<"conversations">) {
  const tickets = await ctx.db.query("presenceTickets")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(3);
  for (const ticket of tickets) await ctx.db.delete(ticket._id);
}
export async function clearMessages(ctx: MutationCtx, conversationId: Id<"conversations">) {
  const messages = await ctx.db.query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(100);
  for (const message of messages) await ctx.db.delete(message._id);
  if (messages.length === 100) await ctx.scheduler.runAfter(0, anyApi.jobs.deleteMessages, { conversationId });
}
export async function cancelEventConversation(ctx: MutationCtx, c: Doc<"conversations">) {
  await purgeAudio(ctx, c);
  await clearPresenceTickets(ctx, c._id);
  await clearMessages(ctx, c._id);
  await ctx.db.patch(c._id, {
    status: "cancelled", recap: undefined, leaseUntil: undefined, exchangeConsent: [],
    connectedAt: undefined, finishMethod: undefined, finishEligibleUntil: undefined,
    error: "An event recording permission was revoked. This unfinished session was cancelled.",
    generation: c.generation + 1, endedAt: c.endedAt ?? Date.now(),
  });
}
export async function revokeEventConversations(
  ctx: MutationCtx, eventId: Id<"events">, profileId: Id<"profiles">, beforeRevision: number,
) {
  let count = 0;
  for (const status of ["consent", "recording", "processing", "ended", "failed"] as const) {
    for (const side of ["a", "b"] as const) {
      const rows = side === "a"
        ? await ctx.db.query("conversations").withIndex("by_event_a_mode_status", (q) =>
          q.eq("eventId", eventId).eq("participantA", profileId).eq("consentMode", "event").eq("status", status))
          .filter((q) => q.lt(q.field("eventGrantA"), beforeRevision)).take(20 - count)
        : await ctx.db.query("conversations").withIndex("by_event_b_mode_status", (q) =>
          q.eq("eventId", eventId).eq("participantB", profileId).eq("consentMode", "event").eq("status", status))
          .filter((q) => q.lt(q.field("eventGrantB"), beforeRevision)).take(20 - count);
      for (const c of rows) {
        await cancelEventConversation(ctx, c);
        count++;
      }
      if (count >= 20) {
        await ctx.scheduler.runAfter(0, anyApi.jobs.revokeEventSessions, { eventId, profileId, beforeRevision });
        return;
      }
    }
  }
}
async function enqueue(ctx: MutationCtx, c: Doc<"conversations">) {
  if (!["ended", "failed"].includes(c.status) || !c.audioStorageId ||
    !complete(c.recordingConsent, c) || !complete(c.exchangeConsent, c)) return;
  if (c.consentMode === "event" && (!c.connectedAt || !await currentEventGrants(ctx, c))) {
    await cancelEventConversation(ctx, c);
    return;
  }
  if (!c.audioExpiresAt || c.audioExpiresAt <= Date.now()) {
    await purgeAudio(ctx, c);
    await ctx.db.patch(c._id, { status: "failed", error: "The temporary audio expired. Start a new conversation." });
    return;
  }
  const generation = c.generation + 1;
  await ctx.db.patch(c._id, {
    status: "processing", generation, claimedGeneration: undefined, error: undefined,
  });
  await ctx.scheduler.runAfter(0, anyApi.pipeline.process, { conversationId: c._id, generation });
}

export const register = mutation({
  args: { ...authArgs, ...profileArgs },
  handler: async (ctx, args) => {
    const hash = tokenHash(args.token);
    const existing = await ctx.db.query("profiles").withIndex("by_token", (q) => q.eq("tokenHash", hash)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("profiles", { tokenHash: hash, ...validateProfile(args) });
  },
});
export const updateProfile = mutation({
  args: { ...authArgs, ...profileArgs },
  handler: async (ctx, args) => {
    const me = await authenticate(ctx, args.token);
    await ctx.db.patch(me._id, validateProfile(args));
  },
});
export const snapshot = query({
  args: { ...authArgs, eventId: v.optional(v.id("events")) },
  handler: async (ctx, args): Promise<Snapshot> => {
    const me = await authenticate(ctx, args.token);
    const memberships = await ctx.db.query("memberships").withIndex("by_profile", (q) => q.eq("profileId", me._id)).take(100);
    const events = (await Promise.all(memberships.map((m) => ctx.db.get(m.eventId)))).filter((e) => e !== null);
    const selected = args.eventId ? events.find((e) => e._id === args.eventId) : undefined;
    if (args.eventId && !selected) fail("Event unavailable.");
    const members = selected ? await ctx.db.query("memberships").withIndex("by_event", (q) => q.eq("eventId", selected._id)).take(24) : [];
    const [asA, asB, activeRecording, activeConsent] = await Promise.all([
      ctx.db.query("conversations").withIndex("by_a", (q) => q.eq("participantA", me._id)).order("desc").take(100),
      ctx.db.query("conversations").withIndex("by_b", (q) => q.eq("participantB", me._id)).order("desc").take(100),
      ctx.db.query("conversations").withIndex("by_recorder_status", (q) => q.eq("recorderId", me._id).eq("status", "recording")).first(),
      ctx.db.query("conversations").withIndex("by_recorder_status", (q) => q.eq("recorderId", me._id).eq("status", "consent")).first(),
    ]);
    const active = activeRecording ?? activeConsent;
    const activeRecorderConversationId = active && await currentEventGrants(ctx, active) ? active._id : undefined;
    return {
      me: profile(me, selected ? enabled(memberships.find((m) => m.eventId === selected._id)!) : undefined),
      events: events.map(event), ...(selected ? { event: event(selected) } : {}),
      ...(activeRecorderConversationId ? { activeRecorderConversationId } : {}),
      ...(selected ? { eventPermission: {
        enabled: enabled(memberships.find((m) => m.eventId === selected._id)!),
        policyVersion: EVENT_PERMISSION_POLICY_VERSION,
        ...(memberships.find((m) => m.eventId === selected._id)!.eventPermission?.grantedAt !== undefined
          ? { grantedAt: memberships.find((m) => m.eventId === selected._id)!.eventPermission!.grantedAt } : {}),
      } } : {}),
      members: (await Promise.all(members.map(async (m) => {
        const p = await ctx.db.get(m.profileId);
        return p ? profile(p, enabled(m)) : null;
      }))).filter((p) => p !== null),
      conversations: await Promise.all([...asA, ...asB]
        .filter((c) => !args.eventId || c.eventId === args.eventId)
        .sort((a, b) => b._creationTime - a._creationTime).slice(0, 10).map((c) => viewConversation(ctx, c))),
    };
  },
});
export const setEventPermission = mutation({
  args: { ...authArgs, eventId: v.id("events"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const me = await authenticate(ctx, args.token);
    const membership = await member(ctx, args.eventId, me._id);
    if (membership.eventPermission?.enabled === args.enabled &&
      membership.eventPermission.policyVersion === EVENT_PERMISSION_POLICY_VERSION) return;
    const revision = (membership.eventPermission?.revision ?? 0) + 1;
    await ctx.db.patch(membership._id, { eventPermission: {
      enabled: args.enabled, policyVersion: EVENT_PERMISSION_POLICY_VERSION, revision,
      ...(args.enabled ? { grantedAt: Date.now() } :
        membership.eventPermission?.grantedAt !== undefined ? { grantedAt: membership.eventPermission.grantedAt } : {}),
    } });
    if (!args.enabled) await revokeEventConversations(ctx, args.eventId, me._id, revision);
  },
});
export const createEvent = mutation({
  args: { ...authArgs, title: v.string(), location: v.string() },
  handler: async (ctx, args) => {
    const me = await authenticate(ctx, args.token);
    if (!args.title.trim() || args.title.length > 100 || args.location.length > 160) fail("Enter a short event title and location.");
    const count = await ctx.db.query("memberships").withIndex("by_profile", (q) => q.eq("profileId", me._id)).take(100);
    if (count.length >= 100) fail("Event limit reached.");
    // Convex seeds Math.random per transaction, making retry behavior deterministic.
    let inviteCode = "";
    do { inviteCode = Array.from({ length: 10 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""); }
    while (await ctx.db.query("events").withIndex("by_invite", (q) => q.eq("inviteCode", inviteCode)).unique());
    const eventId = await ctx.db.insert("events", { title: args.title.trim(), location: args.location.trim(), inviteCode, hostId: me._id });
    await ctx.db.insert("memberships", { eventId, profileId: me._id });
    return eventId;
  },
});
export const joinEvent = mutation({
  args: { ...authArgs, inviteCode: v.string() },
  handler: async (ctx, args) => {
    const me = await authenticate(ctx, args.token);
    const e = await ctx.db.query("events").withIndex("by_invite", (q) => q.eq("inviteCode", args.inviteCode.trim().toUpperCase())).unique();
    if (!e) fail("Invite code not found.");
    const old = await ctx.db.query("memberships").withIndex("by_pair", (q) => q.eq("eventId", e!._id).eq("profileId", me._id)).unique();
    if (!old) {
      const [members, own] = await Promise.all([
        ctx.db.query("memberships").withIndex("by_event", (q) => q.eq("eventId", e!._id)).take(24),
        ctx.db.query("memberships").withIndex("by_profile", (q) => q.eq("profileId", me._id)).take(100),
      ]);
      if (members.length >= 24 || own.length >= 100) fail("Event membership limit reached.");
      await ctx.db.insert("memberships", { eventId: e!._id, profileId: me._id });
    }
    return e!._id;
  },
});
export const createConversation = mutation({
  args: {
    ...authArgs, eventId: v.id("events"), partnerId: v.id("profiles"),
    mode: v.optional(v.literal("event")),
    source: v.optional(v.union(v.literal("phone"), v.literal("glasses"))),
  },
  handler: async (ctx, args) => {
    const me = await authenticate(ctx, args.token);
    if (me._id === args.partnerId) fail("Choose another attendee.");
    const own = await member(ctx, args.eventId, me._id);
    const other = await member(ctx, args.eventId, args.partnerId);
    if (args.mode === "event" && (!enabled(own) || !enabled(other))) {
      fail("Both attendees must opt in to event recording and gesture sharing.");
    }
    for (const id of [me._id, args.partnerId]) {
      const all = [
        ...await ctx.db.query("conversations").withIndex("by_a", (q) => q.eq("participantA", id)).order("desc").take(100),
        ...await ctx.db.query("conversations").withIndex("by_b", (q) => q.eq("participantB", id)).order("desc").take(100),
      ];
      if (all.some((c) => c.status === "recording" || c.status === "consent")) fail("An attendee already has an active pairing.");
    }
    const conversationId = await ctx.db.insert("conversations", {
      eventId: args.eventId, participantA: me._id, participantB: args.partnerId, recorderId: me._id,
      status: "consent", recordingConsent: args.mode === "event" ? [me._id, args.partnerId] : [],
      exchangeConsent: [], lastSeen: {}, ticketIssuedAt: {}, generation: 0,
      consentMode: args.mode ?? "conversation",
      ...(args.source || args.mode === "event" ? { captureSource: args.source ?? "phone" } : {}),
      ...(args.mode === "event" ? { eventGrantA: own.eventPermission!.revision, eventGrantB: other.eventPermission!.revision } : {}),
    });
    await ctx.scheduler.runAfter(120_000, anyApi.jobs.expireConsent, { conversationId });
    return conversationId;
  },
});
export const consentRecording = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (c.status !== "consent") fail("Recording consent is closed.");
    if (!await currentEventGrants(ctx, c)) fail("Event recording permission is no longer valid.");
    await ctx.db.patch(c._id, {
      recordingConsent: [...new Set([...c.recordingConsent, me._id])],
    });
  },
});
export const startRecording = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (me._id !== c.recorderId) fail("Only the designated recorder can start.");
    if (c.status !== "consent" || !complete(c.recordingConsent, c)) fail("Both people must consent before recording.");
    if (!await currentEventGrants(ctx, c)) fail("Event recording permission is no longer valid.");
    const now = Date.now();
    const leaseUntil = Math.min(...participants(c).map((id) => c.lastSeen[id] ?? 0)) + RECORDING_FRESHNESS_MS;
    if (leaseUntil <= now) throw new ConvexError({ code: "NOT_READY", message: "Both phones must be online to start." });
    await ctx.db.patch(c._id, { status: "recording", startedAt: now, leaseUntil });
    await ctx.scheduler.runAfter(RECORDING_FRESHNESS_MS, anyApi.jobs.expireRecording, { conversationId: c._id });
    return { leaseUntil, serverNow: now };
  },
});
export const presenceTicket = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    const now = Date.now();
    if (!["consent", "recording"].includes(c.status) || !c.recordingConsent.includes(me._id)) return null;
    if (!await currentEventGrants(ctx, c)) return null;
    if (c.status === "recording" &&
      (!c.leaseUntil || c.leaseUntil <= now || now >= c.startedAt! + MAX_RECORDING_MS)) {
      await ctx.db.patch(c._id, { status: "ended", endedAt: Math.min(now, c.leaseUntil ?? now), leaseUntil: undefined });
      await clearPresenceTickets(ctx, c._id);
      return null;
    }
    // A native Convex document ID is an opaque server-created handle, not authority
    // by itself. Every acknowledgement also requires the bound profile credential.
    const old = await ctx.db.query("presenceTickets").withIndex("by_pair", (q) =>
      q.eq("conversationId", c._id).eq("profileId", me._id)).unique();
    if (old && old.expiresAt > now) {
      return { ticketId: old._id, issuedAt: old.issuedAt, expiresAt: old.expiresAt };
    }
    if (old) await ctx.db.delete(old._id);
    // At most one outstanding ticket/person and two new tickets/second/person.
    // There is no per-ticket scheduled job; terminal-state cleanup plus a sweep
    // bounds storage even if a client abandons its challenge.
    if (now - (c.ticketIssuedAt?.[me._id] ?? 0) < 500) return null;
    const expiresAt = now + RECORDING_FRESHNESS_MS;
    const ticketId = await ctx.db.insert("presenceTickets", {
      conversationId: c._id, profileId: me._id, issuedAt: now, expiresAt,
    });
    await ctx.db.patch(c._id, { ticketIssuedAt: { ...c.ticketIssuedAt, [me._id]: now } });
    return { ticketId, issuedAt: now, expiresAt };
  },
});
export const heartbeat = mutation({
  args: { ...sessionArgs, ticketId: v.id("presenceTickets") },
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    const now = Date.now();
    if (!await currentEventGrants(ctx, c)) return null;
    // Check the previous lease before handling any delayed acknowledgement.
    if (c.status === "recording" &&
      (!c.leaseUntil || c.leaseUntil <= now || now >= c.startedAt! + MAX_RECORDING_MS)) {
      await ctx.db.patch(c._id, { status: "ended", endedAt: Math.min(now, c.leaseUntil ?? now), leaseUntil: undefined });
      await clearPresenceTickets(ctx, c._id);
      return null;
    }
    if (!["consent", "recording"].includes(c.status) || !c.recordingConsent.includes(me._id)) return null;
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || ticket.profileId !== me._id || ticket.conversationId !== c._id) {
      fail("Presence ticket unavailable or already used.");
    }
    await ctx.db.delete(ticket!._id);
    if (ticket!.expiresAt <= now || ticket!.issuedAt > now ||
      ticket!.expiresAt !== ticket!.issuedAt + RECORDING_FRESHNESS_MS) return null;
    // Crucial: acknowledgement receipt time NEVER creates fresh consent.
    const lastSeen = { ...c.lastSeen, [me._id]: Math.max(c.lastSeen[me._id] ?? 0, ticket!.issuedAt) };
    if (c.status === "consent") {
      await ctx.db.patch(c._id, { lastSeen });
      return null;
    }
    const leaseUntil = Math.min(
      ...participants(c).map((id) => lastSeen[id] + RECORDING_FRESHNESS_MS),
      c.startedAt! + MAX_RECORDING_MS,
    );
    await ctx.db.patch(c._id, { lastSeen, leaseUntil });
    return { leaseUntil, serverNow: now };
  },
});
export const stop = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { c } = await session(ctx, args.token, args.conversationId);
    const now = Date.now();
    if (c.consentMode === "event" && c.status !== "shared" && c.status !== "cancelled" &&
      !await currentEventGrants(ctx, c)) {
      await cancelEventConversation(ctx, c);
      return { status: "cancelled" as const, connectedAt: null };
    }
    if (c.consentMode === "event" && c.status === "consent") {
      await ctx.db.patch(c._id, {
        status: "cancelled", endedAt: now, exchangeConsent: [], finishEligibleUntil: undefined,
        generation: c.generation + 1,
      });
      await clearPresenceTickets(ctx, c._id);
      return { status: "cancelled" as const, connectedAt: null };
    }
    if (c.status === "recording") {
      await ctx.db.patch(c._id, {
        status: "ended", endedAt: Math.min(now, c.leaseUntil ?? now),
        leaseUntil: undefined, finishEligibleUntil: undefined,
      });
      await clearPresenceTickets(ctx, c._id);
      return { status: "ended" as const, connectedAt: c.connectedAt ?? null };
    }
    // Linearizable reconciliation: if finish won first, preserve its connection.
    // If stop won first, finish now rejects ended status permanently.
    return { status: c.status, connectedAt: c.connectedAt ?? null };
  },
});
export const finishConnection = mutation({
  args: { ...sessionArgs, method: v.union(v.literal("gesture"), v.literal("button")) },
  handler: async (ctx, args) => {
    const { c } = await session(ctx, args.token, args.conversationId);
    if (c.consentMode !== "event") fail("This session uses per-conversation sharing consent.");
    if (c.status === "cancelled") fail("This session was cancelled.");
    if (c.connectedAt !== undefined && c.status === "shared") return;
    if (!await currentEventGrants(ctx, c)) fail("Both current event permissions are required to connect.");
    if (c.connectedAt !== undefined) return;
    const now = Date.now();
    const deadline = c.status === "recording" ? c.leaseUntil : undefined;
    const freshUntil = Math.min(...participants(c).map((id) => (c.lastSeen[id] ?? 0) + RECORDING_FRESHNESS_MS));
    if (!c.startedAt || !deadline || deadline <= now || freshUntil <= now ||
      now >= c.startedAt + MAX_RECORDING_MS || !complete(c.recordingConsent, c)) {
      fail("The live recording window ended. Start another conversation to connect.");
    }
    const next = {
      ...c, status: "ended" as const, endedAt: c.endedAt ?? now, connectedAt: now,
      finishMethod: args.method, exchangeConsent: participants(c), leaseUntil: undefined, finishEligibleUntil: undefined,
    };
    await ctx.db.patch(c._id, {
      status: next.status, endedAt: next.endedAt, connectedAt: now, finishMethod: args.method,
      exchangeConsent: next.exchangeConsent, leaseUntil: undefined, finishEligibleUntil: undefined,
    });
    await clearPresenceTickets(ctx, c._id);
    await enqueue(ctx, next);
  },
});
export const sendMessage = mutation({
  args: { ...sessionArgs, text: v.string() },
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    const text = args.text.trim();
    if (!text || text.length > 2000 || new TextEncoder().encode(text).byteLength > 8000) {
      fail("Messages must contain 1 to 2,000 characters.");
    }
    if (c.status === "cancelled" || (c.status !== "shared" &&
      (c.connectedAt === undefined || !await currentEventGrants(ctx, c)))) fail("This shared chat is unavailable.");
    return ctx.db.insert("messages", { conversationId: c._id, senderId: me._id, text, createdAt: Date.now() });
  },
});
export const abandonAudio = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (me._id !== c.recorderId || c.consentMode !== "event" || c.connectedAt === undefined) {
      fail("Only the recorder can discard this connected recording.");
    }
    // A delayed discard must never erase an upload/processing result that won the race.
    if (c.status !== "ended" || c.audioStorageId || c.recap) return;
    await ctx.db.patch(c._id, {
      status: "failed", error: "The local recording was discarded. Your connection and chat remain available.",
      uploadGrantedUntil: undefined, audioAbandoned: true, generation: c.generation + 1,
    });
  },
});
export const confirmExchange = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (c.consentMode === "event") fail("Finish an event connection with a gesture or finish button.");
    if (!["ended", "failed", "processing", "shared"].includes(c.status)) fail("End recording before sharing.");
    if (!complete(c.recordingConsent, c) || !c.startedAt) fail("No consented recording exists.");
    if (c.exchangeConsent.includes(me._id)) return;
    const exchangeConsent = [...c.exchangeConsent, me._id];
    await ctx.db.patch(c._id, { exchangeConsent });
    await enqueue(ctx, { ...c, exchangeConsent });
  },
});
export const createUploadUrl = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (me._id !== c.recorderId || !["ended", "failed"].includes(c.status) ||
      !complete(c.recordingConsent, c) || !c.startedAt) fail("Only the recorder can upload an ended recording.");
    if (c.audioAbandoned) fail("This recording was discarded. Your connection and chat remain available.");
    if (c.consentMode === "event" && (c.connectedAt === undefined || !await currentEventGrants(ctx, c))) {
      fail("An authorized event connection is required before uploading.");
    }
    await ctx.db.patch(c._id, { uploadGrantedUntil: Date.now() + RAW_AUDIO_RETENTION_MS });
    return ctx.storage.generateUploadUrl();
  },
});
export const attachAudio = mutation({
  args: { ...sessionArgs, storageId: v.id("_storage"), mimeType: v.string() },
  handler: async (ctx, args) => {
    const { me, c } = await session(ctx, args.token, args.conversationId);
    if (me._id !== c.recorderId) fail("Only the recorder can attach audio.");
    if (c.audioAbandoned || (c.consentMode === "event" &&
      (c.connectedAt === undefined || !await currentEventGrants(ctx, c)))) fail("This event upload is no longer authorized.");
    if (c.audioStorageId === args.storageId) return;
    if (!["ended", "failed"].includes(c.status) || !c.uploadGrantedUntil ||
      c.uploadGrantedUntil <= Date.now() || c.audioStorageId) fail("This upload is not authorized.");
    if (!["audio/wav", "audio/x-wav", "audio/wave"].includes(args.mimeType)) fail("Upload mono 16-bit PCM WAV audio.");
    const file = await ctx.db.system.get(args.storageId);
    if (!file || file.size > 30_000_000 || file.size < 44) fail("Audio must be a nonempty WAV under 30 MB.");
    if (file!._creationTime < c.endedAt! - 1_000) fail("Upload a new file for this conversation.");
    const used = await ctx.db.query("conversations").withIndex("by_audio", (q) => q.eq("audioStorageId", args.storageId)).unique();
    if (used) fail("That audio is already attached.");
    const next = { ...c, audioStorageId: args.storageId, audioMimeType: args.mimeType, audioExpiresAt: Date.now() + RAW_AUDIO_RETENTION_MS };
    await ctx.db.patch(c._id, {
      audioStorageId: next.audioStorageId, audioMimeType: next.audioMimeType,
      audioExpiresAt: next.audioExpiresAt, uploadGrantedUntil: undefined, error: undefined,
    });
    await ctx.scheduler.runAfter(RAW_AUDIO_RETENTION_MS, anyApi.jobs.expireAudio, { conversationId: c._id });
    await enqueue(ctx, next);
  },
});
export const retryProcessing = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { c } = await session(ctx, args.token, args.conversationId);
    if (c.status === "processing" || c.status === "shared") return;
    if (c.status !== "failed") fail("Only failed processing can be retried.");
    if (!c.audioStorageId) fail("Audio has been purged. Re-upload the original recording or start a new conversation.");
    await enqueue(ctx, c);
  },
});
export const cancel = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { c } = await session(ctx, args.token, args.conversationId);
    await purgeAudio(ctx, c);
    await clearPresenceTickets(ctx, c._id);
    await clearMessages(ctx, c._id);
    await ctx.db.patch(c._id, {
      status: "cancelled", recap: undefined, error: undefined, leaseUntil: undefined,
      exchangeConsent: [], generation: c.generation + 1, endedAt: c.endedAt ?? Date.now(),
      connectedAt: undefined, finishMethod: undefined, finishEligibleUntil: undefined,
    });
  },
});
export const deleteConversation = mutation({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const { c } = await session(ctx, args.token, args.conversationId);
    await purgeAudio(ctx, c);
    await clearPresenceTickets(ctx, c._id);
    await clearMessages(ctx, c._id);
    await ctx.db.delete(c._id);
  },
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { EVENT_PERMISSION_POLICY_VERSION } from "../src/domain";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
};
const api = anyApi.glance;
const jobs = anyApi.jobs;
const tokens = ["a", "b", "c"].map((c) => c.repeat(64));
const photoUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cXuoAAAAASUVORK5CYII=";
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type Test = ReturnType<typeof makeTest>;
const recap = { summary: "They discussed design.", topics: ["Design"], nextSteps: [], source: "ai" as const };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function wav() {
  const buffer = new ArrayBuffer(32_044);
  const view = new DataView(buffer);
  const write = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, 32_000, true);
  return buffer;
}
async function setup(t: Test) {
  const [a, b, outsider] = await Promise.all(tokens.map((token, i) =>
    t.mutation(api.register, { token, name: `Person ${i}`, role: "Builder", photoUrl })));
  const eventId = await t.mutation(api.createEvent, { token: tokens[0], title: "Opt-in event", location: "Austin" });
  const initial = await t.query(api.snapshot, { token: tokens[0], eventId });
  await t.mutation(api.joinEvent, { token: tokens[1], inviteCode: initial.event.inviteCode });
  return { a, b, outsider, eventId };
}
async function granted(t: Test) {
  const s = await setup(t);
  for (const token of tokens.slice(0, 2)) await t.mutation(api.setEventPermission, { token, eventId: s.eventId, enabled: true });
  const conversationId = await t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b, mode: "event" });
  return { ...s, conversationId };
}
async function present(t: Test, conversationId: string) {
  for (const token of tokens.slice(0, 2)) {
    const ticket = await t.mutation(api.presenceTicket, { token, conversationId });
    await t.mutation(api.heartbeat, { token, conversationId, ticketId: ticket.ticketId });
  }
}
async function recording(t: Test) {
  const s = await granted(t);
  await present(t, s.conversationId);
  const lease = await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
  vi.setSystemTime(lease.serverNow + 1000);
  return { ...s, lease };
}
async function connected(t: Test) {
  const s = await recording(t);
  await t.mutation(api.finishConnection, { token: tokens[0], conversationId: s.conversationId, method: "gesture" });
  return s;
}
async function processing(t: Test) {
  const s = await connected(t);
  await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([wav()], { type: "audio/wav" })));
  await t.mutation(api.attachAudio, { token: tokens[0], conversationId: s.conversationId, storageId, mimeType: "audio/wav" });
  return { ...s, storageId };
}
async function conversation(t: Test, token = tokens[0]) {
  return (await t.query(api.snapshot, { token })).conversations[0];
}

describe("event-scoped informed permission", () => {
  it("defaults off, authenticates the grantor, and only exposes selected-event flags", async () => {
    const t = makeTest(); const s = await setup(t);
    const initial = await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId });
    expect(initial.eventPermission).toEqual({ enabled: false, policyVersion: EVENT_PERMISSION_POLICY_VERSION });
    expect(initial.members.every((m: { glanceEnabled: boolean }) => !m.glanceEnabled)).toBe(true);
    await expect(t.mutation(api.setEventPermission, { token: tokens[2], eventId: s.eventId, enabled: true })).rejects.toThrow("unavailable");
    await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: true });
    const own = await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId });
    const other = await t.query(api.snapshot, { token: tokens[1], eventId: s.eventId });
    expect(own.eventPermission.enabled).toBe(true);
    expect(own.eventPermission.grantedAt).toBeTypeOf("number");
    expect(other.eventPermission.enabled).toBe(false);
    expect(other.members.find((m: { id: string }) => m.id === s.a).glanceEnabled).toBe(true);
    const global = await t.query(api.snapshot, { token: tokens[0] });
    expect(global.eventPermission).toBeUndefined();
    expect(global.me.glanceEnabled).toBeUndefined();
    const otherEvent = await t.mutation(api.createEvent, { token: tokens[0], title: "Separate event", location: "" });
    expect((await t.query(api.snapshot, { token: tokens[0], eventId: otherEvent })).eventPermission.enabled).toBe(false);
  });
  it("requires two same-event grants and does not turn standing opt-in into implicit legacy consent", async () => {
    const t = makeTest(); const s = await setup(t);
    await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: true });
    await expect(t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b, mode: "event" })).rejects.toThrow("Both attendees");
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: true });
    const legacy = await t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b });
    const c = await conversation(t);
    expect(c.consentMode).toBe("conversation");
    expect(c.captureSource).toBeUndefined();
    expect(c.recordingConsent).toEqual([]);
    await expect(t.mutation(api.finishConnection, { token: tokens[0], conversationId: legacy, method: "gesture" })).rejects.toThrow("per-conversation");
    await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: false });
    expect((await conversation(t)).status).toBe("consent");
  });
  it("defaults event capture to phone and preserves an explicit glasses binding throughout the session", async () => {
    const t = makeTest(); const s = await granted(t);
    expect((await conversation(t)).captureSource).toBe("phone");
    await t.mutation(api.cancel, { token: tokens[0], conversationId: s.conversationId });
    const glassesId = await t.mutation(api.createConversation, {
      token: tokens[0], eventId: s.eventId, partnerId: s.b, mode: "event", source: "glasses",
    });
    await t.mutation(api.updateProfile, { token: tokens[0], name: "Updated profile", role: "Builder", photoUrl });
    await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: true });
    await present(t, glassesId);
    await t.mutation(api.startRecording, { token: tokens[0], conversationId: glassesId });
    await t.mutation(api.finishConnection, { token: tokens[0], conversationId: glassesId, method: "gesture" });
    expect((await conversation(t)).captureSource).toBe("glasses");
    expect((await conversation(t, tokens[1])).captureSource).toBe("glasses");
  });
  it("reports the global recorder-owned active ID across event filters and outside recent history", async () => {
    const t = makeTest(); const s = await granted(t);
    const otherEvent = await t.mutation(api.createEvent, { token: tokens[0], title: "Selected elsewhere", location: "" });
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) await ctx.db.insert("conversations", {
        eventId: s.eventId, participantA: s.a, participantB: s.b, recorderId: s.a,
        status: "ended", recordingConsent: [], exchangeConsent: [], lastSeen: {}, generation: 0,
      });
    });
    const selected = await t.query(api.snapshot, { token: tokens[0], eventId: otherEvent });
    expect(selected.conversations).toEqual([]);
    expect(selected.activeRecorderConversationId).toBe(s.conversationId);
    const global = await t.query(api.snapshot, { token: tokens[0] });
    expect(global.conversations.some((c: { id: string }) => c.id === s.conversationId)).toBe(false);
    expect(global.activeRecorderConversationId).toBe(s.conversationId);
    expect((await t.query(api.snapshot, { token: tokens[1] })).activeRecorderConversationId).toBeUndefined();
    expect((await t.query(api.snapshot, { token: tokens[2] })).activeRecorderConversationId).toBeUndefined();
    await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId });
    expect((await t.query(api.snapshot, { token: tokens[0], eventId: otherEvent })).activeRecorderConversationId).toBeUndefined();
  });
  it("inherits recording approval but requires fresh presence before automatic start", async () => {
    const t = makeTest(); const s = await granted(t);
    const c = await conversation(t);
    expect(c.recordingConsent).toEqual([s.a, s.b]);
    expect(c.exchangeConsent).toEqual([]);
    expect(c.readyToRecord).toBe(false);
    expect(c.participants.every((p: { glanceEnabled?: boolean }) => p.glanceEnabled === undefined)).toBe(true);
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId }))
      .rejects.toMatchObject({ data: { code: "NOT_READY" } });
    await present(t, s.conversationId);
    expect((await conversation(t)).readyToRecord).toBe(true);
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).resolves.toHaveProperty("leaseUntil");
  });
});

describe("atomic finish and connection", () => {
  it.each(["gesture", "button"])("connects on authenticated %s finish with no second exchange prompt", async (method) => {
    const t = makeTest(); const s = await recording(t);
    await expect(t.mutation(api.sendMessage, { token: tokens[0], conversationId: s.conversationId, text: "Too early" })).rejects.toThrow("unavailable");
    await t.mutation(api.finishConnection, { token: tokens[1], conversationId: s.conversationId, method });
    const c = await conversation(t);
    expect(c.status).toBe("ended");
    expect(c.exchangeConsent).toEqual([s.a, s.b]);
    expect(c.connectedAt).toBeTypeOf("number");
    expect(c.finishMethod).toBe(method);
    expect(c.messages).toEqual([]);
    expect(await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId }))
      .toEqual({ status: "ended", connectedAt: c.connectedAt });
    await expect(t.mutation(api.confirmExchange, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("Finish an event");
    vi.setSystemTime(s.lease.leaseUntil + 60_000);
    await t.mutation(api.finishConnection, { token: tokens[0], conversationId: s.conversationId, method: "button" });
    expect((await conversation(t)).connectedAt).toBe(c.connectedAt);
    expect((await conversation(t)).finishMethod).toBe(method);
  });
  it("ordinary stop returns a final negative receipt and permanently wins against a later finish", async () => {
    const t = makeTest(); const s = await recording(t);
    expect(await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId }))
      .toEqual({ status: "ended", connectedAt: null });
    expect((await conversation(t)).connectedAt).toBeUndefined();
    expect((await conversation(t)).exchangeConsent).toEqual([]);
    await expect(t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("connection");
    await expect(t.mutation(api.finishConnection, { token: tokens[1], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("window ended");
    expect((await conversation(t)).connectedAt).toBeUndefined();
  });
  it("ordinary stop of pending event pairing prevents a delayed automatic start or finish", async () => {
    const t = makeTest(); const s = await granted(t);
    await present(t, s.conversationId);
    expect(await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId }))
      .toEqual({ status: "cancelled", connectedAt: null });
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow();
    await expect(t.mutation(api.finishConnection, { token: tokens[1], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("cancelled");
  });
  it("does not add a grace period after stop, expiry, cancellation, or missing start", async () => {
    const t = makeTest(); const s = await recording(t);
    await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId });
    vi.setSystemTime(s.lease.leaseUntil + 1);
    await expect(t.mutation(api.finishConnection, { token: tokens[1], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("window ended");
    expect((await conversation(t)).connectedAt).toBeUndefined();
    await t.mutation(api.cancel, { token: tokens[0], conversationId: s.conversationId });
    await expect(t.mutation(api.finishConnection, { token: tokens[1], conversationId: s.conversationId, method: "button" })).rejects.toThrow("cancelled");
  });
  it("requires authenticated participation and never treats the gesture label as identity", async () => {
    const t = makeTest(); const s = await granted(t);
    await expect(t.mutation(api.finishConnection, { token: tokens[2], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("unavailable");
    await expect(t.mutation(api.finishConnection, { token: tokens[0], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("window ended");
  });
});

describe("revocation fences and preservation", () => {
  it("revokes presence and unfinished sessions, and re-enabling does not resurrect old consent", async () => {
    const t = makeTest(); const s = await granted(t);
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId });
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    expect((await conversation(t)).status).toBe("cancelled");
    expect(await t.mutation(api.heartbeat, { token: tokens[0], conversationId: s.conversationId, ticketId: ticket.ticketId })).toBeNull();
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: true });
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow();
    await expect(t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b, mode: "event" })).resolves.toBeTypeOf("string");
  });
  it("purges in-flight raw audio and blocks publication after either standing grant is revoked", async () => {
    const t = makeTest(); const s = await processing(t);
    const args = { conversationId: s.conversationId, generation: 1 };
    await t.mutation(jobs.claim, args);
    await t.mutation(api.sendMessage, { token: tokens[0], conversationId: s.conversationId, text: "Pending recap" });
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    expect(await t.query(jobs.canProcess, args)).toBe(false);
    expect(await t.mutation(jobs.finish, { ...args, recap })).toBe(false);
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
    expect((await conversation(t)).connectedAt).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);
  });
  it("rechecks grants between provider stages rather than relying only on the queued job", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const network = vi.fn().mockImplementation(async () => {
      await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
      return new Response(JSON.stringify({ transcript: "A consented networking discussion." }));
    });
    vi.stubGlobal("fetch", network);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(network).toHaveBeenCalledTimes(1);
    expect((await conversation(t)).status).toBe("cancelled");
    expect((await conversation(t)).recap).toBeUndefined();
  });
  it("fences a changed grant revision even without relying on cancellation side effects", async () => {
    const t = makeTest(); const s = await processing(t);
    const args = { conversationId: s.conversationId, generation: 1 };
    await t.mutation(jobs.claim, args);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("memberships").withIndex("by_pair", (q) => q.eq("eventId", s.eventId).eq("profileId", s.b)).unique();
      await ctx.db.patch(row!._id, { eventPermission: { ...row!.eventPermission!, revision: row!.eventPermission!.revision + 2 } });
    });
    expect(await t.query(jobs.canProcess, args)).toBe(false);
    expect(await t.mutation(jobs.finish, { ...args, recap })).toBe(false);
    await expect(t.mutation(api.finishConnection, { token: tokens[0], conversationId: s.conversationId, method: "gesture" })).rejects.toThrow("permissions");
  });
  it("a revocation during summary generation blocks the final publication transaction", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const network = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "A design discussion." })))
      .mockImplementationOnce(async () => {
        await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: false });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          summary: recap.summary, topics: recap.topics, nextSteps: [],
        }) } }] }));
      });
    vi.stubGlobal("fetch", network);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(network).toHaveBeenCalledTimes(2);
    expect((await conversation(t)).status).toBe("cancelled");
    expect((await conversation(t)).recap).toBeUndefined();
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("immediately fences sessions beyond the cleanup batch and does not cancel a later new grant", async () => {
    const t = makeTest(); const s = await connected(t);
    await t.run(async (ctx) => {
      const first = await ctx.db.query("conversations").first();
      for (let i = 0; i < 24; i++) {
        await ctx.db.insert("conversations", {
          eventId: first!.eventId, participantA: first!.participantA, participantB: first!.participantB,
          recorderId: first!.recorderId, status: "ended", recordingConsent: first!.recordingConsent,
          exchangeConsent: first!.exchangeConsent, lastSeen: first!.lastSeen, generation: 0,
          consentMode: "event", eventGrantA: first!.eventGrantA, eventGrantB: first!.eventGrantB,
          connectedAt: first!.connectedAt, startedAt: first!.startedAt, endedAt: first!.endedAt,
        });
      }
    });
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    const pending = await t.run((ctx) => ctx.db.query("conversations").filter((q) => q.eq(q.field("status"), "ended")).collect());
    expect(pending).toHaveLength(5);
    const snapshot = await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId });
    expect(snapshot.conversations.every((c: { status: string; connectedAt?: number }) =>
      c.status === "cancelled" && c.connectedAt === undefined)).toBe(true);
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: true });
    await expect(t.mutation(api.finishConnection, { token: tokens[0], conversationId: pending[0]._id, method: "gesture" })).rejects.toThrow("permissions");
    const next = await t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b, mode: "event" });
    await t.mutation(jobs.revokeEventSessions, { eventId: s.eventId, profileId: s.b, beforeRevision: 2 });
    expect((await t.run((ctx) => ctx.db.query("conversations").withIndex("by_status", (q) => q.eq("status", "cancelled")).collect()))).toHaveLength(25);
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations.find((c: { id: string }) => c.id === next).status).toBe("consent");
  });
  it("preserves already-shared recap and chat when a standing permission is later disabled", async () => {
    const t = makeTest(); const s = await processing(t);
    await t.mutation(jobs.claim, { conversationId: s.conversationId, generation: 1 });
    await t.mutation(jobs.finish, { conversationId: s.conversationId, generation: 1, recap });
    await t.mutation(api.sendMessage, { token: tokens[0], conversationId: s.conversationId, text: "Existing connection" });
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    const c = await conversation(t);
    expect(c.status).toBe("shared"); expect(c.recap).toEqual(recap);
    expect(c.connectedAt).toBeTypeOf("number"); expect(c.messages).toHaveLength(1);
    await expect(t.mutation(api.sendMessage, { token: tokens[1], conversationId: s.conversationId, text: "Still connected" })).resolves.toBeTypeOf("string");
    await t.mutation(api.finishConnection, { token: tokens[0], conversationId: s.conversationId, method: "button" });
  });
});

describe("private shared chat and local recording discard", () => {
  it("stores only the authenticated sender, bounds text, returns the latest 50, and deletes for both", async () => {
    const t = makeTest(); const s = await connected(t);
    await expect(t.mutation(api.sendMessage, { token: tokens[2], conversationId: s.conversationId, text: "Intruder" })).rejects.toThrow("unavailable");
    await expect(t.mutation(api.sendMessage, { token: tokens[0], conversationId: s.conversationId, text: " " })).rejects.toThrow("2,000");
    await expect(t.mutation(api.sendMessage, { token: tokens[0], conversationId: s.conversationId, text: "x".repeat(2001) })).rejects.toThrow("2,000");
    for (let i = 0; i < 52; i++) {
      vi.setSystemTime(Date.now() + 10);
      await t.mutation(api.sendMessage, { token: tokens[i % 2], conversationId: s.conversationId, text: ` Message ${i} ` });
    }
    const a = await conversation(t); const b = await conversation(t, tokens[1]);
    expect(a.messages).toEqual(b.messages);
    expect(a.messages).toHaveLength(50);
    expect(a.messages[0].text).toBe("Message 2");
    expect(a.messages[49].senderId).toBe(s.b);
    expect((await t.query(api.snapshot, { token: tokens[2] })).conversations).toEqual([]);
    await t.mutation(api.deleteConversation, { token: tokens[1], conversationId: s.conversationId });
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);
    for (const token of tokens.slice(0, 2)) expect((await t.query(api.snapshot, { token })).conversations).toEqual([]);
  });
  it("allows chat on legacy shared recaps without granting standing event permission", async () => {
    const t = makeTest(); const s = await setup(t);
    const id = await t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.b });
    await t.run((ctx) => ctx.db.patch(id, { status: "shared", recordingConsent: [s.a, s.b], exchangeConsent: [s.a, s.b], recap }));
    await expect(t.mutation(api.sendMessage, { token: tokens[1], conversationId: id, text: "Legacy connection" })).resolves.toBeTypeOf("string");
    expect((await t.query(api.snapshot, { token: tokens[1], eventId: s.eventId })).eventPermission.enabled).toBe(false);
  });
  it("removes access immediately and drains long chat deletion in bounded chunks", async () => {
    const t = makeTest(); const s = await connected(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) await ctx.db.insert("messages", {
        conversationId: s.conversationId, senderId: s.a, text: `Message ${i}`, createdAt: Date.now(),
      });
    });
    await t.mutation(api.deleteConversation, { token: tokens[0], conversationId: s.conversationId });
    expect((await t.query(api.snapshot, { token: tokens[1] })).conversations).toEqual([]);
    await expect(t.mutation(api.sendMessage, { token: tokens[1], conversationId: s.conversationId, text: "No longer available" })).rejects.toThrow("unavailable");
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(1);
    await t.mutation(jobs.deleteMessages, { conversationId: s.conversationId });
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);
  });
  it("discarding an unuploaded local file preserves connection/chat and prevents stale attachment", async () => {
    const t = makeTest(); const s = await connected(t);
    await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId });
    await expect(t.mutation(api.abandonAudio, { token: tokens[1], conversationId: s.conversationId })).rejects.toThrow("recorder");
    await t.mutation(api.abandonAudio, { token: tokens[0], conversationId: s.conversationId });
    const c = await conversation(t);
    expect(c.status).toBe("failed"); expect(c.connectedAt).toBeTypeOf("number");
    expect(c.exchangeConsent).toEqual([s.a, s.b]);
    await expect(t.mutation(api.sendMessage, { token: tokens[1], conversationId: s.conversationId, text: "Chat still works" })).resolves.toBeTypeOf("string");
    await expect(t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("discarded");
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([wav()])));
    await expect(t.mutation(api.attachAudio, { token: tokens[0], conversationId: s.conversationId, storageId, mimeType: "audio/wav" })).rejects.toThrow("authorized");
  });
  it("a stale abandon does not erase attached processing audio or an already-shared result", async () => {
    const t = makeTest(); const s = await processing(t);
    await t.mutation(api.abandonAudio, { token: tokens[0], conversationId: s.conversationId });
    expect((await conversation(t)).status).toBe("processing");
    expect(await t.run(async (ctx) => !!await ctx.storage.get(s.storageId))).toBe(true);
    await t.mutation(jobs.claim, { conversationId: s.conversationId, generation: 1 });
    await t.mutation(jobs.finish, { conversationId: s.conversationId, generation: 1, recap });
    await t.mutation(api.abandonAudio, { token: tokens[0], conversationId: s.conversationId });
    expect((await conversation(t)).recap).toEqual(recap);
  });
});

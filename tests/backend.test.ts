import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { tidyRecap, validateRecap, validateWav } from "../convex/validation";
import { recapFromReply, safeError } from "../convex/meta";
import { nameSpeakers, speakerLoudness, transcriptOnly } from "../convex/speakers";
import { transcriptLines } from "../src/transcriptView";
import { RECORDING_FRESHNESS_MS } from "../src/domain";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
};
const api = anyApi.glance;
const jobs = anyApi.jobs;
const tokens = ["a", "b", "c"].map((c) => c.repeat(64));
const selfie = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cXuoAAAAASUVORK5CYII=";
const input = (name: string) => ({ name, role: "Builder", photoUrl: selfie });
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type Test = ReturnType<typeof makeTest>;

/** `level` gives the sample amplitude at a moment; silence without it. */
function wav(seconds = 1, level?: (ms: number) => number) {
  const buffer = new ArrayBuffer(44 + seconds * 32_000);
  const view = new DataView(buffer);
  const write = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, buffer.byteLength - 44, true);
  // A square wave at the given amplitude, so loudness differs between parts of the recording.
  if (level) for (let i = 0; i < seconds * 16_000; i++) view.setInt16(44 + i * 2, (i % 2 ? 1 : -1) * level(i / 16), true);
  return buffer;
}
async function setup(t: Test) {
  const [a, b, outsider] = await Promise.all(tokens.map((token, i) => t.mutation(api.register, { token, ...input(`Person ${i}`) })));
  const eventId = await t.mutation(api.createEvent, { token: tokens[0], title: "Design Night", location: "Austin" });
  const initial = await t.query(api.snapshot, { token: tokens[0], eventId });
  await t.mutation(api.joinEvent, { token: tokens[1], inviteCode: initial.event.inviteCode });
  const conversationId = await t.mutation(api.createConversation, { token: tokens[0], eventId, partnerId: b });
  return { a, b, outsider, eventId, conversationId };
}
async function heartbeat(t: Test, token: string, conversationId: string) {
  const ticket = await t.mutation(api.presenceTicket, { token, conversationId });
  if (!ticket) return null;
  return t.mutation(api.heartbeat, { token, conversationId, ticketId: ticket.ticketId });
}
async function bothPresent(t: Test, conversationId: string) {
  for (const token of tokens.slice(0, 2)) await heartbeat(t, token, conversationId);
}
async function ended(t: Test) {
  const state = await setup(t);
  const base = { conversationId: state.conversationId };
  await t.mutation(api.consentRecording, { token: tokens[0], ...base });
  await t.mutation(api.consentRecording, { token: tokens[1], ...base });
  await bothPresent(t, state.conversationId);
  await t.mutation(api.startRecording, { token: tokens[0], ...base });
  vi.setSystemTime(Date.now() + 1000);
  await t.mutation(api.stop, { token: tokens[1], ...base });
  return state;
}
async function upload(t: Test, conversationId: string, audio = wav()) {
  await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([audio], { type: "audio/wav" })));
  await t.mutation(api.attachAudio, { token: tokens[0], conversationId, storageId, mimeType: "audio/wav" });
  return storageId;
}
async function processing(t: Test, audio?: ArrayBuffer) {
  const state = await ended(t);
  const storageId = await upload(t, state.conversationId, audio);
  for (const token of tokens.slice(0, 2)) await t.mutation(api.confirmExchange, { token, conversationId: state.conversationId });
  return { ...state, storageId };
}
const recap = { summary: "They discussed prototypes.", topics: ["Prototypes"], nextSteps: [], source: "ai" as const };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("device-scoped authentication and redaction", () => {
  it("requires a strong-format token and a valid image when given, and hashes credentials", async () => {
    const t = makeTest();
    await expect(t.mutation(api.register, { token: "guessable", ...input("A") })).rejects.toThrow("Invalid device");
    await expect(t.mutation(api.register, { token: tokens[0], ...input("A"), photoUrl: "data:image/gif;base64,R0lG" })).rejects.toThrow("selfie");
    await expect(t.mutation(api.register, { token: tokens[0], ...input("A"), photoUrl: "data:image/png;base64,YWJj" })).rejects.toThrow("does not match");
    const id = await t.mutation(api.register, { token: tokens[0], ...input("A") });
    expect(await t.mutation(api.register, { token: tokens[0], ...input("Ignored") })).toBe(id);
    const stored = await t.run((ctx) => ctx.db.query("profiles").first());
    expect(stored!.tokenHash).not.toBe(tokens[0]);
    const snapshot = await t.query(api.snapshot, { token: tokens[0] });
    expect(snapshot.me).toEqual({ id, ...input("A") });
    expect(JSON.stringify(snapshot)).not.toContain("tokenHash");
  });
  it("accepts a profile without a portrait", async () => {
    const t = makeTest();
    const id = await t.mutation(api.register, { token: tokens[0], ...input("A"), photoUrl: "" });
    const snapshot = await t.query(api.snapshot, { token: tokens[0] });
    expect(snapshot.me).toEqual({ id, ...input("A"), photoUrl: "" });
  });
  it("blocks outsider event reads, pairing, and conversation mutations", async () => {
    const t = makeTest();
    const s = await setup(t);
    await expect(t.query(api.snapshot, { token: tokens[2], eventId: s.eventId })).rejects.toThrow("unavailable");
    expect((await t.query(api.snapshot, { token: tokens[2] })).conversations).toEqual([]);
    await expect(t.mutation(api.createConversation, { token: tokens[0], eventId: s.eventId, partnerId: s.outsider })).rejects.toThrow("unavailable");
    for (const name of ["consentRecording", "startRecording", "presenceTicket", "stop", "confirmExchange", "createUploadUrl", "retryProcessing", "cancel", "deleteConversation"]) {
      await expect(t.mutation(api[name], { token: tokens[2], conversationId: s.conversationId })).rejects.toThrow("unavailable");
    }
    await t.mutation(api.consentRecording, { token: tokens[0], conversationId: s.conversationId });
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId });
    await expect(t.mutation(api.heartbeat, { token: tokens[2], conversationId: s.conversationId, ticketId: ticket.ticketId })).rejects.toThrow("unavailable");
  });
  it("never exposes other members' conversations to event members", async () => {
    const t = makeTest(); const s = await setup(t);
    const snap = await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId });
    await t.mutation(api.joinEvent, { token: tokens[2], inviteCode: snap.event.inviteCode });
    const other = await t.query(api.snapshot, { token: tokens[2], eventId: s.eventId });
    expect(other.members).toHaveLength(3);
    expect(other.conversations).toHaveLength(0);
  });
});

describe("independent consent and fail-closed recording", () => {
  it("requires two distinct consented people, and only the recorder can start", async () => {
    const t = makeTest(); const s = await setup(t);
    const args = { token: tokens[0], conversationId: s.conversationId };
    await t.mutation(api.consentRecording, args);
    await t.mutation(api.consentRecording, args);
    await expect(t.mutation(api.startRecording, args)).rejects.toThrow("Both");
    await t.mutation(api.consentRecording, { ...args, token: tokens[1] });
    await expect(t.mutation(api.startRecording, { ...args, token: tokens[1] })).rejects.toThrow("designated recorder");
    // Consent approval receipt is not a liveness signal.
    await expect(t.mutation(api.startRecording, args)).rejects.toThrow("online");
    await bothPresent(t, s.conversationId);
    const lease = await t.mutation(api.startRecording, args);
    expect(lease.leaseUntil - lease.serverNow).toBeGreaterThan(0);
    expect(lease.leaseUntil - lease.serverNow).toBeLessThanOrEqual(RECORDING_FRESHNESS_MS);
  });
  it("bounds total freshness by the other phone, without a second five-second grace", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    const initialLease = await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
    const start = initialLease.serverNow;
    vi.setSystemTime(start + 4000);
    expect(await heartbeat(t, tokens[0], s.conversationId))
      .toEqual({ serverNow: start + 4000, leaseUntil: initialLease.leaseUntil });
    vi.setSystemTime(initialLease.leaseUntil);
    expect(await heartbeat(t, tokens[1], s.conversationId)).toBeNull();
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow();
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations[0].status).toBe("ended");
  });
  it("does not start with stale consent, but consent-state heartbeats refresh presence", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    vi.setSystemTime(Date.now() + RECORDING_FRESHNESS_MS + 1000);
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("online");
    for (const token of tokens.slice(0, 2)) expect(await heartbeat(t, token, s.conversationId)).toBeNull();
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).resolves.toHaveProperty("serverNow");
  });
  it("allows either participant to stop and forbids pre-recording exchange", async () => {
    const t = makeTest(); const s = await setup(t);
    await expect(t.mutation(api.confirmExchange, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("End recording");
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
    await t.mutation(api.stop, { token: tokens[1], conversationId: s.conversationId });
    await t.mutation(api.stop, { token: tokens[0], conversationId: s.conversationId });
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations[0].status).toBe("ended");
  });
});

describe("one-time presence challenges and delayed withdrawal", () => {
  it("requires approval before ticket issuance, and issuance alone never permits start", async () => {
    const t = makeTest(); const s = await setup(t);
    expect(await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId })).toBeNull();
    for (const token of tokens.slice(0, 2)) {
      await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
      expect(await t.mutation(api.presenceTicket, { token, conversationId: s.conversationId })).toHaveProperty("ticketId");
    }
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("online");
  });
  it("binds a one-use server ticket to the authenticated participant", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId });
    await expect(t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId })).rejects.toThrow("unavailable");
    await t.mutation(api.heartbeat, { token: tokens[0], conversationId: s.conversationId, ticketId: ticket.ticketId });
    await expect(t.mutation(api.heartbeat, { token: tokens[0], conversationId: s.conversationId, ticketId: ticket.ticketId })).rejects.toThrow("already used");
    const stored = await t.run((ctx) => ctx.db.query("conversations").first());
    expect(stored!.lastSeen[s.a]).toBe(ticket.issuedAt);
  });
  it("rejects a ticket bound to a different conversation even for the same profile", async () => {
    const t = makeTest(); const s = await setup(t);
    await t.mutation(api.consentRecording, { token: tokens[0], conversationId: s.conversationId });
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId });
    // Deliberately seed a second active session to isolate the binding check;
    // normal public pairing additionally prevents simultaneous active sessions.
    const otherId = await t.run(async (ctx) => {
      const original = await ctx.db.query("conversations").first();
      return ctx.db.insert("conversations", {
        eventId: original!.eventId, participantA: original!.participantA, participantB: original!.participantB,
        recorderId: original!.recorderId, status: "consent", recordingConsent: original!.recordingConsent,
        exchangeConsent: [], lastSeen: {}, ticketIssuedAt: {}, generation: 0,
      });
    });
    await expect(t.mutation(api.heartbeat, { token: tokens[0], conversationId: otherId, ticketId: ticket.ticketId })).rejects.toThrow("unavailable");
    expect(await t.mutation(api.heartbeat, { token: tokens[0], conversationId: s.conversationId, ticketId: ticket.ticketId })).toBeNull();
  });
  it("a delayed pre-withdrawal ACK uses ticket issuance, never its late arrival time", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    const initial = await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
    vi.setSystemTime(initial.serverNow + 1000);
    await heartbeat(t, tokens[0], s.conversationId);
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[1], conversationId: s.conversationId });
    const localWithdrawalAt = ticket.issuedAt + 100;
    // The acknowledgement arrives late: 500 ms before the lease would run out.
    vi.setSystemTime(initial.serverNow + RECORDING_FRESHNESS_MS - 500);
    const late = await t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId });
    expect(late.leaseUntil).toBeLessThanOrEqual(ticket.expiresAt);
    expect(late.leaseUntil).toBeLessThanOrEqual(localWithdrawalAt + RECORDING_FRESHNESS_MS);
    expect(late.leaseUntil - late.serverNow).toBeLessThan(2000);
    const stored = await t.run((ctx) => ctx.db.query("conversations").first());
    expect(stored!.lastSeen[s.b]).toBe(ticket.issuedAt);
  });
  it("an unexpired ticket cannot revive a recording whose previous lease expired", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    const initial = await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
    vi.setSystemTime(initial.serverNow + 1000);
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[1], conversationId: s.conversationId });
    vi.setSystemTime(initial.leaseUntil + 1);
    expect(ticket.expiresAt).toBeGreaterThan(Date.now());
    expect(await t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId })).toBeNull();
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations[0].status).toBe("ended");
  });
  it("expired tickets and delayed consent approvals cannot manufacture fresh presence", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[1], conversationId: s.conversationId });
    vi.setSystemTime(ticket.expiresAt);
    expect(await t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId })).toBeNull();
    await t.mutation(api.consentRecording, { token: tokens[1], conversationId: s.conversationId });
    await heartbeat(t, tokens[0], s.conversationId);
    await expect(t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId })).rejects.toThrow("online");
  });
  it("bounds ticket counts, prevents sliding issuance, throttles new tickets, and sweeps abandoned tickets", async () => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    const first = await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId });
    const second = await t.mutation(api.presenceTicket, { token: tokens[1], conversationId: s.conversationId });
    for (let i = 0; i < 10; i++) expect(await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId })).toEqual(first);
    expect(await t.run(async (ctx) => (await ctx.db.query("presenceTickets").collect()).length)).toBe(2);
    await t.mutation(api.heartbeat, { token: tokens[0], conversationId: s.conversationId, ticketId: first.ticketId });
    expect(await t.mutation(api.presenceTicket, { token: tokens[0], conversationId: s.conversationId })).toBeNull();
    vi.setSystemTime(Math.max(first.expiresAt, second.expiresAt) + 1);
    await t.mutation(jobs.sweep, {});
    expect(await t.run(async (ctx) => (await ctx.db.query("presenceTickets").collect()).length)).toBe(0);
  });
  it.each(["stop", "cancel", "deleteConversation"])("%s invalidates issued tickets", async (operation) => {
    const t = makeTest(); const s = await setup(t);
    for (const token of tokens.slice(0, 2)) await t.mutation(api.consentRecording, { token, conversationId: s.conversationId });
    await bothPresent(t, s.conversationId);
    await t.mutation(api.startRecording, { token: tokens[0], conversationId: s.conversationId });
    vi.setSystemTime(Date.now() + 1000);
    const ticket = await t.mutation(api.presenceTicket, { token: tokens[1], conversationId: s.conversationId });
    await t.mutation(api[operation], { token: tokens[0], conversationId: s.conversationId });
    expect(await t.run(async (ctx) => (await ctx.db.query("presenceTickets").collect()).length)).toBe(0);
    const acknowledge = t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId });
    if (operation === "deleteConversation") await expect(acknowledge).rejects.toThrow("unavailable");
    else expect(await acknowledge).toBeNull();
  });
});

describe("private audio, two-person exchange, processing, and deletion", () => {
  it("accepts audio only from the recorder and only in WAV format", async () => {
    const t = makeTest(); const s = await ended(t);
    await expect(t.mutation(api.createUploadUrl, { token: tokens[1], conversationId: s.conversationId })).rejects.toThrow("recorder");
    await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([wav()])));
    await expect(t.mutation(api.attachAudio, { token: tokens[1], conversationId: s.conversationId, storageId, mimeType: "audio/wav" })).rejects.toThrow("recorder");
    await expect(t.mutation(api.attachAudio, { token: tokens[0], conversationId: s.conversationId, storageId, mimeType: "audio/mp4" })).rejects.toThrow("WAV");
  });
  it("does not queue or publish with one person's repeated exchange confirmation", async () => {
    const t = makeTest(); const s = await ended(t);
    await upload(t, s.conversationId);
    for (let i = 0; i < 3; i++) await t.mutation(api.confirmExchange, { token: tokens[0], conversationId: s.conversationId });
    const snap = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(snap.status).toBe("ended"); expect(snap.exchangeConsent).toHaveLength(1); expect(snap.recap).toBeUndefined();
    expect(await t.mutation(jobs.claim, { conversationId: s.conversationId, generation: 1 })).toBeNull();
    expect(await t.mutation(jobs.finish, { conversationId: s.conversationId, generation: 0, recap })).toBe(false);
  });
  it("queues once, claims once, publishes the same recap to both, and purges raw audio", async () => {
    const t = makeTest(); const s = await processing(t);
    await t.mutation(api.confirmExchange, { token: tokens[1], conversationId: s.conversationId });
    await t.mutation(api.retryProcessing, { token: tokens[0], conversationId: s.conversationId });
    const args = { conversationId: s.conversationId, generation: 1 };
    expect(await t.mutation(jobs.claim, args)).toHaveProperty("storageId", s.storageId);
    expect(await t.mutation(jobs.claim, args)).toBeNull();
    expect(await t.mutation(jobs.finish, { ...args, recap })).toBe(true);
    expect(await t.mutation(jobs.finish, { ...args, recap })).toBe(false);
    const a = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    const b = (await t.query(api.snapshot, { token: tokens[1] })).conversations[0];
    expect(a.recap).toEqual(b.recap); expect(a.status).toBe("shared");
    expect(a.participants).toHaveLength(2); expect(a).not.toHaveProperty("audioStorageId");
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("cancellation invalidates an in-flight result and purges audio", async () => {
    const t = makeTest(); const s = await processing(t);
    const args = { conversationId: s.conversationId, generation: 1 };
    await t.mutation(jobs.claim, args);
    await t.mutation(api.cancel, { token: tokens[1], conversationId: s.conversationId });
    expect(await t.mutation(jobs.finish, { ...args, recap })).toBe(false);
    expect(await t.query(jobs.canProcess, args)).toBe(false);
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("cancelled"); expect(result.recap).toBeUndefined();
  });
  it("deletion removes both views and an in-flight job cannot resurrect it", async () => {
    const t = makeTest(); const s = await processing(t);
    await t.mutation(jobs.claim, { conversationId: s.conversationId, generation: 1 });
    await t.mutation(api.deleteConversation, { token: tokens[0], conversationId: s.conversationId });
    expect(await t.mutation(jobs.finish, { conversationId: s.conversationId, generation: 1, recap })).toBe(false);
    for (const token of tokens.slice(0, 2)) expect((await t.query(api.snapshot, { token })).conversations).toEqual([]);
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("missing API configuration is explicit failure, never a sample recap or network call", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("failed"); expect(result.error).toContain("not configured");
    expect(result.recap).toBeUndefined(); expect(network).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("uses the documented transcription and Standard summary contracts with validated output", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "We discussed prototypes. No follow-ups were agreed." })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: recap.summary, topics: recap.topics, nextSteps: [] }) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [asrUrl, asr] = fetchMock.mock.calls[0];
    expect(asrUrl).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(JSON.parse(await asr.body.get("request").text())).toEqual({ mode: "DIARIZATION", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
    expect(asr.body.get("audio").type).toBe("audio/wav");
    const [summaryUrl, summary] = fetchMock.mock.calls[1];
    expect(summaryUrl).toBe("https://api.meta.ai/v1/chat/completions");
    expect(JSON.parse(summary.body).model).toBe("muse-spark-1.3");
    expect(JSON.parse(summary.body).response_format.json_schema.strict).toBe(true);
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.recap).toEqual({ ...recap, transcript: expect.any(Array) });
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("asks once more when the first reply has no usable recap, then publishes the second", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const good = { summary: recap.summary, topics: recap.topics, nextSteps: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "We discussed prototypes." })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "length" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("shared");
    expect(result.recap).toEqual({ ...recap, nextSteps: [], transcript: expect.any(Array) });
  });
  it("shares what was said, under each person's name, when the summary cannot be written", async () => {
    // The quiet voice speaks first, the loud one second. The recorder (Person 0) is on their own device: the loud one.
    const t = makeTest(); const s = await processing(t, wav(1, (ms) => ms < 450 ? 400 : 9_000));
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const turns = [
      { speaker: "B", startMs: 0, endMs: 400, transcript: "hello" },
      { speaker: "A", startMs: 500, endMs: 1_000, transcript: "hey whats up" },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "hello hey whats up", turns })))
      .mockImplementation(async () => new Response("private-provider-error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(logged.mock.calls.flat()).toEqual(["Recap summary failed, sharing the transcript alone: SUMMARY_HTTP_500"]);
    logged.mockRestore();
    const mine = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    const theirs = (await t.query(api.snapshot, { token: tokens[1] })).conversations[0];
    expect(mine.status).toBe("shared"); expect(mine.error).toBeUndefined();
    expect(mine.recap).toEqual({
      summary: "", topics: [], nextSteps: [], source: "transcript",
      transcript: [
        { speaker: "Speaker 1", speakerId: s.b, startMs: 0, endMs: 400, text: "hello" },
        { speaker: "Speaker 2", speakerId: s.a, startMs: 500, endMs: 1_000, text: "hey whats up" },
      ],
    });
    expect(theirs.recap).toEqual(mine.recap);
    expect(transcriptLines(mine.recap.transcript, mine.participants)).toMatchObject({
      named: true, lines: [{ name: "Person 1", text: "hello" }, { name: "Person 0", text: "hey whats up" }],
    });
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("shares an unsplit transcript without names when the model twice finds nothing to summarize", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const empty = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: " ", topics: [], nextSteps: [] }) } }] }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "Testing. Testing." })))
      .mockImplementation(async () => empty());
    vi.stubGlobal("fetch", fetchMock);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logged.mock.calls.flat()).toEqual(["Recap summary failed, sharing the transcript alone: EMPTY_RECAP"]);
    logged.mockRestore();
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("shared");
    expect(result.recap).toEqual({
      summary: "", topics: [], nextSteps: [], source: "transcript",
      transcript: [{ speaker: "", startMs: 0, endMs: expect.any(Number), text: "Testing. Testing." }],
    });
    expect(transcriptLines(result.recap.transcript, result.participants)).toMatchObject({ named: false, lines: [{ name: "", text: "Testing. Testing." }] });
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("still fails plainly when nothing intelligible was said", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript: "  " }))));
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("failed"); expect(result.recap).toBeUndefined();
    expect(result.error).toContain("No intelligible speech");
  });
  it("cancellation while transcription is in-flight blocks the second call and publication", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const fetchMock = vi.fn().mockImplementation(async () => {
      await t.mutation(api.cancel, { token: tokens[1], conversationId: s.conversationId });
      return new Response(JSON.stringify({ transcript: "Never publish this." }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations[0].status).toBe("cancelled");
  });
  it("provider failures purge raw audio and do not expose response bodies", async () => {
    const t = makeTest(); const s = await processing(t);
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-error", { status: 503 })));
    await t.action(anyApi.pipeline.process, { conversationId: s.conversationId, generation: 1 });
    const result = (await t.query(api.snapshot, { token: tokens[0] })).conversations[0];
    expect(result.status).toBe("failed"); expect(result.recap).toBeUndefined();
    expect(result.error).not.toContain("private-provider-error");
    expect(await t.run((ctx) => ctx.storage.get(s.storageId))).toBeNull();
  });
  it("sweeps orphan uploads and expires attached audio even without exchange", async () => {
    const t = makeTest(); const s = await ended(t);
    const attached = await upload(t, s.conversationId);
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob([wav()])));
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1000);
    await t.mutation(jobs.sweep, {});
    expect(await t.run((ctx) => ctx.storage.get(attached))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
    expect((await t.query(api.snapshot, { token: tokens[0] })).conversations[0].status).toBe("failed");
  });
  it.each(["cancel", "deleteConversation"])("rejects and eventually purges an upload finishing after %s", async (operation) => {
    const t = makeTest(); const s = await ended(t);
    await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId: s.conversationId });
    await t.mutation(api[operation], { token: tokens[1], conversationId: s.conversationId });
    // A previously issued signed upload capability may still complete after cancellation.
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob([wav()])));
    await expect(t.mutation(api.attachAudio, {
      token: tokens[0], conversationId: s.conversationId, storageId: orphan, mimeType: "audio/wav",
    })).rejects.toThrow();
    expect(await t.mutation(jobs.claim, { conversationId: s.conversationId, generation: 1 })).toBeNull();
    expect(await t.run(async (ctx) => !!await ctx.storage.get(orphan))).toBe(true);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await t.mutation(jobs.sweep, {});
    expect(await t.run(async (ctx) => !!await ctx.storage.get(orphan))).toBe(false);
  });
});

describe("provider data validation", () => {
  it("validates WAV structure, sample rate, channel count, and duration", () => {
    expect(validateWav(wav())).toEqual({ durationMs: 1000, sampleRate: 16000 });
    expect(() => validateWav(new ArrayBuffer(100))).toThrow("INVALID_WAV");
    const stereo = wav(); new DataView(stereo).setUint16(22, 2, true);
    expect(() => validateWav(stereo)).toThrow("INVALID_WAV");
    expect(() => validateWav(wav(2), 1000)).toThrow("AUDIO_TOO_LONG");
  });
  it("rejects fabricated sample flags, wrong schemas, excess fields, and overlong text", () => {
    expect(validateRecap({ summary: "A real transcript recap.", topics: [], nextSteps: [] }).source).toBe("ai");
    expect(() => validateRecap({ summary: "test", topics: [], nextSteps: [], source: "sample" })).toThrow();
    expect(() => validateRecap({ summary: "", topics: [], nextSteps: [] })).toThrow();
    expect(() => validateRecap({ summary: "test", topics: [123], nextSteps: [] })).toThrow();
    expect(() => validateRecap({ summary: "x".repeat(2001), topics: [], nextSteps: [] })).toThrow();
  });
  it("names the flaw in the code it throws, never the text", () => {
    expect(() => validateRecap(["a list"])).toThrow("INVALID_RECAP_SHAPE");
    expect(() => validateRecap({ summary: "test", topics: [], nextSteps: [], source: "sample" })).toThrow("INVALID_RECAP_FIELDS");
    expect(() => validateRecap({ summary: "", topics: [], nextSteps: [] })).toThrow("INVALID_RECAP_SUMMARY");
    expect(() => validateRecap({ summary: "test", topics: [123], nextSteps: [] })).toThrow("INVALID_RECAP_TOPICS");
    expect(() => validateRecap({ summary: "test", topics: [], nextSteps: [""] })).toThrow("INVALID_RECAP_NEXT_STEPS");
    for (const code of ["INVALID_RECAP_SHAPE", "INVALID_RECAP_NEXT_STEPS", "RECAP_NO_TEXT", "RECAP_NOT_JSON"]) {
      expect(safeError(new Error(code))).toContain("did not pass validation");
    }
    expect(safeError(new Error("RECAP_CUT_SHORT"))).toContain("ran out of room");
  });
  it("keeps a recap whose only flaws are blank items, stray spaces, a missing list or overlong text", () => {
    const tidy = tidyRecap({ summary: "  They compared prototypes.  ", topics: ["", " hardware ", "x".repeat(400)], nextSteps: null }) as Record<string, unknown>;
    expect(validateRecap(tidy)).toEqual({ summary: "They compared prototypes.", topics: ["hardware", `${"x".repeat(299)}…`], nextSteps: [], source: "ai" });
    expect(validateRecap(tidyRecap({ summary: "y".repeat(2500), topics: Array.from({ length: 20 }, (_, i) => `topic ${i}`), nextSteps: [] })))
      .toMatchObject({ summary: `${"y".repeat(1999)}…`, topics: Array.from({ length: 12 }, (_, i) => `topic ${i}`) });
    // Tidying never rescues the wrong shape or a fabricated flag.
    expect(() => validateRecap(tidyRecap({ summary: "test", topics: [123], nextSteps: [] }))).toThrow("INVALID_RECAP_TOPICS");
    expect(() => validateRecap(tidyRecap({ summary: "test", topics: [], nextSteps: [], source: "sample" }))).toThrow("INVALID_RECAP_FIELDS");
    expect(() => validateRecap(tidyRecap({ summary: "test", topics: [] }))).toThrow("INVALID_RECAP_FIELDS");
  });
  it("puts the recorder to the louder voice, and names nobody without two voices to compare", () => {
    const audio = wav(2, (ms) => ms < 1_000 ? 6_000 : 700);
    const turn = (speaker: string, startMs: number, endMs: number) => ({ speaker, startMs, endMs, text: "words" });
    const two = [turn("Speaker 1", 0, 900), turn("Speaker 2", 1_100, 1_900), turn("Speaker 1", 1_950, 2_000)];
    expect([...speakerLoudness(audio, two).keys()]).toEqual(["Speaker 1", "Speaker 2"]);
    expect(nameSpeakers(two, audio, "recorder", "partner").map((t) => t.speakerId)).toEqual(["recorder", "partner", "recorder"]);
    // The other way round: the first voice is the quiet one.
    expect(nameSpeakers(two, wav(2, (ms) => ms < 1_000 ? 700 : 6_000), "recorder", "partner").map((t) => t.speakerId)).toEqual(["partner", "recorder", "partner"]);
    // A third voice in the room keeps its anonymous label.
    const three = [...two, turn("Speaker 3", 1_000, 1_050)];
    expect(nameSpeakers(three, audio, "recorder", "partner").at(-1)).not.toHaveProperty("speakerId");
    // One voice, no partner, or audio that cannot be read: no names.
    expect(nameSpeakers([turn("Speaker 1", 0, 900)], audio, "recorder", "partner")).toEqual([turn("Speaker 1", 0, 900)]);
    expect(nameSpeakers(two, audio, "recorder", undefined)).toEqual(two);
    expect(nameSpeakers(two, new ArrayBuffer(8), "recorder", "partner")).toEqual(two);
    expect(transcriptOnly(two, "ignored", 2_000).transcript).toBe(two);
  });
  it("shows a matched voice by name, an unmatched one by its speaker number", () => {
    const people = [{ id: "a", name: "Sanjith Tamballa" }, { id: "b", name: "Afnan Hasan" }];
    const view = transcriptLines([
      { speaker: "Speaker 1", speakerId: "b", startMs: 0, endMs: 400, text: "hello" },
      { speaker: "Speaker 2", speakerId: "a", startMs: 500, endMs: 900, text: "hey whats up" },
      { speaker: "Speaker 3", startMs: 950, endMs: 990, text: "excuse me" },
      { speaker: "Speaker 1", speakerId: "gone", startMs: 995, endMs: 999, text: "bye" },
    ], people);
    expect(view.named).toBe(true);
    expect(view.lines.map((line) => `${line.name}: ${line.text}`)).toEqual([
      "Afnan Hasan: hello", "Sanjith Tamballa: hey whats up", "Speaker 3: excuse me", "Speaker 1: bye",
    ]);
    expect(view.lines[0].tone).not.toBe(view.lines[1].tone);
    expect(transcriptLines(undefined, people)).toEqual({ lines: [], named: false });
  });
  it("reads a recap from text parts, a code fence or a line of preamble, and says how a reply fell short", () => {
    const body = { summary: "They compared prototypes.", topics: ["hardware"], nextSteps: [] };
    const reply = (content: unknown, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] });
    const expected = { ...body, source: "ai" };
    expect(recapFromReply(reply(JSON.stringify(body)))).toEqual(expected);
    expect(recapFromReply(reply([{ type: "text", text: JSON.stringify(body) }]))).toEqual(expected);
    expect(recapFromReply(reply("```json\n" + JSON.stringify(body) + "\n```"))).toEqual(expected);
    expect(recapFromReply(reply(`Here is the recap:\n${JSON.stringify(body)}`))).toEqual(expected);
    expect(() => recapFromReply(reply(null))).toThrow("RECAP_NO_TEXT");
    expect(() => recapFromReply({})).toThrow("RECAP_NO_TEXT");
    expect(() => recapFromReply(reply("", "length"))).toThrow("RECAP_CUT_SHORT");
    expect(() => recapFromReply(reply('{"summary": "They compared', "length"))).toThrow("RECAP_CUT_SHORT");
    expect(() => recapFromReply(reply("I cannot summarize this."))).toThrow("RECAP_NOT_JSON");
    expect(() => recapFromReply(reply(JSON.stringify({ summary: "", topics: [], nextSteps: [] })))).toThrow("EMPTY_RECAP");
  });
});

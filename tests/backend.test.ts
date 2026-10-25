import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { validateRecap, validateWav } from "../convex/validation";

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

function wav(seconds = 1) {
  const buffer = new ArrayBuffer(44 + seconds * 32_000);
  const view = new DataView(buffer);
  const write = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, buffer.byteLength - 44, true);
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
async function upload(t: Test, conversationId: string) {
  await t.mutation(api.createUploadUrl, { token: tokens[0], conversationId });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([wav()], { type: "audio/wav" })));
  await t.mutation(api.attachAudio, { token: tokens[0], conversationId, storageId, mimeType: "audio/wav" });
  return storageId;
}
async function processing(t: Test) {
  const state = await ended(t);
  const storageId = await upload(t, state.conversationId);
  for (const token of tokens.slice(0, 2)) await t.mutation(api.confirmExchange, { token, conversationId: state.conversationId });
  return { ...state, storageId };
}
const recap = { summary: "They discussed prototypes.", topics: ["Prototypes"], nextSteps: [], source: "ai" as const };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("device-scoped authentication and redaction", () => {
  it("requires a strong-format token and a required image, and hashes credentials", async () => {
    const t = makeTest();
    await expect(t.mutation(api.register, { token: "guessable", ...input("A") })).rejects.toThrow("Invalid device");
    await expect(t.mutation(api.register, { token: tokens[0], ...input("A"), photoUrl: "" })).rejects.toThrow("selfie");
    await expect(t.mutation(api.register, { token: tokens[0], ...input("A"), photoUrl: "data:image/png;base64,YWJj" })).rejects.toThrow("does not match");
    const id = await t.mutation(api.register, { token: tokens[0], ...input("A") });
    expect(await t.mutation(api.register, { token: tokens[0], ...input("Ignored") })).toBe(id);
    const stored = await t.run((ctx) => ctx.db.query("profiles").first());
    expect(stored!.tokenHash).not.toBe(tokens[0]);
    const snapshot = await t.query(api.snapshot, { token: tokens[0] });
    expect(snapshot.me).toEqual({ id, ...input("A") });
    expect(JSON.stringify(snapshot)).not.toContain("tokenHash");
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
    expect(lease.leaseUntil - lease.serverNow).toBeLessThanOrEqual(5000);
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
    vi.setSystemTime(Date.now() + 6000);
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
    vi.setSystemTime(initial.serverNow + 4500);
    const late = await t.mutation(api.heartbeat, { token: tokens[1], conversationId: s.conversationId, ticketId: ticket.ticketId });
    expect(late.leaseUntil).toBeLessThanOrEqual(ticket.expiresAt);
    expect(late.leaseUntil).toBeLessThanOrEqual(localWithdrawalAt + 5000);
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
});

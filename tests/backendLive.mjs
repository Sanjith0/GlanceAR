/**
 * Opt-in, local-only integration smoke. No Meta/model call and no real audio.
 * Run while `CONVEX_AGENT_MODE=anonymous npx convex dev` is active.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const url = process.env.GLANCE_LOCAL_TEST_URL ?? "http://127.0.0.1:3210";
const parsed = new URL(url);
assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname), "Smoke is local-only.");
const client = new ConvexHttpClient(url);
const api = anyApi.glance;
const tokenA = randomBytes(32).toString("hex");
const tokenB = randomBytes(32).toString("hex");
const outsider = randomBytes(32).toString("hex");
const photoUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cXuoAAAAASUVORK5CYII=";
let conversationId;
async function presence(token) {
  const ticket = await client.mutation(api.presenceTicket, { token, conversationId });
  if (!ticket) return null;
  return client.mutation(api.heartbeat, { token, conversationId, ticketId: ticket.ticketId });
}
try {
  const a = await client.mutation(api.register, { token: tokenA, name: "Local Test A", role: "Synthetic fixture", photoUrl });
  const b = await client.mutation(api.register, { token: tokenB, name: "Local Test B", role: "Synthetic fixture", photoUrl });
  await client.mutation(api.register, { token: outsider, name: "Local Test Outsider", role: "Synthetic fixture", photoUrl });
  const eventId = await client.mutation(api.createEvent, { token: tokenA, title: "Local smoke fixture", location: "Not a real event" });
  const snapshot = await client.query(api.snapshot, { token: tokenA, eventId });
  assert.equal(snapshot.me.id, a);
  await assert.rejects(client.query(api.snapshot, { token: outsider, eventId }));
  await client.mutation(api.joinEvent, { token: tokenB, inviteCode: snapshot.event.inviteCode });
  conversationId = await client.mutation(api.createConversation, { token: tokenA, eventId, partnerId: b });
  await client.mutation(api.consentRecording, { token: tokenA, conversationId });
  await assert.rejects(client.mutation(api.startRecording, { token: tokenA, conversationId }));
  await client.mutation(api.consentRecording, { token: tokenB, conversationId });
  await assert.rejects(client.mutation(api.startRecording, { token: tokenA, conversationId }));
  await presence(tokenA);
  await presence(tokenB);
  const lease = await client.mutation(api.startRecording, { token: tokenA, conversationId });
  assert.ok(lease.leaseUntil > lease.serverNow && lease.leaseUntil - lease.serverNow <= 5000);
  assert.deepEqual(await client.mutation(api.stop, { token: tokenB, conversationId }), { status: "ended", connectedAt: null });
  await client.mutation(api.confirmExchange, { token: tokenA, conversationId });
  const result = await client.query(api.snapshot, { token: tokenB, eventId });
  assert.equal(result.conversations[0].status, "ended");
  assert.equal(result.conversations[0].exchangeConsent.length, 1);
  assert.equal(result.conversations[0].recap, undefined);
  // Exercise the exact raw HTTP path used by the native DAT harness.
  const http = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "glance:snapshot", args: { token: tokenB, eventId }, format: "json" }),
  });
  const raw = await http.json();
  assert.equal(raw.status, "success");
  assert.equal(raw.value.me.id, b);
  await client.mutation(api.deleteConversation, { token: tokenA, conversationId });
  conversationId = undefined;
  await client.mutation(api.setEventPermission, { token: tokenA, eventId, enabled: true });
  await assert.rejects(client.mutation(api.createConversation, { token: tokenA, eventId, partnerId: b, mode: "event" }));
  await client.mutation(api.setEventPermission, { token: tokenB, eventId, enabled: true });
  conversationId = await client.mutation(api.createConversation, { token: tokenA, eventId, partnerId: b, mode: "event", source: "glasses" });
  const bound = await client.query(api.snapshot, { token: tokenA, eventId });
  assert.equal(bound.conversations[0].readyToRecord, false);
  assert.equal(bound.conversations[0].captureSource, "glasses");
  assert.equal(bound.activeRecorderConversationId, conversationId);
  assert.equal((await client.query(api.snapshot, { token: tokenB, eventId })).activeRecorderConversationId, undefined);
  const notReadyHttp = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "glance:startRecording", args: { token: tokenA, conversationId }, format: "json" }),
  });
  const notReady = await notReadyHttp.json();
  assert.equal(notReady.status, "error");
  assert.equal(notReady.errorData?.code, "NOT_READY");
  console.log(`NOT_READY raw HTTP envelope: status=${notReady.status}, errorDataType=${typeof notReady.errorData}, code=${notReady.errorData.code}`);
  await presence(tokenA);
  await presence(tokenB);
  assert.equal((await client.query(api.snapshot, { token: tokenA, eventId })).conversations[0].readyToRecord, true);
  await client.mutation(api.startRecording, { token: tokenA, conversationId });
  const finishHttp = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "glance:finishConnection", args: { token: tokenB, conversationId, method: "gesture" }, format: "json" }),
  });
  assert.equal((await finishHttp.json()).status, "success");
  // Reconcile peer finish before any subscription/snapshot has delivered connectedAt.
  const stopHttp = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "glance:stop", args: { token: tokenA, conversationId }, format: "json" }),
  });
  const stopEnvelope = await stopHttp.json();
  assert.equal(stopEnvelope.status, "success");
  assert.equal(typeof stopEnvelope.value, "object");
  const stopReceipt = stopEnvelope.value;
  assert.equal(stopReceipt.status, "ended");
  assert.ok(stopReceipt.connectedAt);
  await client.mutation(api.sendMessage, { token: tokenA, conversationId, text: "Synthetic local chat check" });
  const connected = (await client.query(api.snapshot, { token: tokenB, eventId })).conversations[0];
  assert.equal(connected.consentMode, "event");
  assert.equal(connected.captureSource, "glasses");
  assert.ok(connected.connectedAt);
  assert.equal(connected.exchangeConsent.length, 2);
  assert.equal(connected.messages[0].senderId, a);
  await assert.rejects(client.mutation(api.sendMessage, { token: outsider, conversationId, text: "Blocked" }));
  // No audio is uploaded, so this exercises the event connection without a model call.
  await client.mutation(api.setEventPermission, { token: tokenB, eventId, enabled: false });
  assert.equal((await client.query(api.snapshot, { token: tokenA, eventId })).conversations[0].status, "cancelled");
  console.log("PASS: live local legacy flow, challenge/ACK leases, native raw HTTP, event-scoped opt-in, immutable glasses binding, global recorder ID, ready hint, finish connection, shared chat, outsider rejection, and revocation. No audio/model calls.");
} finally {
  if (conversationId) await client.mutation(api.deleteConversation, { token: tokenA, conversationId });
}

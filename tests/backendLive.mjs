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
  await client.mutation(api.stop, { token: tokenB, conversationId });
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
  console.log("PASS: live local registration, pairing, outsider rejection, two-person consent, challenge/ACK presence, lease, partner stop, single-consent sharing block, raw HTTP contract.");
} finally {
  if (conversationId) await client.mutation(api.deleteConversation, { token: tokenA, conversationId });
}

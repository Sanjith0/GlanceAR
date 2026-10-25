import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { FACE_MODEL, FACE_SCAN_POLICY_VERSION, SIGHTING_WINDOW_MS } from "../src/domain";
import { matchDescriptor } from "../src/face";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
};
const api = anyApi.glance;
const tokens = ["a", "b", "c", "d"].map((c) => c.repeat(64));
const photoUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cXuoAAAAASUVORK5CYII=";
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type Test = ReturnType<typeof makeTest>;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

/** Deterministic stand-in descriptors: one base face per person, small noise per sample. */
function face(person: number, sample = 0): number[] {
  let seed = person * 7919 + 1;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const base = Array.from({ length: 128 }, () => (next() - 0.5) * 0.18);
  let noise = person * 104729 + sample * 31 + 7;
  return base.map((x) => { noise = (noise * 48271) % 2147483647; return x + (noise / 2147483647 - 0.5) * 0.02; });
}
const scan = (person: number) => ({ model: FACE_MODEL, policyVersion: FACE_SCAN_POLICY_VERSION, descriptors: [0, 1, 2].map((i) => face(person, i)) });

async function setup(t: Test) {
  const [a, b, c, outsider] = await Promise.all(tokens.map((token, i) =>
    t.mutation(api.register, { token, name: `Person ${i}`, role: "Builder", photoUrl })));
  const eventId = await t.mutation(api.createEvent, { token: tokens[0], title: "Face event", location: "Austin" });
  const { event } = await t.query(api.snapshot, { token: tokens[0], eventId });
  await t.mutation(api.joinEvent, { token: tokens[1], inviteCode: event.inviteCode });
  for (const token of tokens.slice(0, 2)) await t.mutation(api.setEventPermission, { token, eventId, enabled: true });
  return { a, b, c, outsider, eventId, inviteCode: event.inviteCode };
}
const directory = (t: Test, i: number, eventId: string) => t.query(api.faceDirectory, { token: tokens[i], eventId });
const ids = async (t: Test, i: number, eventId: string) =>
  (await directory(t, i, eventId)).templates.map((x: { profileId: string }) => x.profileId).sort();

describe("face scans", () => {
  it("rejects scans from another model, without current consent, or malformed", async () => {
    const t = makeTest();
    await setup(t);
    await expect(t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0), model: "other" })).rejects.toThrow(/unsupported model/);
    await expect(t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0), policyVersion: "old" })).rejects.toThrow(/face scan terms/);
    await expect(t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0), descriptors: [face(0).slice(1)] })).rejects.toThrow(/incomplete/);
    await expect(t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0), descriptors: [face(0).map(() => 2)] })).rejects.toThrow(/incomplete/);
    await expect(t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0), descriptors: [0, 1, 2, 3].map((i) => face(0, i)) })).rejects.toThrow(/incomplete/);
  });

  it("stays in sync as attendees scan, join, enable, pause, rescan and delete", async () => {
    const t = makeTest();
    const s = await setup(t);
    expect(await ids(t, 0, s.eventId)).toEqual([]);
    await t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0) });
    // The viewer's own scan is included so LIVE Camera can label them "You".
    expect(await ids(t, 0, s.eventId)).toEqual([s.a]);
    expect(await ids(t, 1, s.eventId)).toEqual([s.a]);
    await t.mutation(api.saveFaceScan, { token: tokens[1], ...scan(1) });
    expect(await ids(t, 0, s.eventId)).toEqual([s.a, s.b].sort());

    // A new attendee becomes recognizable the moment they join, enable and scan.
    await t.mutation(api.saveFaceScan, { token: tokens[2], ...scan(2) });
    await t.mutation(api.joinEvent, { token: tokens[2], inviteCode: s.inviteCode });
    expect(await ids(t, 0, s.eventId)).toEqual([s.a, s.b].sort());
    expect(await directory(t, 2, s.eventId)).toMatchObject({ enabled: false, scanned: true, templates: [] });
    await t.mutation(api.setEventPermission, { token: tokens[2], eventId: s.eventId, enabled: true });
    expect(await ids(t, 0, s.eventId)).toEqual([s.a, s.b, s.c].sort());
    expect(await ids(t, 2, s.eventId)).toEqual([s.a, s.b, s.c].sort());

    // Every synced template still identifies its owner and nobody else.
    const synced = (await directory(t, 0, s.eventId)).templates;
    for (const [person, id] of [[0, s.a], [1, s.b], [2, s.c]] as const) {
      expect(matchDescriptor(face(person, 9), synced)?.profileId).toBe(id);
    }
    expect(matchDescriptor(face(3, 0), synced)).toBeNull();

    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    expect(await ids(t, 0, s.eventId)).toEqual([s.a, s.c].sort());
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: true });
    await t.mutation(api.saveFaceScan, { token: tokens[1], ...scan(3) });
    expect((await directory(t, 0, s.eventId)).templates.find((x: { profileId: string }) => x.profileId === s.b).descriptors[0][0])
      .toBeCloseTo(face(3, 0)[0], 4);
    await t.mutation(api.deleteFaceScan, { token: tokens[2] });
    expect(await ids(t, 0, s.eventId)).toEqual([s.a, s.b].sort());
  });

  it("withholds templates from viewers who have not enabled Glance and from non-members", async () => {
    const t = makeTest();
    const s = await setup(t);
    await t.mutation(api.saveFaceScan, { token: tokens[1], ...scan(1) });
    await t.mutation(api.setEventPermission, { token: tokens[0], eventId: s.eventId, enabled: false });
    expect(await directory(t, 0, s.eventId)).toMatchObject({ enabled: false, templates: [] });
    await expect(directory(t, 3, s.eventId)).rejects.toThrow(/Event unavailable/);
  });
});

describe("mutual recognition", () => {
  async function scanned(t: Test) {
    const s = await setup(t);
    for (const i of [0, 1]) await t.mutation(api.saveFaceScan, { token: tokens[i], ...scan(i) });
    return s;
  }
  const sight = (t: Test, i: number, eventId: string, seenId: string) =>
    t.mutation(api.reportSighting, { token: tokens[i], eventId, seenId });

  it("pairs only after both phones recognize each other, then opens one shared conversation", async () => {
    const t = makeTest();
    const s = await scanned(t);
    expect(await sight(t, 0, s.eventId, s.b)).toEqual({ status: "waiting" });
    expect(await sight(t, 0, s.eventId, s.b)).toEqual({ status: "waiting" });
    expect((await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId })).conversations).toEqual([]);
    vi.advanceTimersByTime(3_000);
    const paired = await sight(t, 1, s.eventId, s.a);
    expect(paired.status).toBe("paired");
    for (const i of [0, 1]) {
      const [c] = (await t.query(api.snapshot, { token: tokens[i], eventId: s.eventId })).conversations;
      expect(c).toMatchObject({ id: paired.conversationId, consentMode: "event", status: "consent", recorderId: s.b });
      expect([...c.recordingConsent].sort()).toEqual([s.a, s.b].sort());
    }
    // The other phone's next report lands on the same conversation, never a second one.
    expect(await sight(t, 0, s.eventId, s.b)).toEqual({ status: "busy", conversationId: paired.conversationId });
    expect(await t.run((ctx) => ctx.db.query("conversations").collect())).toHaveLength(1);
  });

  it("does not pair on stale one-sided sightings, and the sweep removes them", async () => {
    const t = makeTest();
    const s = await scanned(t);
    await sight(t, 0, s.eventId, s.b);
    vi.advanceTimersByTime(SIGHTING_WINDOW_MS + 1);
    expect(await sight(t, 1, s.eventId, s.a)).toEqual({ status: "waiting" });
    vi.advanceTimersByTime(SIGHTING_WINDOW_MS + 1);
    await t.mutation(anyApi.jobs.sweep, {});
    expect(await t.run((ctx) => ctx.db.query("sightings").collect())).toEqual([]);
  });

  it("requires both face scans, both event grants, and another person", async () => {
    const t = makeTest();
    const s = await setup(t);
    await t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0) });
    await expect(sight(t, 0, s.eventId, s.b)).rejects.toThrow(/no longer has a face scan/);
    await expect(sight(t, 1, s.eventId, s.a)).rejects.toThrow(/Add your own face scan/);
    await expect(sight(t, 0, s.eventId, s.a)).rejects.toThrow(/your own face scan/);
    await t.mutation(api.saveFaceScan, { token: tokens[1], ...scan(1) });
    await t.mutation(api.setEventPermission, { token: tokens[1], eventId: s.eventId, enabled: false });
    await expect(sight(t, 0, s.eventId, s.b)).rejects.toThrow(/Glance on/);
  });

  it("deleting a scan withdraws pending sightings so they cannot complete a pairing", async () => {
    const t = makeTest();
    const s = await scanned(t);
    await sight(t, 0, s.eventId, s.b);
    await t.mutation(api.deleteFaceScan, { token: tokens[0] });
    await t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0) });
    expect(await sight(t, 1, s.eventId, s.a)).toEqual({ status: "waiting" });
  });
});

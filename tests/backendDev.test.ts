import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { FACE_MODEL, FACE_SCAN_POLICY_VERSION, type DevOverview } from "../src/domain";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
  "../convex/dev.ts": () => import("../convex/dev"),
};
const api = anyApi.glance, dev = anyApi.dev;
const tokens = ["a", "b", "c"].map((c) => c.repeat(64));
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type Test = ReturnType<typeof makeTest>;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  vi.stubEnv("GLANCE_DEV_TOOLS", "enabled");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

/** Deterministic stand-in descriptors: one base face per person, small noise per sample. */
function face(person: number, sample = 0): number[] {
  let seed = person * 7919 + 1;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const base = Array.from({ length: 128 }, () => (next() - 0.5) * 0.18);
  let noise = person * 104729 + sample * 31 + 7;
  return base.map((x) => { noise = (noise * 48271) % 2147483647; return x + (noise / 2147483647 - 0.5) * 0.02; });
}
const scan = (person: number, samples = 3) => ({
  model: FACE_MODEL, policyVersion: FACE_SCAN_POLICY_VERSION,
  descriptors: Array.from({ length: samples }, (_, i) => face(person, i)),
});
const added = (person: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ ...scan(person), name, role: "Guest", photoUrl: "", agreed: true, ...extra });

/** Two device accounts in one event with Glance on; the first has a face scan. */
async function setup(t: Test) {
  const [a, b] = await Promise.all(tokens.slice(0, 2).map((token, i) =>
    t.mutation(api.register, { token, name: `Device ${i}`, role: "Builder", photoUrl: "" })));
  const eventId: string = await t.mutation(api.createEvent, { token: tokens[0], title: "Dev event", location: "Austin" });
  const { event } = await t.query(api.snapshot, { token: tokens[0], eventId });
  await t.mutation(api.joinEvent, { token: tokens[1], inviteCode: event.inviteCode });
  for (const token of tokens.slice(0, 2)) await t.mutation(api.setEventPermission, { token, eventId, enabled: true });
  await t.mutation(api.saveFaceScan, { token: tokens[0], ...scan(0) });
  return { a: a as string, b: b as string, eventId };
}
const overview = (t: Test): Promise<DevOverview> => t.query(dev.overview, {});

describe("Dev tools switch", () => {
  it("refuses every function unless the backend switch is on", async () => {
    const t = makeTest();
    const s = await setup(t);
    for (const value of ["", "disabled", "true", "ENABLED"]) {
      vi.stubEnv("GLANCE_DEV_TOOLS", value);
      const calls = [
        t.query(dev.overview, {}),
        t.mutation(dev.addProfile, added(5, "Nobody")),
        t.mutation(dev.updateProfile, { profileId: s.a, name: "X", role: "" }),
        t.mutation(dev.saveScan, { ...scan(1), profileId: s.a, agreed: true }),
        t.mutation(dev.deleteScan, { profileId: s.a }),
        t.mutation(dev.deleteProfile, { profileId: s.a }),
        t.mutation(dev.setEvent, { profileId: s.a, eventId: s.eventId, member: true }),
      ];
      for (const call of calls) await expect(call).rejects.toThrow(/Dev tools are off/);
    }
    vi.stubEnv("GLANCE_DEV_TOOLS", "enabled");
    // Nothing was changed while it was off.
    expect((await overview(t)).people).toEqual([expect.objectContaining({ name: "Device 0", scan: expect.objectContaining({ samples: 3 }) })]);
  });
});

describe("Dev tab face scans", () => {
  it("lists every scan with its owner, sample count and events, without descriptors or photos", async () => {
    const t = makeTest();
    const s = await setup(t);
    const view = await overview(t);
    expect(view.truncated).toBe(false);
    expect(view.events).toEqual([{ id: s.eventId, title: "Dev event" }]);
    expect(view.people).toEqual([{
      id: s.a, name: "Device 0", role: "Builder", managed: false,
      scan: { samples: 3, consentedAt: expect.any(Number), current: true },
      events: [{ id: s.eventId, title: "Dev event", recognized: true }],
    }]);
    expect(JSON.stringify(view)).not.toMatch(/descriptors|photoUrl|tokenHash/);
  });

  it("adds a profile with a scan that an event’s LIVE Camera then recognizes, without a recording grant", async () => {
    const t = makeTest();
    const s = await setup(t);
    await expect(t.mutation(dev.addProfile, added(5, "Guest Five", { agreed: false }))).rejects.toThrow(/agreed/);
    const guest: string = await t.mutation(dev.addProfile, added(5, "Guest Five", { eventId: s.eventId, descriptors: scan(5, 14).descriptors }));

    const directory = await t.query(api.faceDirectory, { token: tokens[1], eventId: s.eventId });
    expect(directory.templates.map((x: { profileId: string }) => x.profileId).sort()).toEqual([s.a, guest].sort());

    const snapshot = await t.query(api.snapshot, { token: tokens[1], eventId: s.eventId });
    const member = snapshot.members.find((p: { id: string }) => p.id === guest);
    expect(member).toMatchObject({ name: "Guest Five", managed: true, glanceEnabled: false });

    // No device, no standing permission: nothing can pair with them or record them.
    await t.mutation(api.saveFaceScan, { token: tokens[1], ...scan(1) });
    await expect(t.mutation(api.reportSighting, { token: tokens[1], eventId: s.eventId, seenId: guest })).rejects.toThrow(/Glance on/);
    await expect(t.mutation(api.createConversation, { token: tokens[1], eventId: s.eventId, partnerId: guest, mode: "event" })).rejects.toThrow();

    const listed = (await overview(t)).people.find((p) => p.id === guest)!;
    expect(listed).toMatchObject({ managed: true, scan: { samples: 14, current: true }, events: [{ id: s.eventId, recognized: true }] });
  });

  it("gives a Dev-added profile a credential nobody can sign in with", async () => {
    const t = makeTest();
    await setup(t);
    const guest: string = await t.mutation(dev.addProfile, added(5, "Guest Five"));
    const row = await t.run((ctx) => ctx.db.get(guest as never)) as { tokenHash: string; managedBy: string };
    expect(row.managedBy).toBe("dev");
    expect(row.tokenHash).toBe(`managed:${guest}`);
    expect(row.tokenHash).not.toMatch(/^[a-f0-9]{64}$/); // a device token always hashes to 64 hex characters
  });

  it("refuses a face that already matches someone else, and malformed scans", async () => {
    const t = makeTest();
    await setup(t);
    await expect(t.mutation(dev.addProfile, added(0, "Copy of Device 0"))).rejects.toThrow(/already matches Device 0/);
    await expect(t.mutation(dev.addProfile, added(5, "Bad", { model: "other" }))).rejects.toThrow(/unsupported model/);
    await expect(t.mutation(dev.addProfile, added(5, "Bad", { descriptors: [] }))).rejects.toThrow(/incomplete/);
    await expect(t.mutation(dev.addProfile, added(5, "  "))).rejects.toThrow(/name/);
    expect((await overview(t)).people).toHaveLength(1);
  });

  it("renames and rescans only Dev-added profiles", async () => {
    const t = makeTest();
    const s = await setup(t);
    const guest: string = await t.mutation(dev.addProfile, added(5, "Guest Five"));
    await t.mutation(dev.updateProfile, { profileId: guest, name: " Renamed Guest ", role: "Speaker" });
    await t.mutation(dev.saveScan, { ...scan(6, 6), profileId: guest, agreed: true });
    expect((await overview(t)).people.find((p) => p.id === guest)).toMatchObject({ name: "Renamed Guest", role: "Speaker", scan: { samples: 6 } });
    // A rescan may match their own old scan, but not another person's.
    await t.mutation(dev.saveScan, { ...scan(6), profileId: guest, agreed: true });
    await expect(t.mutation(dev.saveScan, { ...scan(0), profileId: guest, agreed: true })).rejects.toThrow(/already matches/);

    await expect(t.mutation(dev.updateProfile, { profileId: s.a, name: "Hijacked", role: "" })).rejects.toThrow(/own device/);
    await expect(t.mutation(dev.saveScan, { ...scan(7), profileId: s.a, agreed: true })).rejects.toThrow(/own device/);
    await expect(t.mutation(dev.deleteProfile, { profileId: s.a })).rejects.toThrow(/own device/);
    await expect(t.mutation(dev.setEvent, { profileId: s.a, eventId: s.eventId, member: false })).rejects.toThrow(/own device/);
    expect((await overview(t)).people.find((p) => p.id === s.a)).toMatchObject({ name: "Device 0", scan: { samples: 3 } });
  });

  it("moves a Dev-added profile in and out of an event", async () => {
    const t = makeTest();
    const s = await setup(t);
    const guest: string = await t.mutation(dev.addProfile, added(5, "Guest Five"));
    const recognized = async () => (await t.query(api.faceDirectory, { token: tokens[0], eventId: s.eventId }))
      .templates.some((x: { profileId: string }) => x.profileId === guest);
    expect(await recognized()).toBe(false);
    await t.mutation(dev.setEvent, { profileId: guest, eventId: s.eventId, member: true });
    await t.mutation(dev.setEvent, { profileId: guest, eventId: s.eventId, member: true }); // twice is harmless
    expect(await recognized()).toBe(true);
    await t.mutation(dev.setEvent, { profileId: guest, eventId: s.eventId, member: false });
    expect(await recognized()).toBe(false);
  });

  it("deletes anyone’s scan, and removes a Dev-added profile completely", async () => {
    const t = makeTest();
    const s = await setup(t);
    const guest: string = await t.mutation(dev.addProfile, added(5, "Guest Five", { eventId: s.eventId }));

    await t.mutation(dev.deleteScan, { profileId: s.a });
    const afterScan = await overview(t);
    expect(afterScan.people.map((p) => p.id)).toEqual([guest]); // Device 0 keeps its profile but has no scan to list
    expect((await t.query(api.snapshot, { token: tokens[0] })).me.name).toBe("Device 0");

    await t.mutation(dev.deleteScan, { profileId: guest });
    expect((await overview(t)).people).toEqual([expect.objectContaining({ id: guest, scan: null, managed: true })]);

    await t.mutation(dev.deleteProfile, { profileId: guest });
    expect((await overview(t)).people).toEqual([]);
    const snapshot = await t.query(api.snapshot, { token: tokens[0], eventId: s.eventId });
    expect(snapshot.members.some((p: { id: string }) => p.id === guest)).toBe(false);
    const left = await t.run(async (ctx) => ({
      memberships: (await ctx.db.query("memberships").collect()).length,
      templates: (await ctx.db.query("faceTemplates").collect()).length,
    }));
    expect(left).toEqual({ memberships: 2, templates: 0 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import {
  externalJoinHref, externalKey, parseExternalJoin, peekPendingJoin, setPendingJoin, takePendingJoin, validExternalId,
} from "../src/externalJoin";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
};
const api = anyApi.glance;
const tokens = ["a", "b", "c"].map((c) => c.repeat(64));
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type Test = ReturnType<typeof makeTest>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("join link", () => {
  it("reads a well-formed link", () => {
    expect(parseExternalJoin({ source: "metaintros", id: "ev-indie-guild", title: "Indie Night", place: "The Guild", name: "Jordan Lee" }))
      .toEqual({ source: "metaintros", externalId: "ev-indie-guild", title: "Indie Night", location: "The Guild", name: "Jordan Lee" });
    expect(parseExternalJoin({ source: "metaintros", id: "ev-1", title: "Indie Night" }))
      .toEqual({ source: "metaintros", externalId: "ev-1", title: "Indie Night", location: "" });
  });

  it("does nothing for a link that names another source, a bad id or no title", () => {
    expect(parseExternalJoin({ source: "elsewhere", id: "ev-1", title: "X" })).toBeNull();
    expect(parseExternalJoin({ id: "ev-1", title: "X" })).toBeNull();
    expect(parseExternalJoin({ source: "metaintros", id: "ev 1", title: "X" })).toBeNull();
    expect(parseExternalJoin({ source: "metaintros", id: "../etc", title: "X" })).toBeNull();
    expect(parseExternalJoin({ source: "metaintros", id: "e".repeat(65), title: "X" })).toBeNull();
    expect(parseExternalJoin({ source: "metaintros", id: "ev-1", title: "   " })).toBeNull();
    expect(parseExternalJoin({ source: "metaintros", id: "ev-1", title: 7 })).toBeNull();
    expect(parseExternalJoin({})).toBeNull();
  });

  it("tidies and limits what the link carries", () => {
    const join = parseExternalJoin({
      source: ["metaintros", "x"], id: "ev-1", title: `  Indie\n\tNight  ${"x".repeat(200)}`, place: "p".repeat(300), name: "n".repeat(200),
    })!;
    expect(join.title.startsWith("Indie Night x")).toBe(true);
    expect(join.title.length).toBe(100);
    expect(join.location.length).toBe(160);
    expect(join.name!.length).toBe(80);
  });

  it("round-trips through its own link, and keys one Glance event per outside event", () => {
    const join = parseExternalJoin({ source: "metaintros", id: "ev-indie-guild", title: "Indie Night: Local & Loud", place: "The Guild, Menlo Park", name: "Jordan" })!;
    const href = externalJoinHref(join);
    expect(href.startsWith("/join?")).toBe(true);
    expect(parseExternalJoin(Object.fromEntries(new URLSearchParams(href.split("?")[1])))).toEqual(join);
    expect(externalKey("metaintros", "ev-indie-guild")).toBe("metaintros:ev-indie-guild");
    expect(validExternalId("ev_indie-1")).toBe(true);
    expect(validExternalId("")).toBe(false);
  });

  it("remembers a join across signing up, once", () => {
    const join = parseExternalJoin({ source: "metaintros", id: "ev-1", title: "Indie Night" })!;
    setPendingJoin(join);
    expect(peekPendingJoin()).toEqual(join);
    expect(takePendingJoin()).toEqual(join);
    expect(takePendingJoin()).toBeNull();
  });
});

describe("joining a Glance event from another app's event", () => {
  const register = (t: Test) => Promise.all(tokens.map((token, i) =>
    t.mutation(api.register, { token, name: `Person ${i}`, role: "", photoUrl: "" })));
  const join = (t: Test, i: number, extra: Record<string, unknown> = {}) => t.mutation(api.joinExternalEvent, {
    token: tokens[i], source: "metaintros", externalId: "ev-indie-guild", title: "Indie Night", location: "The Guild", ...extra,
  });

  it("creates the event on first use and brings everyone else into the same one", async () => {
    const t = makeTest();
    await register(t);
    const first: string = await join(t, 0);
    const second: string = await join(t, 1, { title: "A different title", location: "Somewhere else" });
    expect(second).toBe(first);
    expect(await join(t, 0)).toBe(first); // joining again is harmless
    const snapshot = await t.query(api.snapshot, { token: tokens[1], eventId: first });
    expect(snapshot.event).toMatchObject({ title: "Indie Night", location: "The Guild" }); // the first link named it
    expect(snapshot.members.map((p: { name: string }) => p.name).sort()).toEqual(["Person 0", "Person 1"]);
    expect(snapshot.event.inviteCode).toMatch(/^[A-Z2-9]{4}$/);
    const rows = await t.run(async (ctx) => ({
      events: (await ctx.db.query("events").collect()).length,
      memberships: (await ctx.db.query("memberships").collect()).length,
    }));
    expect(rows).toEqual({ events: 1, memberships: 2 });
  });

  it("keeps separate outside events separate, and its own events untouched", async () => {
    const t = makeTest();
    await register(t);
    const own: string = await t.mutation(api.createEvent, { token: tokens[0], title: "Indie Night", location: "The Guild" });
    const a: string = await join(t, 0);
    const b: string = await join(t, 0, { externalId: "ev-vinyl-swap", title: "Vinyl Swap" });
    expect(new Set([own, a, b]).size).toBe(3);
  });

  it("refuses an unknown source, a malformed id, an empty title, and a device that has not signed up", async () => {
    const t = makeTest();
    await register(t);
    await expect(join(t, 0, { source: "elsewhere" })).rejects.toThrow(/not valid/);
    await expect(join(t, 0, { externalId: "ev 1" })).rejects.toThrow(/not valid/);
    await expect(join(t, 0, { title: "  " })).rejects.toThrow(/title/);
    await expect(join(t, 0, { title: "x".repeat(101) })).rejects.toThrow(/title/);
    await expect(t.mutation(api.joinExternalEvent, { token: "f".repeat(64), source: "metaintros", externalId: "ev-1", title: "X", location: "" }))
      .rejects.toThrow(/not registered/);
    expect(await t.run(async (ctx) => (await ctx.db.query("events").collect()).length)).toBe(0);
  });

  it("says so when the Glance event is full", async () => {
    const t = makeTest();
    await register(t);
    const eventId: string = await join(t, 0);
    await t.run(async (ctx) => {
      for (let i = 0; i < 23; i++) {
        const profileId = await ctx.db.insert("profiles", { tokenHash: `filler-${i}`, name: `Filler ${i}`, role: "", photoUrl: "" });
        await ctx.db.insert("memberships", { eventId: eventId as never, profileId });
      }
    });
    await expect(join(t, 1)).rejects.toThrow(/full/);
    expect(await join(t, 0)).toBe(eventId); // someone already in is not turned away
  });
});

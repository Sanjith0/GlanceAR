import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import {
  claimConversationOpen, conversationOpened, conversationToOpen, markConversationOpened, resetConversationOpens,
} from "../src/conversationOpen";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
};
const api = anyApi.glance;
const tokens = ["a", "b", "c"].map((c) => c.repeat(64));
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-13T15:00:00Z")); resetConversationOpens(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("who opens a conversation's screen", () => {
  const active = { id: "c1", eventId: "e1" };

  it("pulls a person in from any screen that is not already handling it", () => {
    for (const pathname of ["/events", "/connections", "/profile", "/register/e1", "/dev", "/conversation/older", "/event/e1", "/live/another-event"]) {
      resetConversationOpens();
      expect(conversationToOpen(active, pathname), pathname).toBe("/conversation/c1");
    }
  });

  it("leaves LIVE Camera for the same event to open it itself, so the camera carries over", () => {
    expect(conversationToOpen(active, "/live/e1")).toBeNull();
    expect(conversationOpened("c1")).toBe(false);
  });

  it("opens a conversation once: no second screen, and no dragging back after leaving", () => {
    expect(conversationToOpen(active, "/events")).toBe("/conversation/c1");
    expect(conversationToOpen(active, "/events")).toBeNull();
    expect(conversationToOpen(active, "/connections")).toBeNull();
  });

  it("does nothing while its screen is showing, and remembers that it was", () => {
    expect(conversationToOpen(active, "/conversation/c1")).toBeNull();
    expect(conversationToOpen(active, "/events")).toBeNull();
  });

  it("lets only the first of several navigators through", () => {
    expect(claimConversationOpen("c2")).toBe(true);
    expect(claimConversationOpen("c2")).toBe(false);
    markConversationOpened("c3");
    expect(claimConversationOpen("c3")).toBe(false);
    expect(conversationToOpen({ id: "c3", eventId: "e1" }, "/events")).toBeNull();
    expect(conversationToOpen(undefined, "/events")).toBeNull();
  });
});

describe("starting a conversation from one side", () => {
  async function setup() {
    const t = makeTest();
    const ids: string[] = await Promise.all(tokens.map((token, i) => t.mutation(api.register, { token, name: `Person ${i}`, role: "", photoUrl: "" })));
    const eventId: string = await t.mutation(api.createEvent, { token: tokens[0], title: "Mixer", location: "" });
    const { event } = await t.query(api.snapshot, { token: tokens[0], eventId });
    for (const token of tokens.slice(1)) await t.mutation(api.joinEvent, { token, inviteCode: event.inviteCode });
    for (const token of tokens) await t.mutation(api.setEventPermission, { token, eventId, enabled: true });
    return { t, ids, eventId };
  }
  const start = (t: ReturnType<typeof makeTest>, by: number, eventId: string, partnerId: string) =>
    t.mutation(api.createConversation, { token: tokens[by], eventId, partnerId, mode: "event" });

  it("needs no sighting from the other person, and both of them then have it", async () => {
    const { t, ids, eventId } = await setup();
    const conversationId: string = await start(t, 0, eventId, ids[1]);
    for (const token of tokens.slice(0, 2)) {
      const snapshot = await t.query(api.snapshot, { token });
      expect(snapshot.conversations.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual([[conversationId, "consent"]]);
    }
    expect((await t.query(api.snapshot, { token: tokens[2] })).conversations).toEqual([]);
  });

  it("gives the same conversation when either of the two starts it again", async () => {
    const { t, ids, eventId } = await setup();
    const first: string = await start(t, 0, eventId, ids[1]);
    expect(await start(t, 0, eventId, ids[1])).toBe(first);
    expect(await start(t, 1, eventId, ids[0])).toBe(first); // the other person tapping their arrow too
    expect(await t.run(async (ctx) => (await ctx.db.query("conversations").collect()).length)).toBe(1);
  });

  it("says who is busy when one of them is already talking to someone else", async () => {
    const { t, ids, eventId } = await setup();
    await start(t, 0, eventId, ids[1]);
    await expect(start(t, 2, eventId, ids[1])).rejects.toThrow(/They are already in a conversation with someone else/);
    await expect(start(t, 0, eventId, ids[2])).rejects.toThrow(/You are already in a conversation/);
  });
});

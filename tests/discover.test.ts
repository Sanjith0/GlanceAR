import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { MUSE_MODEL, discoverError, validateScreenshot } from "../convex/meta";
import { DISCOVER_DAILY_LIMIT } from "../convex/discoverData";
import {
  DISCOVER_CATEGORIES, DISCOVER_EVENTS, SAMPLE_SIGNALS, basicRecommend, cleanInterests, eventDate, eventWhen,
  signalsKey, splitInterests, upcoming, validatePicks,
} from "../src/discover/catalog";
import { NO_PROFILE_NOTICE, SAMPLE_NOTICE, rankForSession, rankKey, readScreenshot, type DiscoverSession } from "../src/discover/api";
import { addInterests, clearSignals, getDiscover, removeInterest, resetDiscover, setDiscover, toggleRsvp } from "../src/discover/store";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
  "../convex/discover.ts": () => import("../convex/discover"),
  "../convex/discoverData.ts": () => import("../convex/discoverData"),
};
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
const token = "a".repeat(64);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const BASE = "http://meta.test";
type Call = { url: string; init: RequestInit & { headers: Record<string, string> }; body: any };

/** A stand-in for Meta's chat completions endpoint that records every request. */
function provider(reply: (call: Call) => unknown | Response) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: Call["init"]) => {
    const call = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const value = reply(call);
    return value instanceof Response ? value : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
async function registered(intro = "Builder · human-centered AI") {
  const t = makeTest();
  await t.mutation(anyApi.glance.register, { token, name: "Alex Chen", role: intro, photoUrl: "" });
  return t;
}
const configure = () => { vi.stubEnv("META_API_KEY", "test-key"); vi.stubEnv("META_API_BASE_URL", BASE); };
const picksReply = { picks: [
  { eventId: "beginner-bouldering-social", score: 96, reason: "You watch a lot of bouldering, and this night pairs first-timers with regulars." },
  { eventId: "specialty-coffee-cupping", score: 88.4, reason: "Your espresso habit meets six single-origin coffees." },
] };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T15:00:00Z")); resetDiscover(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sample catalog", () => {
  it("has unique, well-formed sample events in every category", () => {
    expect(new Set(DISCOVER_EVENTS.map((e) => e.id)).size).toBe(DISCOVER_EVENTS.length);
    for (const e of DISCOVER_EVENTS) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(DISCOVER_CATEGORIES).toContain(e.category);
      expect(e.time).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
      expect(e.weekday).toBeGreaterThanOrEqual(0); expect(e.weekday).toBeLessThanOrEqual(6);
      expect(e.tags.length).toBeGreaterThanOrEqual(4);
      for (const tag of e.tags) expect(tag).toBe(tag.toLowerCase().trim());
      expect(e.cover.from).toMatch(/^#[0-9A-F]{6}$/); expect(e.cover.to).toMatch(/^#[0-9A-F]{6}$/);
      expect(e.title.length).toBeLessThanOrEqual(100);
      expect(`${e.venue}, ${e.area}`.length).toBeLessThanOrEqual(160);
      expect(e.blurb.length).toBeGreaterThan(30);
    }
    for (const category of DISCOVER_CATEGORIES) expect(DISCOVER_EVENTS.some((e) => e.category === category)).toBe(true);
  });
  it("always dates events on their weekday within the next two weeks, soonest first", () => {
    const now = new Date(2026, 10, 11, 9, 0); // Wednesday
    for (const e of DISCOVER_EVENTS) {
      const date = eventDate(e, now);
      const days = Math.round((date.getTime() - new Date(2026, 10, 11).getTime()) / 86_400_000);
      expect(date.getDay()).toBe(e.weekday);
      expect(days).toBeGreaterThanOrEqual(e.week * 7); expect(days).toBeLessThan(7 + e.week * 7);
    }
    const order = upcoming(now).map((e) => eventDate(e, now).getTime());
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const wednesday = DISCOVER_EVENTS.find((e) => e.weekday === 3 && e.week === 0)!;
    const thursday = DISCOVER_EVENTS.find((e) => e.weekday === 4 && e.week === 0)!;
    const friday = DISCOVER_EVENTS.find((e) => e.weekday === 5 && e.week === 0)!;
    expect(eventWhen(wednesday, now)).toBe(`Today · ${wednesday.time}`);
    expect(eventWhen(thursday, now)).toBe(`Tomorrow · ${thursday.time}`);
    expect(eventWhen(friday, now)).toBe(`Fri, Nov 13 · ${friday.time}`);
  });
});

describe("signal hygiene", () => {
  it("trims, bounds and de-duplicates interests from any source", () => {
    expect(cleanInterests(["  Bouldering ", "#bouldering", "espresso\u0007 shots\n", "🔥", "x", 42, null, "a".repeat(80), "R&B / soul"]))
      .toEqual(["Bouldering", "espresso shots", "a".repeat(40), "R&B / soul"]);
    expect(cleanInterests(Array.from({ length: 60 }, (_, i) => `topic ${i}`))).toHaveLength(24);
    expect(cleanInterests("climbing")).toEqual([]);
    expect(splitInterests("climbing, espresso;live jazz\n climbing")).toEqual(["climbing", "espresso", "live jazz"]);
  });
  it("keeps only real, unique, bounded picks", () => {
    expect(validatePicks([
      { eventId: "ai-builders-demo-night", score: 140, reason: "  You  build\nwith agents. " },
      { eventId: "ai-builders-demo-night", score: 50, reason: "duplicate" },
      { eventId: "made-up-event", score: 90, reason: "invented" },
      { eventId: "sunset-yoga-park", score: Number.NaN, reason: "bad score" },
      { eventId: "sunset-yoga-park", score: 70, reason: "   " },
      { eventId: "film-photo-walk", score: -3, reason: "x".repeat(400) },
      "nonsense", null,
    ])).toEqual([
      { eventId: "ai-builders-demo-night", score: 100, reason: "You build with agents." },
      { eventId: "film-photo-walk", score: 0, reason: "x".repeat(180) },
    ]);
    expect(validatePicks(DISCOVER_EVENTS.map((e) => ({ eventId: e.id, score: 80, reason: "ok" })))).toHaveLength(6);
    expect(validatePicks({ picks: [] })).toEqual([]);
  });
});

describe("basic keyword match", () => {
  const rank = (interests: string[], intro = "") => basicRecommend({ interests, intro, summary: "" });
  it("puts a direct interest first and says which interest matched", () => {
    const { picks, source } = rank(["bouldering", "specialty coffee"]);
    expect(source).toBe("basic");
    expect(picks.slice(0, 2).map((p) => p.eventId).sort()).toEqual(["beginner-bouldering-social", "specialty-coffee-cupping"]);
    expect(picks[0].reason).toMatch(/^Matches your interest in (bouldering|specialty coffee)\.$/);
    for (const pick of picks) { expect(pick.score).toBeGreaterThan(0); expect(pick.score).toBeLessThanOrEqual(100); }
    expect(picks.length).toBeLessThanOrEqual(6);
  });
  it("matches whole words only, so AR is not art", () => {
    const ids = rank(["ar"]).picks.map((p) => p.eventId);
    expect(ids).toContain("smart-glasses-ar-hack-evening");
    expect(ids).not.toContain("design-district-gallery-night");
    expect(ids).not.toContain("film-photo-walk");
  });
  it("can rank from the Glance intro alone and returns nothing without signals", () => {
    const intro = rank([], "Builder · human-centered AI").picks;
    expect(intro[0]).toMatchObject({ eventId: "ai-builders-demo-night", reason: "Lines up with your Glance intro." });
    expect(rank([]).picks).toEqual([]);
    expect(rank(["underwater basket weaving"]).picks).toEqual([]);
  });
  it("gives the sample signals a full row of picks, one for each interest", () => {
    const picks = rank(SAMPLE_SIGNALS.interests).picks;
    expect(picks).toHaveLength(6);
    expect(new Set(picks.map((p) => p.reason)).size).toBe(6);
    expect(picks.map((p) => p.eventId)).toContain("beginner-bouldering-social");
    expect(picks.map((p) => p.score)).toEqual([...picks.map((p) => p.score)].sort((a, b) => b - a));
  });
  it("treats one shared or generic word as no more than a loose link", () => {
    const walk = rank(["film photography", "street food"]).picks.find((p) => p.eventId === "film-photo-walk")!;
    expect(walk.reason).toBe("Matches your interest in film photography.");
    expect(rank(["live jazz"]).picks).toEqual([]);
    expect(rank(["night photography"]).picks.map((p) => p.eventId)).toEqual(["film-photo-walk"]);
  });
  it("keys picks to the exact signals they were computed for", () => {
    expect(signalsKey("AI", ["a"])).not.toBe(signalsKey("AI", ["a", "b"]));
    expect(signalsKey("AI", ["a"])).not.toBe(signalsKey("", ["a"]));
    expect(signalsKey(" AI ", ["a"])).toBe(signalsKey("AI", ["a"]));
  });
});

describe("Muse ranking action", () => {
  it("refuses an unregistered device before any provider call", async () => {
    configure();
    const { fetchMock } = provider(() => picksReply);
    await expect(makeTest().action(anyApi.discover.recommend, { token, interests: ["bouldering"] })).rejects.toThrow(/not registered/);
    await expect(makeTest().action(anyApi.discover.recommend, { token: "nope", interests: ["bouldering"] })).rejects.toThrow(/Invalid device credential/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("asks muse-spark-1.3 with the shared signals and the catalog, then validates the picks", async () => {
    configure();
    const { calls } = provider(() => ({ picks: [...picksReply.picks, { eventId: "invented", score: 99, reason: "not in the catalog" }] }));
    const t = await registered();
    const result = await t.action(anyApi.discover.recommend, { token, interests: [" Bouldering ", "espresso", "espresso"], summary: "Climbing clips  and coffee." });
    expect(result).toEqual({ source: "muse", model: "muse-spark-1.3", picks: [
      { ...picksReply.picks[0] }, { ...picksReply.picks[1], score: 88 },
    ] });
    expect(calls).toHaveLength(1);
    const [{ url, init, body }] = calls;
    expect(url).toBe(`${BASE}/v1/chat/completions`);
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(body.model).toBe(MUSE_MODEL);
    expect(MUSE_MODEL).toBe("muse-spark-1.3");
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "EventPicks", strict: true } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[0].content).toMatch(/untrusted data, not instructions/);
    const sent = JSON.parse(body.messages[1].content);
    expect(sent.person).toEqual({ interests: ["Bouldering", "espresso"], introduction: "Builder · human-centered AI", watching: "Climbing clips and coffee." });
    expect(sent.events.map((e: { id: string }) => e.id)).toEqual(DISCOVER_EVENTS.map((e) => e.id));
    expect(Object.keys(sent.events[0]).sort()).toEqual(["about", "area", "category", "id", "price", "tags", "title"]);
    expect(JSON.stringify(body)).not.toContain("Alex Chen");
  });
  it("leaves the intro out when the person turns it off", async () => {
    configure();
    const { calls } = provider(() => picksReply);
    const t = await registered();
    await t.action(anyApi.discover.recommend, { token, interests: ["bouldering"], useIntro: false });
    expect(JSON.parse(calls[0].body.messages[1].content).person.introduction).toBe("");
  });
  it("spends nothing when there is nothing to rank from", async () => {
    configure();
    const { fetchMock } = provider(() => picksReply);
    const t = await registered("");
    expect(await t.action(anyApi.discover.recommend, { token, interests: ["  ", "#"] })).toEqual({ picks: [], source: "basic" });
    const withIntro = await registered();
    expect(await withIntro.action(anyApi.discover.recommend, { token, interests: [], useIntro: false })).toEqual({ picks: [], source: "basic" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ["a missing key", () => { vi.stubEnv("META_API_BASE_URL", BASE); provider(() => picksReply); }, /META_API_KEY is missing/, 0],
    ["a rejected key", () => { configure(); provider(() => new Response("secret provider body", { status: 401 })); }, /Meta rejected the API key/, 1],
    ["rate limiting", () => { configure(); provider(() => new Response("{}", { status: 429 })); }, /rate-limiting/, 1],
    ["a malformed reply", () => { configure(); provider(() => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))); }, /did not pass validation/, 1],
    ["only invented events", () => { configure(); provider(() => ({ picks: [{ eventId: "invented", score: 90, reason: "nope" }] })); }, /did not pass validation/, 1],
    ["an unreachable provider", () => { configure(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed"))); }, /could not reach Meta/, 1],
  ])("falls back to a labelled basic match on %s", async (_name, arrange, notice, providerCalls) => {
    arrange();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await registered();
    const result = await t.action(anyApi.discover.recommend, { token, interests: ["bouldering", "private-topic-xyz"] });
    expect(result.source).toBe("basic");
    expect(result.model).toBeUndefined();
    expect(result.notice).toMatch(notice);
    expect(result.notice).toMatch(/Showing a basic keyword match instead\.$/);
    expect(result.notice).not.toContain("secret provider body");
    expect(result.picks[0].eventId).toBe("beginner-bouldering-social");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(providerCalls);
    // Failures are logged by code only: no interests, keys or provider bodies.
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^Discover ranking failed: [A-Z0-9_]+$/);
  });
  it("rejects an oversized signal list before authenticating or calling out", async () => {
    configure();
    const { fetchMock } = provider(() => picksReply);
    const t = await registered();
    await expect(t.action(anyApi.discover.recommend, { token, interests: Array.from({ length: 61 }, (_, i) => `t${i}`) })).rejects.toThrow(/Too many signals/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Muse screenshot reading", () => {
  it("sends the screenshot to muse-spark-1.3 as a user image part and cleans what comes back", async () => {
    configure();
    const { calls } = provider(() => ({ interests: ["Bouldering", "#bouldering", "latte art", "  "], summary: " Climbing clips\nand coffee tutorials. " }));
    const t = await registered();
    expect(await t.action(anyApi.discover.readScreenshot, { token, image: PNG })).toEqual({
      interests: ["Bouldering", "latte art"], summary: "Climbing clips and coffee tutorials.",
    });
    const [{ url, init, body }] = calls;
    expect(url).toBe(`${BASE}/v1/chat/completions`);
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "SharedInterests", strict: true } });
    // Meta rejects images outside user messages, so the system message stays text.
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[0].content).toMatch(/health conditions, religion, politics/);
    expect(body.messages[1]).toEqual({ role: "user", content: [
      { type: "text", text: "Read the topics shown in this screenshot." },
      { type: "image_url", image_url: { url: PNG } },
    ] });
  });
  it("accepts only bounded JPEG, PNG or WebP data whose bytes match", () => {
    expect(() => validateScreenshot(PNG)).not.toThrow();
    expect(() => validateScreenshot("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).not.toThrow();
    for (const bad of [
      "", "https://example.com/a.png", "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,/9j/4AAQSkZJRg==", "data:image/jpeg;base64,iVBORw0KGgo=", "data:image/png;base64,iVBORw0KGgo<script>",
      `data:image/png;base64,iVBORw0KGgo${"A".repeat(2_000_000)}`,
    ]) expect(() => validateScreenshot(bad)).toThrow("INVALID_IMAGE");
  });
  it.each([
    ["an invalid image", "data:image/png;base64,/9j/4AAQ", () => picksReply, /JPEG, PNG or WebP screenshot/, 0],
    ["a screenshot with no interests", PNG, () => ({ interests: [], summary: "" }), /did not find any interests/, 1],
    ["an image Meta will not accept", PNG, () => new Response("secret provider body", { status: 400 }), /could not accept that image/, 1],
    ["a rejected key", PNG, () => new Response("secret provider body", { status: 403 }), /Meta rejected the API key/, 1],
  ])("reports %s without leaking the provider or the image", async (_name, image, reply, message, providerCalls) => {
    configure();
    const { fetchMock } = provider(reply);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await registered();
    const failure = await t.action(anyApi.discover.readScreenshot, { token, image }).then(() => null, (error: Error) => error);
    expect(failure?.message).toMatch(message);
    expect(failure?.message).not.toContain("secret provider body");
    expect(fetchMock).toHaveBeenCalledTimes(providerCalls);
    expect(String(log.mock.calls[0][0])).toMatch(/^Discover screenshot read failed: [A-Z0-9_]+$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain("base64");
  });
  it("needs a configured key and a registered device", async () => {
    const { fetchMock } = provider(() => ({ interests: ["a b"], summary: "" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(makeTest().action(anyApi.discover.readScreenshot, { token, image: PNG })).rejects.toThrow(/not registered/);
    const t = await registered();
    await expect(t.action(anyApi.discover.readScreenshot, { token, image: PNG })).rejects.toThrow(/META_API_KEY is missing/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps every failure code to a body-free sentence", () => {
    expect(discoverError(new Error("PICKS_NETWORK"))).toBe("The backend could not reach Meta.");
    expect(discoverError(new Error("Meta said: your key sk-123 is wrong"))).toBe("Muse could not finish that request.");
    expect(discoverError("boom")).toBe("Muse could not finish that request.");
  });
});

describe("daily Muse cap", () => {
  it("counts every Muse-backed call per profile per day and stores nothing else", async () => {
    configure();
    const { fetchMock } = provider((call) => call.body.response_format.json_schema.name === "EventPicks" ? picksReply : { interests: ["bouldering"], summary: "" });
    const t = await registered();
    for (let i = 0; i < DISCOVER_DAILY_LIMIT - 1; i++) await t.action(anyApi.discover.recommend, { token, interests: ["bouldering"] });
    await t.action(anyApi.discover.readScreenshot, { token, image: PNG });
    expect(fetchMock).toHaveBeenCalledTimes(DISCOVER_DAILY_LIMIT);
    await expect(t.action(anyApi.discover.recommend, { token, interests: ["bouldering"] })).rejects.toThrow(/today's limit/);
    await expect(t.action(anyApi.discover.readScreenshot, { token, image: PNG })).rejects.toThrow(/today's limit/);
    expect(fetchMock).toHaveBeenCalledTimes(DISCOVER_DAILY_LIMIT);
    const rows = await t.run((ctx) => ctx.db.query("discoverUsage").collect());
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["_creationTime", "_id", "count", "day", "profileId"]);
    expect(rows[0]).toMatchObject({ day: "2026-11-11", count: DISCOVER_DAILY_LIMIT });

    vi.setSystemTime(new Date("2026-11-12T00:00:05Z"));
    expect((await t.action(anyApi.discover.recommend, { token, interests: ["bouldering"] })).source).toBe("muse");
    const next = await t.run((ctx) => ctx.db.query("discoverUsage").collect());
    expect(next.map((row) => [row.day, row.count])).toEqual([["2026-11-12", 1]]);
  });
  it("keeps a separate count for each device", async () => {
    configure();
    provider(() => picksReply);
    const t = await registered();
    const other = "b".repeat(64);
    await t.mutation(anyApi.glance.register, { token: other, name: "Sam Rivera", role: "Designer", photoUrl: "" });
    await t.action(anyApi.discover.recommend, { token, interests: ["bouldering"] });
    await t.action(anyApi.discover.recommend, { token: other, interests: ["bouldering"] });
    await t.action(anyApi.discover.recommend, { token: other, interests: ["bouldering"] });
    const counts = (await t.run((ctx) => ctx.db.query("discoverUsage").collect())).map((row) => row.count).sort();
    expect(counts).toEqual([1, 2]);
  });
});

describe("in-memory Events state", () => {
  const session = (muse: DiscoverSession["muse"], intro = "Builder · human-centered AI"): DiscoverSession =>
    ({ muse, deploymentURL: muse === "sample" ? "" : "https://example.convex.cloud", token, intro });
  it("starts on the Glance face with nothing shared", () => {
    expect(getDiscover()).toMatchObject({ ui: "glance", interests: [], shared: "none", useIntro: true, rsvps: {}, recs: null, ranking: false });
  });
  it("collects, labels, removes and clears signals", () => {
    addInterests(["climbing", "Climbing", "espresso"]);
    expect(getDiscover()).toMatchObject({ interests: ["climbing", "espresso"], shared: "none" });
    addInterests(SAMPLE_SIGNALS.interests, { shared: "sample", summary: SAMPLE_SIGNALS.summary });
    expect(getDiscover().shared).toBe("sample");
    expect(getDiscover().interests).toHaveLength(2 + SAMPLE_SIGNALS.interests.length);
    removeInterest("espresso");
    expect(getDiscover().interests).not.toContain("espresso");
    setDiscover({ recs: { picks: [], source: "basic" }, recsKey: "k" });
    clearSignals();
    expect(getDiscover()).toMatchObject({ interests: [], summary: "", shared: "none", recs: null, recsKey: "" });
  });
  it("toggles an RSVP on, across and off", () => {
    toggleRsvp("film-photo-walk", "going");
    expect(getDiscover().rsvps).toEqual({ "film-photo-walk": "going" });
    toggleRsvp("film-photo-walk", "interested");
    expect(getDiscover().rsvps).toEqual({ "film-photo-walk": "interested" });
    toggleRsvp("film-photo-walk", "interested");
    expect(getDiscover().rsvps).toEqual({});
  });
  it("labels sample and no-profile rankings as basic matches and never calls a backend", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    addInterests(["bouldering"]);
    await rankForSession(session("sample"));
    expect(getDiscover()).toMatchObject({ ranking: false, recsKey: rankKey(session("sample")), recs: { source: "basic", notice: SAMPLE_NOTICE } });
    expect(getDiscover().recs!.picks[0].eventId).toBe("beginner-bouldering-social");
    await rankForSession(session("no-profile"));
    expect(getDiscover().recs).toMatchObject({ source: "basic", notice: NO_PROFILE_NOTICE });
    expect(rankKey(session("no-profile"))).not.toBe(rankKey(session("sample")));
    expect(network).not.toHaveBeenCalled();
  });
  it("clears picks when there is nothing to rank from", async () => {
    setDiscover({ recs: { picks: [], source: "basic" } });
    await rankForSession(session("sample", ""));
    expect(getDiscover()).toMatchObject({ recs: null, ranking: false });
    setDiscover({ useIntro: false, recs: { picks: [], source: "basic" } });
    await rankForSession(session("sample"));
    expect(getDiscover().recs).toBeNull();
  });
  it("will not pretend to read a screenshot without the backend", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(readScreenshot(session("sample"), PNG)).rejects.toThrow(/needs the backend/);
    await expect(readScreenshot(session("no-profile"), PNG)).rejects.toThrow(/needs the backend/);
    expect(network).not.toHaveBeenCalled();
  });
});

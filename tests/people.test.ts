import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { MUSE_MODEL } from "../convex/meta";
import { DISCOVER_DAILY_LIMIT, PEOPLE_DAILY_LIMIT } from "../convex/discoverData";
import { FACEBOOK_STATE_TTL_MS, PEOPLE_LIMIT_KEPT_NOTICE, PEOPLE_LIMIT_NOTICE, PEOPLE_MATCH_RETENTION_MS } from "../convex/peopleData";
import { FACEBOOK_SCOPES, appSecretProof, dialogUrl, facebookConfig, facebookRedirect } from "../convex/facebookGraph";
import {
  SAMPLE_PEOPLE_INTERESTS, basicMatches, basicOpener, candidateRef, mergeShared, peopleKey, sharedInterests,
  validateOpeners, validatePairs, withSampleMatching,
} from "../src/discover/people";
import type { Snapshot } from "../src/domain";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
  "../convex/discover.ts": () => import("../convex/discover"),
  "../convex/discoverData.ts": () => import("../convex/discoverData"),
  "../convex/peopleData.ts": () => import("../convex/peopleData"),
  "../convex/people.ts": () => import("../convex/people"),
  "../convex/facebook.ts": () => import("../convex/facebook"),
};
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof makeTest>;

const tokenA = "a".repeat(64), tokenB = "b".repeat(64), tokenC = "c".repeat(64);
const BASE = "http://meta.test";
const GRAPH = "http://graph.test";
const APP_ID = "123456789012345";
const APP_SECRET = "app-secret-do-not-leak";
const ACCESS_TOKEN = "EAAB-access-token-do-not-leak";
const CODE = "oauth-code-do-not-leak";
const REDIRECT = "https://glancear.vercel.app/";
const TITLE = "Rooftop Mixer";
const TABLES = Object.keys(schema.tables) as (keyof typeof schema.tables)[];

type Call = { url: string; init: RequestInit & { headers: Record<string, string> }; body: any };
const museResponse = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const schemaName = (call: Call): string => call.body.response_format.json_schema.name;

/** A stand-in for Meta's chat completions endpoint that records every request. */
function provider(reply: (call: Call) => unknown | Response | Promise<unknown | Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: Call["init"]) => {
    const call = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const value = await reply(call);
    return value instanceof Response ? value : museResponse(value);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
/** Muse answering the two people-matching calls: pairs first, then openers. */
const muse = (pairs: unknown, openers: unknown = []) =>
  provider((call) => (schemaName(call) === "SharedPairs" ? { people: pairs } : { openers }));

const configure = () => { vi.stubEnv("META_API_KEY", "test-key"); vi.stubEnv("META_API_BASE_URL", BASE); };
const all = <N extends keyof typeof schema.tables>(t: T, table: N) => t.run(async (ctx) => ctx.db.query(table).collect());
const dump = async (t: T) => JSON.stringify(await Promise.all(TABLES.map((table) => all(t, table))));

/** Alex hosts an event; Sam joins it. Jo is registered but joins only when asked. */
async function party(options: { jo?: boolean } = {}) {
  const t = makeTest();
  const a: string = await t.mutation(anyApi.glance.register, { token: tokenA, name: "Alex Chen", role: "Builder", photoUrl: "" });
  const b: string = await t.mutation(anyApi.glance.register, { token: tokenB, name: "Sam Rivera", role: "Designer", photoUrl: "" });
  const c: string = await t.mutation(anyApi.glance.register, { token: tokenC, name: "Jo Park", role: "Researcher", photoUrl: "" });
  const eventId: string = await t.mutation(anyApi.glance.createEvent, { token: tokenA, title: TITLE, location: "Austin" });
  const { inviteCode } = (await t.query(anyApi.glance.snapshot, { token: tokenA })).events[0];
  await t.mutation(anyApi.glance.joinEvent, { token: tokenB, inviteCode });
  if (options.jo) await t.mutation(anyApi.glance.joinEvent, { token: tokenC, inviteCode });
  return { t, a, b, c, eventId, inviteCode: inviteCode as string };
}
const save = (t: T, token: string, interests: string[]): Promise<string[]> => t.mutation(anyApi.peopleData.saveInterests, { token, interests });
const snap = (t: T, token: string, eventId?: string): Promise<Snapshot> => t.query(anyApi.glance.snapshot, { token, ...(eventId ? { eventId } : {}) });
const member = (snapshot: Snapshot, id: string) => snapshot.members.find((person) => person.id === id)!;
const match = (t: T, eventId: string, extra: { token?: string; force?: boolean } = {}): Promise<string> =>
  t.action(anyApi.people.match, { token: tokenA, eventId, ...extra });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("wording match", () => {
  it("links the same words whatever the case or plural, in the viewer's wording and order", () => {
    expect(sharedInterests(["Board Games", "jazz", "Coffee"], ["COFFEE", "board game", "Jazz"])).toEqual(["Board Games", "jazz", "Coffee"]);
    expect(sharedInterests(["Board Games", "jazz", "Coffee"], ["COFFEE", "board game", "Jazz"], false)).toEqual(["Board Games", "jazz", "Coffee"]);
    expect(sharedInterests(["trail running"], ["Trail-Running"])).toEqual(["trail running"]);
  });
  it("in loose mode links a phrase with one that ends in it, in either direction", () => {
    expect(sharedInterests(["coffee"], ["specialty coffee"])).toEqual(["coffee"]);
    expect(sharedInterests(["specialty coffee"], ["coffee"])).toEqual(["specialty coffee"]);
    expect(sharedInterests(["coffee"], ["Specialty Coffees"])).toEqual(["coffee"]);
    // Only the ending counts: "coffee shops" does not end in "coffee".
    expect(sharedInterests(["coffee"], ["coffee shops"])).toEqual([]);
  });
  it("in strict mode keeps only the same words", () => {
    expect(sharedInterests(["coffee"], ["specialty coffee"], false)).toEqual([]);
    expect(sharedInterests(["specialty coffee"], ["coffee"], false)).toEqual([]);
    expect(sharedInterests(["coffee", "Jazz"], ["specialty coffee", "jazz"], false)).toEqual(["Jazz"]);
  });
  it("never links unrelated phrases or parts of words", () => {
    for (const loose of [true, false]) {
      expect(sharedInterests(["art"], ["party"], loose)).toEqual([]);
      expect(sharedInterests(["party"], ["art"], loose)).toEqual([]);
      expect(sharedInterests(["ar"], ["art"], loose)).toEqual([]);
      expect(sharedInterests(["bouldering", "film photography"], ["ceramics", "street food"], loose)).toEqual([]);
      expect(sharedInterests(["film photography"], ["film"], loose)).toEqual([]);
    }
    expect(sharedInterests([], ["coffee"])).toEqual([]);
    expect(sharedInterests(["coffee"], [])).toEqual([]);
    expect(sharedInterests(["  ", "!!"], ["  ", "!!"])).toEqual([]);
  });
  it("never returns the other person's wording", () => {
    const mine = ["coffee", "bouldering"], theirs = ["Specialty Coffee", "ceramics", "Bouldering"];
    const shared = sharedInterests(mine, theirs);
    expect(shared).toEqual(["coffee", "bouldering"]);
    for (const phrase of shared) expect(mine).toContain(phrase);
  });
  // Regression: the match once reused the event catalog's keywords, which drop generic words ("night",
  // "club", "live", "events", "videos"...), so identical generic phrases never linked and strict mode
  // called two different phrases "the same words".
  it("compares whole phrases, so identical generic phrases link and different phrases do not", () => {
    expect(sharedInterests(["night club"], ["night club"])).toEqual(["night club"]);
    expect(sharedInterests(["Live Events"], ["live events"], false)).toEqual(["Live Events"]);
    expect(sharedInterests(["meetups"], ["meetup"])).toEqual(["meetups"]);
    expect(sharedInterests(["night club"], ["Night Clubs"], false)).toEqual(["night club"]);
    expect(sharedInterests(["reels"], ["Reels"], false)).toEqual(["reels"]);
    expect(sharedInterests(["live music"], ["music videos"], false)).toEqual([]);
    expect(sharedInterests(["book club"], ["books"], false)).toEqual([]);
  });
  it("ignores filler words, unless they are the whole phrase", () => {
    expect(sharedInterests(["arts and crafts"], ["Arts & Crafts"], false)).toEqual(["arts and crafts"]);
    expect(sharedInterests(["the beatles"], ["Beatles"], false)).toEqual(["the beatles"]);
    expect(sharedInterests(["The The"], ["the the"], false)).toEqual(["The The"]);
    expect(sharedInterests(["The The"], ["jazz"])).toEqual([]);
  });
  it("writes a plain opener about the first shared interest", () => {
    expect(basicOpener(["coffee", "jazz"])).toBe("What got you into coffee?");
    expect(basicOpener([])).toBe("");
  });
  it("lists one basic row per person with something in common", () => {
    expect(basicMatches(["coffee", "jazz"], [
      { id: "x", interests: ["Specialty Coffee", "ceramics"] }, { id: "y", interests: ["typography"] }, { id: "z", interests: ["Jazz", "coffee"] },
    ])).toEqual([
      { id: "x", shared: ["coffee"], opener: "What got you into coffee?" },
      { id: "z", shared: ["coffee", "jazz"], opener: "What got you into coffee?" },
    ]);
    expect(basicMatches([], [{ id: "x", interests: ["coffee"] }])).toEqual([]);
  });
  it("merges wording matches and Muse pairs in the viewer's order without duplicates", () => {
    const mine = ["bouldering", "coffee", "jazz", "film"];
    expect(mergeShared(mine, ["jazz", "coffee"], ["coffee", "bouldering"])).toEqual(["bouldering", "coffee", "jazz"]);
    expect(mergeShared(mine, ["jazz"])).toEqual(["jazz"]);
    expect(mergeShared(mine, [], ["not on my list"])).toEqual([]);
  });
  it("names candidates p1, p2 and so on", () => {
    expect([0, 1, 9].map(candidateRef)).toEqual(["p1", "p2", "p10"]);
  });
});

describe("Muse reply validation", () => {
  const mine = ["Bouldering", "coffee", "film photography"];
  const candidates = [
    { id: "id-sam", interests: ["rock climbing", "Specialty Coffee", "ceramics"] },
    { id: "id-jo", interests: ["typography", "espresso"] },
  ];
  it("keeps a pair only when both phrases are really on the two lists", () => {
    const pairs = validatePairs([
      { person: "p1", pairs: [
        { mine: "  bouldering ", theirs: "ROCK CLIMBING" },   // kept, in the viewer's wording
        { mine: "coffee", theirs: "Specialty  Coffee" },       // kept, whitespace collapsed
        { mine: "coffee", theirs: "specialty coffee" },        // duplicate
        { mine: "film photography", theirs: "typography" },    // typography belongs to p2
        { mine: "film photography", theirs: "street photography" }, // invented phrase of theirs
        { mine: "ceramics", theirs: "ceramics" },              // not on the viewer's list
        { mine: 7, theirs: "ceramics" }, { mine: "coffee" }, null, "nonsense",
      ] },
      { person: "p2", pairs: [{ mine: "coffee", theirs: "espresso" }] },
      { person: "p3", pairs: [{ mine: "coffee", theirs: "espresso" }] }, // unknown ref
      { person: "id-sam", pairs: [{ mine: "film photography", theirs: "ceramics" }] }, // a real id is not a ref
      { person: "p1", pairs: "coffee" }, { pairs: [] }, null, 42,
    ], mine, candidates);
    expect([...pairs]).toEqual([["id-sam", ["Bouldering", "coffee"]], ["id-jo", ["coffee"]]]);
    const text = JSON.stringify([...pairs]);
    for (const theirs of ["rock climbing", "ROCK CLIMBING", "Specialty", "ceramics", "espresso", "typography"]) expect(text).not.toContain(theirs);
  });
  it("adds to the same person across repeated entries and ignores garbage", () => {
    expect([...validatePairs([
      { person: "p1", pairs: [{ mine: "coffee", theirs: "specialty coffee" }] },
      { person: "p1", pairs: [{ mine: "coffee", theirs: "specialty coffee" }, { mine: "bouldering", theirs: "rock climbing" }] },
    ], mine, candidates)]).toEqual([["id-sam", ["coffee", "Bouldering"]]]);
    for (const garbage of [undefined, null, "p1", 3, {}, { people: [] }]) expect(validatePairs(garbage, mine, candidates).size).toBe(0);
    expect(validatePairs([{ person: "p1", pairs: [] }], mine, candidates).size).toBe(0);
  });
  it("keeps one bounded opener for each known person", () => {
    const openers = validateOpeners([
      { person: "p1", opener: "  Which  roast\nare you into lately? " },
      { person: "p1", opener: "A second opener for the same person." },
      { person: "p2", opener: "short" },
      { person: "p2", opener: `${"x".repeat(139)} ${"y".repeat(40)}` },
      { person: "p9", opener: "Nobody goes by this reference." },
      { person: "id-sam", opener: "A real id is not a reference." },
      { person: "p1" }, { opener: "No person on this entry." }, null, "nonsense",
    ], candidates);
    expect([...openers]).toEqual([["id-sam", "Which roast are you into lately?"], ["id-jo", "x".repeat(139)]]);
    for (const text of openers.values()) expect(text.length).toBeLessThanOrEqual(140);
    expect(validateOpeners({ openers: [] }, candidates).size).toBe(0);
    expect(validateOpeners([{ person: "p1", opener: 12345678 }], candidates).size).toBe(0);
  });
});

describe("list fingerprint", () => {
  const sam = { id: "id-sam", interests: ["coffee", "ceramics"] }, jo = { id: "id-jo", interests: ["typography"] };
  it("is the same for any candidate order", () => {
    expect(peopleKey(["coffee"], [sam, jo])).toBe(peopleKey(["coffee"], [jo, sam]));
    expect(peopleKey(["coffee"], [sam, jo])).toMatch(/^[0-9a-f]{16}:\d+$/);
  });
  it("changes with the viewer's list, any candidate's list and the candidate set", () => {
    const base = peopleKey(["coffee"], [sam, jo]);
    const others = [
      peopleKey(["coffee", "jazz"], [sam, jo]),
      peopleKey(["Coffee"], [sam, jo]),
      peopleKey(["coffee"], [{ ...sam, interests: ["coffee", "pottery"] }, jo]),
      peopleKey(["coffee"], [{ ...sam, interests: ["ceramics", "coffee"] }, jo]),
      peopleKey(["coffee"], [sam, { ...jo, interests: [] }]),
      peopleKey(["coffee"], [sam]),
      peopleKey(["coffee"], [sam, jo, { id: "id-new", interests: [] }]),
      peopleKey(["coffee"], [{ ...sam, id: "id-other" }, jo]),
      peopleKey([], []),
    ];
    for (const other of others) expect(other).not.toBe(base);
    expect(new Set(others).size).toBe(others.length);
  });
  it("does not spell out anyone's interests", () => {
    expect(peopleKey(["coffee"], [sam, jo])).not.toMatch(/coffee|ceramics|typography|id-sam/);
  });
});

describe("sample walkthrough matching", () => {
  const me = { id: "me", name: "You", role: "Guest", photoUrl: "" };
  const people = [me, { id: "alex", name: "Alex Chen", role: "Builder", photoUrl: "" }, { id: "sam", name: "Sam Rivera", role: "Designer", photoUrl: "" },
    { id: "stranger", name: "No Sample Interests", role: "", photoUrl: "" }];
  const event = { id: "e1", title: TITLE, location: "Austin", inviteCode: "ABCD", hostId: "alex" };
  const selected: Snapshot = { me, events: [event], event, members: people, conversations: [] };
  const home: Snapshot = { me, events: [event], members: [], conversations: [] };
  it("leaves the snapshot alone while matching is off", () => {
    expect(withSampleMatching(selected, undefined)).toBe(selected);
    expect(withSampleMatching(home, undefined)).toBe(home);
  });
  it("only adds the person's own interests when no event is selected", () => {
    const out = withSampleMatching(home, ["coffee"]);
    expect(out).toEqual({ ...home, me: { ...me, interests: ["coffee"] } });
    expect(out.matching).toBeUndefined();
  });
  it("gives the sample attendees a wording match computed on the device", () => {
    const mine = ["Coffee", "typography", "bouldering"];
    const out = withSampleMatching(selected, mine);
    expect(out.me.interests).toEqual(mine);
    expect(out.matching).toEqual({ source: "basic", stale: false });
    expect(member(out, "alex")).toMatchObject({ shared: ["Coffee"], opener: "What got you into Coffee?" });
    expect(member(out, "sam")).toMatchObject({ shared: ["typography"], opener: "What got you into typography?" });
    expect(member(out, "me")).toEqual(me);
    expect(member(out, "stranger")).not.toHaveProperty("shared");
    const none = withSampleMatching(selected, ["knitting"]);
    expect(member(none, "alex").shared).toEqual([]);
    expect(member(none, "alex")).not.toHaveProperty("opener");
    expect(Object.keys(SAMPLE_PEOPLE_INTERESTS).sort()).toEqual(["alex", "sam"]);
    // The sample people's other interests stay out of the snapshot too.
    expect(JSON.stringify(out)).not.toMatch(/synthesizers|ceramics|street food/);
  });
  it("does not match the viewer against their own sample profile", () => {
    const asAlex = withSampleMatching({ ...selected, me: people[1] }, ["coffee", "ceramics"]);
    expect(member(asAlex, "alex")).not.toHaveProperty("shared");
    expect(member(asAlex, "sam").shared).toEqual(["ceramics"]);
  });
});

describe("saving interests", () => {
  it("refuses an unregistered or malformed device", async () => {
    const t = makeTest();
    await expect(save(t, tokenA, ["coffee"])).rejects.toThrow(/not registered/);
    await expect(save(t, "nope", ["coffee"])).rejects.toThrow(/Invalid device credential/);
    await expect(t.mutation(anyApi.peopleData.clearInterests, { token: tokenA })).rejects.toThrow(/not registered/);
    expect(await all(t, "interestProfiles")).toEqual([]);
  });
  it("cleans, de-duplicates and caps the list, and replaces it on the next save", async () => {
    const { t, a } = await party();
    expect(await save(t, tokenA, ["  Bouldering ", "#bouldering", "espresso\u0007 shots\n", "🔥", "x", "R&B / soul"])).toEqual(["Bouldering", "espresso shots", "R&B / soul"]);
    expect((await snap(t, tokenA)).me.interests).toEqual(["Bouldering", "espresso shots", "R&B / soul"]);
    expect(await save(t, tokenA, Array.from({ length: 60 }, (_, i) => `topic ${i}`))).toHaveLength(24);
    const rows = await all(t, "interestProfiles");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profileId: a, interests: Array.from({ length: 24 }, (_, i) => `topic ${i}`) });
    expect(Object.keys(rows[0]).sort()).toEqual(["_creationTime", "_id", "interests", "profileId", "updatedAt"]);
    expect(await save(t, tokenA, [])).toEqual([]);
    expect((await all(t, "interestProfiles"))[0].interests).toEqual([]);
  });
  it("rejects an oversized list or phrase and keeps what was saved", async () => {
    const { t } = await party();
    await save(t, tokenA, ["coffee"]);
    await expect(save(t, tokenA, Array.from({ length: 61 }, (_, i) => `t${i}`))).rejects.toThrow(/Too many signals/);
    await expect(save(t, tokenA, ["x".repeat(201)])).rejects.toThrow(/Too many signals/);
    expect((await all(t, "interestProfiles"))[0].interests).toEqual(["coffee"]);
  });
  it("clearing removes the list and the caller's stored matches, and nobody else's", async () => {
    const { t, a, b, eventId } = await party();
    await save(t, tokenA, ["coffee"]); await save(t, tokenB, ["coffee"]);
    const row = (profileId: string) => ({ profileId, eventId, key: "k", matches: [], source: "muse" as const, updatedAt: Date.now() });
    await t.run(async (ctx) => { await ctx.db.insert("peopleMatches", row(a) as any); await ctx.db.insert("peopleMatches", row(b) as any); });
    await t.mutation(anyApi.peopleData.clearInterests, { token: tokenA });
    expect((await all(t, "interestProfiles")).map((r) => r.profileId)).toEqual([b]);
    expect((await all(t, "peopleMatches")).map((r) => r.profileId)).toEqual([b]);
    expect((await snap(t, tokenA, eventId)).me).not.toHaveProperty("interests");
    await t.mutation(anyApi.peopleData.clearInterests, { token: tokenA }); // already off: still fine
  });
});

describe("what a snapshot shows", () => {
  it("shows nothing about matching to someone who has not switched it on", async () => {
    const { t, a, b, eventId } = await party();
    await save(t, tokenB, ["coffee", "ceramics"]);
    const view = await snap(t, tokenA, eventId);
    expect(view.me).not.toHaveProperty("interests");
    expect(view).not.toHaveProperty("matching");
    for (const person of view.members) { expect(person).not.toHaveProperty("shared"); expect(person).not.toHaveProperty("opener"); }
    expect(view.members.map((person) => person.id).sort()).toEqual([a, b].sort());
    expect(JSON.stringify(view)).not.toMatch(/coffee|ceramics/);
  });
  it("leaves `shared` off a member who has not switched it on", async () => {
    const { t, a, b, eventId } = await party();
    await save(t, tokenA, ["coffee"]);
    const view = await snap(t, tokenA, eventId);
    expect(view.me.interests).toEqual(["coffee"]);
    expect(view.matching).toEqual({ source: "basic", stale: false });
    expect(member(view, b)).not.toHaveProperty("shared");
    expect(member(view, a)).not.toHaveProperty("shared");
    expect(member(view, a)).not.toHaveProperty("interests");
  });
  it("shows the viewer's own phrases, an opener, and that Muse has not looked yet", async () => {
    const { t, a, b, c, eventId } = await party({ jo: true });
    await save(t, tokenA, ["coffee", "Jazz", "bouldering"]);
    await save(t, tokenB, ["Specialty Coffee", "ceramics", "jazz"]);
    await save(t, tokenC, ["typography"]);
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toEqual({ source: "basic", stale: true });
    expect(member(view, b)).toMatchObject({ shared: ["coffee", "Jazz"], opener: "What got you into coffee?" });
    expect(member(view, c).shared).toEqual([]);
    expect(member(view, c)).not.toHaveProperty("opener");
    expect(member(view, a)).not.toHaveProperty("shared");
    // Sam sees the same overlap in Sam's own words.
    const theirs = await snap(t, tokenB, eventId);
    expect(theirs.me.interests).toEqual(["Specialty Coffee", "ceramics", "jazz"]);
    expect(member(theirs, a)).toMatchObject({ shared: ["Specialty Coffee", "jazz"], opener: "What got you into Specialty Coffee?" });
    expect(JSON.stringify(theirs)).not.toMatch(/bouldering|Jazz|typography/);
  });
  it("is not stale when there is nothing Muse could compare", async () => {
    const { t, b, eventId } = await party();
    await save(t, tokenA, []); await save(t, tokenB, ["coffee"]);
    const empty = await snap(t, tokenA, eventId);
    expect(empty.me.interests).toEqual([]);
    expect(empty.matching).toEqual({ source: "basic", stale: false });
    expect(member(empty, b).shared).toEqual([]);
    await save(t, tokenA, ["coffee"]); await save(t, tokenB, []);
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "basic", stale: false });
    await t.mutation(anyApi.peopleData.clearInterests, { token: tokenB });
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "basic", stale: false });
  });
  it("shows the saved list but no matching when no event is selected", async () => {
    const { t } = await party();
    await save(t, tokenA, ["coffee"]); await save(t, tokenB, ["coffee"]);
    const view = await snap(t, tokenA);
    expect(view.me.interests).toEqual(["coffee"]);
    expect(view).not.toHaveProperty("matching");
    expect(view.members).toEqual([]);
  });
  it("never sends the other person's wording, the rest of their list or its length", async () => {
    const { t, b, eventId } = await party();
    await save(t, tokenA, ["coffee"]);
    await save(t, tokenB, ["Specialty Coffee", "ceramics"]);
    const view = await snap(t, tokenA, eventId);
    expect(member(view, b)).toMatchObject({ shared: ["coffee"], opener: "What got you into coffee?" });
    const text = JSON.stringify(view);
    expect(text).not.toContain("ceramics");
    expect(text).not.toContain("Specialty Coffee");
    expect(text.toLowerCase()).not.toContain("specialty");
    // A longer list on the other side changes nothing the viewer receives.
    await save(t, tokenB, ["Specialty Coffee", "ceramics", "typography", "street food", "synthesizers", "trail running"]);
    expect(JSON.stringify(await snap(t, tokenA, eventId))).toBe(text);
    // Only the opted-in keys are added to a member.
    expect(Object.keys(member(view, b)).sort()).toEqual(["glanceEnabled", "id", "name", "opener", "photoUrl", "role", "shared"]);
  });
  it("refuses a snapshot of an event the caller has not joined", async () => {
    const { t, eventId } = await party();
    await save(t, tokenC, ["coffee"]);
    await expect(snap(t, tokenC, eventId)).rejects.toThrow(/Event unavailable/);
  });
});

describe("Muse people matching", () => {
  const mine = ["bouldering", "coffee", "Jazz", "film photography"];
  const theirs = ["rock climbing", "Specialty Coffee", "ceramics", "jazz"];
  const OPENER = "Which roast are you into lately, and do you boulder indoors?";
  async function ready(options: { jo?: boolean } = {}) {
    const group = await party(options);
    await save(group.t, tokenA, mine);
    await save(group.t, tokenB, theirs);
    return group;
  }
  const goodPairs = [{ person: "p1", pairs: [{ mine: "bouldering", theirs: "rock climbing" }, { mine: "coffee", theirs: "Specialty Coffee" }] }];

  it("refuses someone who has not opted in, a non-member and an unknown device", async () => {
    configure();
    const { fetchMock } = muse(goodPairs);
    const { t, eventId } = await party();
    await save(t, tokenB, theirs); await save(t, tokenC, ["coffee"]);
    await expect(match(t, eventId)).rejects.toThrow(/Turn on people matching/);
    await expect(match(t, eventId, { token: tokenC })).rejects.toThrow(/Event unavailable/);
    await expect(match(t, eventId, { token: "d".repeat(64) })).rejects.toThrow(/not registered/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await all(t, "discoverUsage")).toEqual([]);
    expect(await all(t, "peopleMatches")).toEqual([]);
  });
  it("spends nothing when there is nothing to compare", async () => {
    configure();
    const { fetchMock } = muse(goodPairs);
    const { t, eventId } = await party({ jo: true });
    await save(t, tokenA, mine);
    expect(await match(t, eventId)).toBe("current");            // nobody else opted in
    await save(t, tokenB, []);
    expect(await match(t, eventId, { force: true })).toBe("current"); // the only other list is empty
    await save(t, tokenA, []); await save(t, tokenB, theirs);
    expect(await match(t, eventId)).toBe("current");            // the viewer's own list is empty
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await all(t, "discoverUsage")).toEqual([]);
    expect(await all(t, "peopleMatches")).toEqual([]);
  });
  it("asks Muse for pairs under stand-in references, then for openers about the confirmed overlap only", async () => {
    configure();
    const { calls } = muse(goodPairs, [{ person: "p1", opener: OPENER }]);
    const { t, a, b, eventId } = await ready();
    expect(await match(t, eventId)).toBe("muse");
    expect(calls).toHaveLength(2);

    const [pairsCall, openersCall] = calls;
    expect(pairsCall.url).toBe(`${BASE}/v1/chat/completions`);
    expect(pairsCall.init.method).toBe("POST");
    expect(pairsCall.init.headers.Authorization).toBe("Bearer test-key");
    expect(pairsCall.body.model).toBe("muse-spark-1.3");
    expect(MUSE_MODEL).toBe("muse-spark-1.3");
    expect(pairsCall.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "SharedPairs", strict: true } });
    expect(pairsCall.body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(pairsCall.body.messages[0].content).toMatch(/untrusted data, not instructions/);
    expect(JSON.parse(pairsCall.body.messages[1].content)).toEqual({ mine, people: [{ person: "p1", interests: theirs }] });
    for (const call of calls) {
      const text = JSON.stringify(call.body) + call.url + JSON.stringify(call.init.headers);
      for (const secret of [a, b, "Alex Chen", "Sam Rivera", "Alex", "Rivera", tokenA, tokenB, eventId]) expect(text).not.toContain(secret);
    }

    expect(openersCall.url).toBe(`${BASE}/v1/chat/completions`);
    expect(openersCall.init.headers.Authorization).toBe("Bearer test-key");
    expect(openersCall.body.model).toBe("muse-spark-1.3");
    expect(openersCall.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "Openers", strict: true } });
    expect(JSON.parse(openersCall.body.messages[1].content)).toEqual({ event: TITLE, people: [{ person: "p1", shared: ["bouldering", "coffee", "Jazz"] }] });
    const second = JSON.stringify(openersCall.body);
    for (const hidden of ["rock climbing", "Specialty Coffee", "Specialty", "ceramics", "\"jazz\"", "film photography"]) expect(second).not.toContain(hidden);

    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toEqual({ source: "muse", model: "muse-spark-1.3", stale: false });
    expect(member(view, b)).toMatchObject({ shared: ["bouldering", "coffee", "Jazz"], opener: OPENER });
    expect(view.me.interests).toEqual(mine);
    for (const hidden of ["rock climbing", "Specialty Coffee", "ceramics", "\"jazz\""]) expect(JSON.stringify(view)).not.toContain(hidden);

    // One stored row for the viewer, holding only the viewer's phrases; one people call counted.
    const rows = await all(t, "peopleMatches");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profileId: a, eventId, source: "muse", model: "muse-spark-1.3", matches: [{ profileId: b, shared: ["bouldering", "coffee", "Jazz"], opener: OPENER }] });
    expect(rows[0]).not.toHaveProperty("notice");
    expect(JSON.stringify(rows)).not.toMatch(/rock climbing|Specialty|ceramics/);
    expect((await all(t, "discoverUsage")).map((row) => [row.profileId, row.day, row.count, row.people])).toEqual([[a, "2026-11-11", 0, 1]]);
    // Sam asked for nothing, so Sam still sees a wording match in Sam's own words.
    const other = await snap(t, tokenB, eventId);
    expect(other.matching).toEqual({ source: "basic", stale: true });
    expect(member(other, a).shared).toEqual(["Specialty Coffee", "jazz"]);
    expect(JSON.stringify(other)).not.toMatch(/bouldering|film photography|Jazz/);
  });
  it("drops invented pairs and unknown people, and ignores an opener for someone with nothing shared", async () => {
    configure();
    const { calls } = muse([
      { person: "p1", pairs: [
        { mine: "film photography", theirs: "typography" },   // typography is on p2's list, not p1's
        { mine: "film photography", theirs: "darkroom" },     // invented
        { mine: "ceramics", theirs: "ceramics" },             // not the viewer's phrase
        { mine: "bouldering", theirs: "rock climbing" },
      ] },
      { person: "p7", pairs: [{ mine: "coffee", theirs: "typography" }] },
      { person: "p2", pairs: [{ mine: "coffee", theirs: "espresso martinis" }] },
    ], [
      { person: "p1", opener: "Where do you usually go climbing around here?" },
      { person: "p2", opener: "This opener is for someone with nothing in common." },
      { person: "p7", opener: "This opener is for someone who does not exist." },
    ]);
    const { t, b, c, eventId } = await ready({ jo: true });
    await save(t, tokenC, ["typography", "knitting"]);
    expect(await match(t, eventId)).toBe("muse");
    expect(JSON.parse(calls[0].body.messages[1].content).people).toEqual([{ person: "p1", interests: theirs }, { person: "p2", interests: ["typography", "knitting"] }]);
    // Jo has nothing confirmed, so Jo is not mentioned in the openers request at all.
    expect(JSON.parse(calls[1].body.messages[1].content).people).toEqual([{ person: "p1", shared: ["bouldering", "Jazz"] }]);
    expect(JSON.stringify(calls[1].body)).not.toMatch(/typography|knitting|ceramics|rock climbing/);
    const view = await snap(t, tokenA, eventId);
    expect(member(view, b)).toMatchObject({ shared: ["bouldering", "Jazz"], opener: "Where do you usually go climbing around here?" });
    expect(member(view, c).shared).toEqual([]);
    expect(member(view, c)).not.toHaveProperty("opener");
    expect((await all(t, "peopleMatches"))[0].matches.map((row) => row.profileId)).toEqual([b]);
    expect(JSON.stringify(view)).not.toMatch(/typography|knitting|ceramics|darkroom|nothing in common/);
  });
  it("keeps identical wording but not the loose suffix guess once Muse has judged the lists", async () => {
    configure();
    const { calls } = muse([]);
    const { t, b, eventId } = await ready();
    expect(member(await snap(t, tokenA, eventId), b).shared).toEqual(["coffee", "Jazz"]); // the loose guess, before Muse
    expect(await match(t, eventId)).toBe("muse");
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toEqual({ source: "muse", model: "muse-spark-1.3", stale: false });
    expect(member(view, b)).toMatchObject({ shared: ["Jazz"], opener: "What got you into Jazz?" }); // Muse wrote no opener
    expect(JSON.parse(calls[1].body.messages[1].content).people).toEqual([{ person: "p1", shared: ["Jazz"] }]);
  });
  it("makes one call when Muse confirms nothing and no wording is identical", async () => {
    configure();
    const { calls } = muse([]);
    const { t, b, eventId } = await party();
    await save(t, tokenA, ["coffee"]); await save(t, tokenB, ["Specialty Coffee", "ceramics"]);
    expect(await match(t, eventId)).toBe("muse");
    expect(calls.map(schemaName)).toEqual(["SharedPairs"]);
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toEqual({ source: "muse", model: "muse-spark-1.3", stale: false });
    expect(member(view, b).shared).toEqual([]);
    expect(member(view, b)).not.toHaveProperty("opener");
  });
  it.each([
    ["a provider outage", () => { configure(); provider(() => new Response("secret provider body", { status: 503 })); }, /^Muse could not finish that request\. Showing a basic match instead\.$/, 1],
    ["a missing key", () => { vi.stubEnv("META_API_BASE_URL", BASE); provider(() => ({ people: [] })); }, /META_API_KEY is missing.*Showing a basic match instead\.$/, 0],
    ["a rejected key", () => { configure(); provider(() => new Response("secret provider body", { status: 401 })); }, /Meta rejected the API key/, 1],
    ["a malformed reply", () => { configure(); provider(() => ({ nonsense: true })); }, /did not pass validation/, 1],
    ["an unreachable provider", () => { configure(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed"))); }, /could not reach Meta/, 1],
  ])("falls back to a labelled wording match on %s", async (_name, arrange, notice, providerCalls) => {
    arrange();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, b, eventId } = await ready();
    expect(await match(t, eventId)).toBe("basic");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(providerCalls);
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toMatchObject({ source: "basic", stale: false });
    expect(view.matching).not.toHaveProperty("model");
    expect(view.matching!.notice).toMatch(notice);
    expect(view.matching!.notice).not.toContain("secret provider body");
    expect(member(view, b)).toMatchObject({ shared: ["coffee", "Jazz"], opener: "What got you into coffee?" });
    // Failures are logged by code only: no interests, keys or provider bodies.
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^People matching failed: [A-Z0-9_]+$/);
    expect(JSON.stringify(view)).not.toMatch(/ceramics|Specialty|rock climbing/);
  });
  it("keeps Muse's pairs with plain openers when only the openers call fails", async () => {
    configure();
    const { calls } = provider((call) => (schemaName(call) === "SharedPairs" ? { people: goodPairs } : new Response("secret provider body", { status: 503 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, b, eventId } = await ready();
    expect(await match(t, eventId)).toBe("muse");
    expect(calls).toHaveLength(2);
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toMatchObject({ source: "muse", model: "muse-spark-1.3", stale: false });
    expect(view.matching!.notice).toMatch(/could not write openers/);
    expect(member(view, b)).toMatchObject({ shared: ["bouldering", "coffee", "Jazz"], opener: basicOpener(["bouldering"]) });
    expect(log.mock.calls.map((args) => String(args[0]))).toEqual(["People openers failed: OPENERS_HTTP_503"]);
  });
  it("answers `current` without asking again until forced", async () => {
    configure();
    const { fetchMock } = muse(goodPairs, [{ person: "p1", opener: OPENER }]);
    const { t, a, eventId } = await ready();
    expect(await match(t, eventId)).toBe("muse");
    expect(await match(t, eventId)).toBe("current");
    expect(await match(t, eventId, { force: false })).toBe("current");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await match(t, eventId, { force: true })).toBe("muse");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await all(t, "peopleMatches")).toHaveLength(1);
    expect((await all(t, "discoverUsage")).map((row) => [row.profileId, row.people])).toEqual([[a, 2]]);
  });
  it("goes back to a stale wording match as soon as any list changes", async () => {
    configure();
    const { fetchMock } = muse(goodPairs, [{ person: "p1", opener: OPENER }]);
    const { t, b, eventId } = await ready();
    await match(t, eventId);
    await save(t, tokenB, [...theirs, "typography"]);
    const afterTheirs = await snap(t, tokenA, eventId);
    expect(afterTheirs.matching).toEqual({ source: "basic", stale: true });
    expect(member(afterTheirs, b)).toMatchObject({ shared: ["coffee", "Jazz"], opener: "What got you into coffee?" });
    // Saving the same lists again brings the stored answer back without another call.
    await save(t, tokenB, theirs);
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "muse", model: "muse-spark-1.3", stale: false });
    await save(t, tokenA, [...mine, "knitting"]);
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "basic", stale: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await match(t, eventId)).toBe("muse");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("stores nothing when a list changes while Muse is working", async () => {
    configure();
    const group = await ready();
    const { t, b, eventId } = group;
    let changed = false;
    const { fetchMock } = provider(async (call) => {
      if (!changed) { changed = true; await save(t, tokenB, ["ceramics", "typography"]); }
      return schemaName(call) === "SharedPairs" ? { people: goodPairs } : { openers: [{ person: "p1", opener: OPENER }] };
    });
    expect(await match(t, eventId)).toBe("stale");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await all(t, "peopleMatches")).toEqual([]);
    const view = await snap(t, tokenA, eventId);
    expect(view.matching).toEqual({ source: "basic", stale: true });
    expect(member(view, b).shared).toEqual([]);
    expect(member(view, b)).not.toHaveProperty("opener");
  });
  it("returns `stale` when the other person opts out while Muse is working", async () => {
    configure();
    const { t, b, eventId } = await ready();
    let cleared = false;
    provider(async (call) => {
      if (!cleared) { cleared = true; await t.mutation(anyApi.peopleData.clearInterests, { token: tokenB }); }
      return schemaName(call) === "SharedPairs" ? { people: goodPairs } : { openers: [{ person: "p1", opener: OPENER }] };
    });
    expect(await match(t, eventId)).toBe("stale");
    expect(await all(t, "peopleMatches")).toEqual([]);
    expect(member(await snap(t, tokenA, eventId), b)).not.toHaveProperty("shared");
  });
  it("stops showing someone the moment they clear their interests, even with a stored Muse result", async () => {
    configure();
    muse(goodPairs, [{ person: "p1", opener: OPENER }]);
    const { t, b, eventId } = await ready();
    await match(t, eventId);
    expect(member(await snap(t, tokenA, eventId), b).shared).toEqual(["bouldering", "coffee", "Jazz"]);
    await t.mutation(anyApi.peopleData.clearInterests, { token: tokenB });
    const view = await snap(t, tokenA, eventId);
    expect(member(view, b)).not.toHaveProperty("shared");
    expect(member(view, b)).not.toHaveProperty("opener");
    expect(view.matching).toEqual({ source: "basic", stale: false });
    expect(JSON.stringify(view)).not.toContain(OPENER);
    // The viewer's next request clears the leftover row without calling Muse.
    expect(await match(t, eventId)).toBe("current");
    expect(await all(t, "peopleMatches")).toEqual([]);
  });
  it("lets each viewer keep their own result for the same event", async () => {
    configure();
    provider((call) => {
      if (schemaName(call) === "Openers") return { openers: [] };
      const sent = JSON.parse(call.body.messages[1].content);
      return { people: sent.mine.includes("bouldering") ? goodPairs : [{ person: "p1", pairs: [{ mine: "rock climbing", theirs: "bouldering" }] }] };
    });
    const { t, a, b, eventId } = await ready();
    expect(await match(t, eventId)).toBe("muse");
    expect(await match(t, eventId, { token: tokenB })).toBe("muse");
    expect(member(await snap(t, tokenA, eventId), b).shared).toEqual(["bouldering", "coffee", "Jazz"]);
    const other = await snap(t, tokenB, eventId);
    expect(member(other, a).shared).toEqual(["rock climbing", "jazz"]);
    expect(JSON.stringify(other)).not.toMatch(/bouldering|film photography|Jazz/);
    expect(await all(t, "peopleMatches")).toHaveLength(2);
  });
});

describe("daily people-matching cap", () => {
  const picks = { picks: [{ eventId: "beginner-bouldering-social", score: 90, reason: "You like bouldering." }] };
  const reply = (call: Call) => {
    const name = schemaName(call);
    return name === "SharedPairs" ? { people: [] } : name === "Openers" ? { openers: [] } : picks;
  };
  it("allows a day's worth of refreshes, then shows a labelled basic match without calling Muse", async () => {
    configure();
    const { fetchMock } = provider(reply);
    const { t, a, b, eventId } = await party();
    await save(t, tokenA, ["coffee", "jazz"]); await save(t, tokenB, ["Specialty Coffee", "jazz"]);
    for (let i = 0; i < PEOPLE_DAILY_LIMIT; i++) expect(await match(t, eventId, { force: true })).toBe("muse");
    expect(fetchMock).toHaveBeenCalledTimes(PEOPLE_DAILY_LIMIT * 2);
    expect(member(await snap(t, tokenA, eventId), b).shared).toEqual(["jazz"]);

    // At the cap a forced refresh keeps a Muse result that still describes the lists, and says why nothing changed.
    expect(await match(t, eventId, { force: true })).toBe("current");
    expect(fetchMock).toHaveBeenCalledTimes(PEOPLE_DAILY_LIMIT * 2);
    const kept = await snap(t, tokenA, eventId);
    expect(kept.matching).toEqual({ source: "muse", model: "muse-spark-1.3", notice: PEOPLE_LIMIT_KEPT_NOTICE, stale: false });
    expect(member(kept, b).shared).toEqual(["jazz"]);
    expect(await match(t, eventId, { force: true })).toBe("current");
    expect(await all(t, "peopleMatches")).toHaveLength(1);

    // Once the lists change there is no current Muse result to keep, so the wording match is shown until tomorrow.
    await save(t, tokenB, ["Specialty Coffee", "jazz", "ceramics"]);
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "basic", stale: true });
    expect(await match(t, eventId)).toBe("current");
    expect(fetchMock).toHaveBeenCalledTimes(PEOPLE_DAILY_LIMIT * 2);
    const capped = await snap(t, tokenA, eventId);
    expect(capped.matching).toEqual({ source: "basic", notice: PEOPLE_LIMIT_NOTICE, stale: false });
    expect(PEOPLE_LIMIT_NOTICE).toMatch(/today’s limit/);
    expect(PEOPLE_LIMIT_KEPT_NOTICE).toMatch(/today’s limit/);
    expect(member(capped, b)).toMatchObject({ shared: ["coffee", "jazz"], opener: "What got you into coffee?" });
    expect((await all(t, "discoverUsage")).map((row) => [row.profileId, row.day, row.count, row.people])).toEqual([[a, "2026-11-11", 0, PEOPLE_DAILY_LIMIT]]);

    // The Discover allowance is untouched by people matching.
    expect((await t.action(anyApi.discover.recommend, { token: tokenA, interests: ["bouldering"] })).source).toBe("muse");
    expect((await all(t, "discoverUsage")).map((row) => [row.count, row.people])).toEqual([[1, PEOPLE_DAILY_LIMIT]]);

    // A new UTC day starts a new allowance.
    vi.setSystemTime(new Date("2026-11-12T00:00:05Z"));
    expect(await match(t, eventId, { force: true })).toBe("muse");
    expect((await all(t, "discoverUsage")).map((row) => [row.day, row.count, row.people])).toEqual([["2026-11-12", 0, 1]]);
  });
  it("is not used up by Discover calls", async () => {
    configure();
    const { fetchMock } = provider(reply);
    const { t, a, eventId } = await party();
    await save(t, tokenA, ["jazz"]); await save(t, tokenB, ["jazz"]);
    await t.run(async (ctx) => { await ctx.db.insert("discoverUsage", { profileId: a as any, day: "2026-11-11", count: DISCOVER_DAILY_LIMIT }); });
    await expect(t.action(anyApi.discover.recommend, { token: tokenA, interests: ["bouldering"] })).rejects.toThrow(/today's limit/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await match(t, eventId)).toBe("muse");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await all(t, "discoverUsage")).map((row) => [row.count, row.people])).toEqual([[DISCOVER_DAILY_LIMIT, 1]]);
  });
  it("counts each person separately", async () => {
    configure();
    provider(reply);
    const { t, a, b, eventId } = await party();
    await save(t, tokenA, ["jazz"]); await save(t, tokenB, ["jazz"]);
    await match(t, eventId); await match(t, eventId, { force: true });
    await match(t, eventId, { token: tokenB });
    const used = new Map((await all(t, "discoverUsage")).map((row) => [row.profileId as string, row.people]));
    expect(used.get(a)).toBe(2); expect(used.get(b)).toBe(1);
  });
});

describe("Facebook Login helpers", () => {
  it("accepts only the root of an HTTPS address, or plain HTTP on this machine", () => {
    expect(facebookRedirect("https://glancear.vercel.app/")).toBe("https://glancear.vercel.app/");
    expect(facebookRedirect("https://glancear.vercel.app")).toBe("https://glancear.vercel.app/");
    expect(facebookRedirect("http://localhost:8081/")).toBe("http://localhost:8081/");
    expect(facebookRedirect("http://127.0.0.1:8766/")).toBe("http://127.0.0.1:8766/");
    for (const bad of [
      "http://glancear.vercel.app/", "http://example.com/", "http://localhost.example.com/", "http://127.0.0.1.example.com/",
      "https://glancear.vercel.app/callback", "https://glancear.vercel.app/?next=1", "https://glancear.vercel.app/#token",
      "https://user:pass@glancear.vercel.app/", "https://user@glancear.vercel.app/", "http://localhost:8081/auth",
      "", "glancear.vercel.app", "not a url", "javascript:alert(1)", "ftp://glancear.vercel.app/", "exp://127.0.0.1:8081/",
      `https://${"a".repeat(300)}.example.com/`,
    ]) expect(() => facebookRedirect(bad), bad).toThrow("FB_BAD_REDIRECT");
  });
  it("reads the app credentials with safe defaults", () => {
    const env = { FACEBOOK_APP_ID: ` ${APP_ID} `, FACEBOOK_APP_SECRET: ` ${APP_SECRET} ` };
    expect(facebookConfig(env)).toEqual({ appId: APP_ID, secret: APP_SECRET, version: "v27.0", dialog: "https://www.facebook.com", graph: "https://graph.facebook.com" });
    expect(facebookConfig({
      ...env, FACEBOOK_GRAPH_VERSION: "v30.1", FACEBOOK_DIALOG_BASE_URL: "http://dialog.test//", FACEBOOK_GRAPH_BASE_URL: " http://graph.test/ ",
    })).toEqual({ appId: APP_ID, secret: APP_SECRET, version: "v30.1", dialog: "http://dialog.test", graph: "http://graph.test" });
    for (const bad of [
      {}, { FACEBOOK_APP_SECRET: APP_SECRET }, { FACEBOOK_APP_ID: APP_ID }, { FACEBOOK_APP_ID: APP_ID, FACEBOOK_APP_SECRET: "   " },
      { ...env, FACEBOOK_APP_ID: "my-app" }, { ...env, FACEBOOK_APP_ID: "1234" }, { ...env, FACEBOOK_APP_ID: "12345abc" },
      { ...env, FACEBOOK_GRAPH_VERSION: "27.0" }, { ...env, FACEBOOK_GRAPH_VERSION: "v27" }, { ...env, FACEBOOK_GRAPH_VERSION: "v27.0/../v1.0" },
    ]) expect(() => facebookConfig(bad), JSON.stringify(bad)).toThrow("FB_NOT_CONFIGURED");
  });
  it("builds the Login dialog address for the code flow", () => {
    const state = "f".repeat(64);
    const url = new URL(dialogUrl(facebookConfig({ FACEBOOK_APP_ID: APP_ID, FACEBOOK_APP_SECRET: APP_SECRET }), REDIRECT, state));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v27.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: APP_ID, redirect_uri: REDIRECT, state, scope: "user_likes,user_posts", response_type: "code" });
    expect(FACEBOOK_SCOPES).toBe("user_likes,user_posts");
    expect(url.href).not.toContain(APP_SECRET);
  });
  it("signs Graph calls with HMAC-SHA256 of the access token under the app secret", () => {
    expect(appSecretProof(APP_SECRET, ACCESS_TOKEN)).toBe(createHmac("sha256", APP_SECRET).update(ACCESS_TOKEN).digest("hex"));
    expect(appSecretProof("s", "t")).toBe(createHmac("sha256", "s").update("t").digest("hex"));
    expect(appSecretProof(APP_SECRET, ACCESS_TOKEN)).not.toBe(appSecretProof(ACCESS_TOKEN, APP_SECRET));
  });
});

describe("Connect Facebook", () => {
  const PAGES = [{ name: "Crux Climbing Gym", category: "Rock Climbing Gym", id: "1" }, { name: "Flat Track Roasters", category: "Coffee shop", id: "2" }];
  const POSTS = [{ message: "Finally sent the purple overhang problem today", id: "p1" }, { id: "p2" }, { message: "Pulled a great shot of the Kenyan natural", id: "p3" }];
  const READ = { interests: ["bouldering", "specialty coffee"], summary: "Climbing and coffee." };
  const SECRETS = [ACCESS_TOKEN, CODE, APP_SECRET, "Crux Climbing Gym", "Flat Track Roasters", "purple overhang", "Kenyan natural"];
  const proof = createHmac("sha256", APP_SECRET).update(ACCESS_TOKEN).digest("hex");
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  type Hit = { method: string; url: URL; step: "token" | "likes" | "posts" | "revoke" | "muse" | "other"; body?: any };
  type Routes = Partial<Record<"token" | "likes" | "posts" | "revoke" | "muse", (hit: Hit) => Response | unknown>>;

  /** Routes each request to a stand-in for the Graph API or for Muse, recording the order. */
  function network(routes: Routes = {}) {
    const hits: Hit[] = [];
    const defaults: Required<Routes> = {
      token: () => ({ access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 5000 }),
      likes: () => ({ data: PAGES }),
      posts: () => ({ data: POSTS }),
      revoke: () => ({ success: true }),
      muse: () => READ,
    };
    const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input), method = init.method ?? "GET";
      const step: Hit["step"] = url.origin === BASE && url.pathname === "/v1/chat/completions" ? "muse"
        : url.origin !== GRAPH ? "other"
        : url.pathname === "/v27.0/oauth/access_token" && method === "GET" ? "token"
        : url.pathname === "/v27.0/me/likes" && method === "GET" ? "likes"
        : url.pathname === "/v27.0/me/posts" && method === "GET" ? "posts"
        : url.pathname === "/v27.0/me/permissions" && method === "DELETE" ? "revoke" : "other";
      const hit: Hit = { method, url, step, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
      hits.push(hit);
      if (step === "other") return new Response("unexpected request", { status: 404 });
      const value = (routes[step] ?? defaults[step])(hit);
      if (value instanceof Response) return value;
      return step === "muse" ? museResponse(value) : json(value);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { hits, fetchMock, steps: () => hits.map((hit) => hit.step) };
  }
  const configureFacebook = () => {
    configure();
    vi.stubEnv("FACEBOOK_APP_ID", APP_ID); vi.stubEnv("FACEBOOK_APP_SECRET", APP_SECRET); vi.stubEnv("FACEBOOK_GRAPH_BASE_URL", `${GRAPH}/`);
  };
  const begin = (t: T, token = tokenA, redirectUri = REDIRECT): Promise<{ url: string; state: string }> => t.action(anyApi.facebook.begin, { token, redirectUri });
  const complete = (t: T, state: string, token = tokenA, code = CODE) => t.action(anyApi.facebook.complete, { token, state, code });
  const failure = (promise: Promise<unknown>): Promise<string> => promise.then(() => "(resolved)", (error: Error) => error.message);
  async function people() {
    const t = makeTest();
    const a: string = await t.mutation(anyApi.glance.register, { token: tokenA, name: "Alex Chen", role: "Builder", photoUrl: "" });
    const b: string = await t.mutation(anyApi.glance.register, { token: tokenB, name: "Sam Rivera", role: "Designer", photoUrl: "" });
    return { t, a, b };
  }

  describe("begin", () => {
    it("refuses an unregistered device and stores nothing", async () => {
      configureFacebook();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = makeTest();
      await expect(begin(t)).rejects.toThrow(/not registered/);
      await expect(begin(t, "nope")).rejects.toThrow(/Invalid device credential/);
      expect(await all(t, "facebookStates")).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    });
    it.each([
      ["Facebook is not configured", () => configure(), REDIRECT, /Facebook Login is not set up.*FACEBOOK_APP_ID and FACEBOOK_APP_SECRET/, "FB_NOT_CONFIGURED"],
      ["the app id is not a number", () => { configureFacebook(); vi.stubEnv("FACEBOOK_APP_ID", "glance"); }, REDIRECT, /FACEBOOK_APP_ID/, "FB_NOT_CONFIGURED"],
      ["the app secret is missing", () => { configureFacebook(); vi.stubEnv("FACEBOOK_APP_SECRET", ""); }, REDIRECT, /FACEBOOK_APP_SECRET/, "FB_NOT_CONFIGURED"],
      ["Muse is not configured", () => { configureFacebook(); vi.stubEnv("META_API_KEY", ""); }, REDIRECT, /META_API_KEY is missing/, "MISSING_KEY"],
      ["the redirect is a page inside the app", () => configureFacebook(), "https://glancear.vercel.app/events", /open at its own HTTPS address/, "FB_BAD_REDIRECT"],
      ["the redirect is plain HTTP on a public host", () => configureFacebook(), "http://glancear.vercel.app/", /open at its own HTTPS address/, "FB_BAD_REDIRECT"],
    ])("explains when %s", async (_name, arrange, redirectUri, message, code) => {
      arrange();
      const { fetchMock } = network();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { t } = await people();
      await expect(begin(t, tokenA, redirectUri)).rejects.toThrow(message);
      expect(await all(t, "facebookStates")).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log.mock.calls.map((args) => String(args[0]))).toEqual([`Facebook connect failed: ${code}`]);
    });
    it("returns the Login dialog with a one-time state and keeps only the state's hash", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t, a } = await people();
      const { url, state } = await begin(t, tokenA, "https://glancear.vercel.app");
      expect(state).toMatch(/^[a-f0-9]{64}$/);
      const dialog = new URL(url);
      expect(`${dialog.origin}${dialog.pathname}`).toBe("https://www.facebook.com/v27.0/dialog/oauth");
      expect(Object.fromEntries(dialog.searchParams)).toEqual({ client_id: APP_ID, redirect_uri: REDIRECT, state, scope: "user_likes,user_posts", response_type: "code" });
      expect(url).not.toContain(APP_SECRET);
      const rows = await all(t, "facebookStates");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ profileId: a, redirectUri: REDIRECT, stateHash: createHash("sha256").update(state).digest("hex") });
      // Ten minutes from now (convex-test may run a transaction one millisecond ahead of a frozen clock).
      expect(rows[0].expiresAt - Date.now() - 10 * 60_000).toBeGreaterThanOrEqual(0);
      expect(rows[0].expiresAt - Date.now() - 10 * 60_000).toBeLessThanOrEqual(1);
      expect(FACEBOOK_STATE_TTL_MS).toBe(600_000);
      expect(Object.keys(rows[0]).sort()).toEqual(["_creationTime", "_id", "expiresAt", "profileId", "redirectUri", "stateHash"]);
      expect(await dump(t)).not.toContain(state);
      expect(fetchMock).not.toHaveBeenCalled();
      // Beginning needs no Muse allowance and does not opt anyone in.
      expect(await all(t, "discoverUsage")).toEqual([]);
      expect(await all(t, "interestProfiles")).toEqual([]);
    });
    it("keeps one pending sign-in per person and invalidates the earlier one", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t, a, b } = await people();
      const first = await begin(t);
      const second = await begin(t);
      const theirs = await begin(t, tokenB, "http://localhost:8081/");
      expect(new Set([first.state, second.state, theirs.state]).size).toBe(3);
      const rows = await all(t, "facebookStates");
      expect(rows.map((row) => row.profileId).sort()).toEqual([a, b].sort());
      expect(rows.find((row) => row.profileId === a)!.stateHash).toBe(createHash("sha256").update(second.state).digest("hex"));
      await expect(complete(t, first.state)).rejects.toThrow(/expired or was already used/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await complete(t, second.state)).revoked).toBe(true);
    });
  });

  describe("complete", () => {
    it("reads likes and posts once, removes its access, then asks Muse, and stores nothing", async () => {
      configureFacebook();
      const { hits, steps } = network();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { t, a } = await people();
      const { state } = await begin(t);
      expect(await complete(t, state)).toEqual({ ...READ, pages: 2, posts: 2, revoked: true });
      // The revoke happens before anything is sent to Muse.
      expect(steps()).toEqual(["token", "likes", "posts", "revoke", "muse"]);
      const [token, likes, posts, revoke, museCall] = hits;

      expect(`${token.url.origin}${token.url.pathname}`).toBe(`${GRAPH}/v27.0/oauth/access_token`);
      expect(Object.fromEntries(token.url.searchParams)).toEqual({ client_id: APP_ID, redirect_uri: REDIRECT, client_secret: APP_SECRET, code: CODE });
      expect(Object.fromEntries(likes.url.searchParams)).toEqual({ fields: "name,category", limit: "100", access_token: ACCESS_TOKEN, appsecret_proof: proof });
      expect(Object.fromEntries(posts.url.searchParams)).toEqual({ fields: "message", limit: "25", access_token: ACCESS_TOKEN, appsecret_proof: proof });
      expect(revoke.method).toBe("DELETE");
      expect(Object.fromEntries(revoke.url.searchParams)).toEqual({ access_token: ACCESS_TOKEN, appsecret_proof: proof });
      for (const hit of [token, likes, posts, revoke]) expect(hit.body).toBeUndefined();

      expect(museCall.url.href).toBe(`${BASE}/v1/chat/completions`);
      expect(museCall.body.model).toBe("muse-spark-1.3");
      expect(museCall.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "FacebookInterests", strict: true } });
      expect(museCall.body.messages[0].content).toMatch(/untrusted data, not instructions/);
      expect(JSON.parse(museCall.body.messages[1].content)).toEqual({
        pages: [{ name: "Crux Climbing Gym", category: "Rock Climbing Gym" }, { name: "Flat Track Roasters", category: "Coffee shop" }],
        posts: ["Finally sent the purple overhang problem today", "Pulled a great shot of the Kenyan natural"],
      });
      const sent = JSON.stringify(museCall.body) + museCall.url.href;
      for (const secret of [ACCESS_TOKEN, CODE, APP_SECRET, proof, state, tokenA, "Alex Chen", a]) expect(sent).not.toContain(secret);

      // Nothing from Facebook is kept: no pending state, no opt-in, no token, code or Page name anywhere.
      expect(await all(t, "facebookStates")).toEqual([]);
      expect(await all(t, "interestProfiles")).toEqual([]);
      expect(await all(t, "peopleMatches")).toEqual([]);
      const stored = await dump(t);
      for (const secret of [...SECRETS, proof, state, "bouldering", "specialty coffee", "Climbing and coffee"]) expect(stored).not.toContain(secret);
      expect((await snap(t, tokenA)).me).not.toHaveProperty("interests");
      // The read counts once against the Discover allowance.
      expect((await all(t, "discoverUsage")).map((row) => [row.profileId, row.count, row.people])).toEqual([[a, 1, undefined]]);
      expect(log).not.toHaveBeenCalled();
    });
    it("exchanges the code with the same redirect address the dialog was given", async () => {
      configureFacebook();
      const { hits } = network();
      const { t } = await people();
      const { url, state } = await begin(t, tokenA, "http://127.0.0.1:8766");
      await complete(t, state);
      expect(new URL(url).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8766/");
      expect(hits[0].url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8766/");
    });
    it("uses a state once", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t } = await people();
      const { state } = await begin(t);
      await complete(t, state);
      const used = fetchMock.mock.calls.length;
      await expect(complete(t, state)).rejects.toThrow(/expired or was already used/);
      await expect(complete(t, state, tokenA, "another-code")).rejects.toThrow(/expired or was already used/);
      expect(fetchMock).toHaveBeenCalledTimes(used);
      expect((await all(t, "discoverUsage"))[0].count).toBe(1);
    });
    it("only lets the device that began complete the sign-in", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t, a } = await people();
      const { state } = await begin(t);
      await expect(complete(t, state, tokenB)).rejects.toThrow(/expired or was already used/);
      await expect(complete(t, state, "d".repeat(64))).rejects.toThrow(/not registered/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await all(t, "discoverUsage")).toEqual([]);
      expect((await all(t, "facebookStates")).map((row) => row.profileId)).toEqual([a]);
      expect((await complete(t, state)).interests).toEqual(READ.interests);
    });
    it("expires a state after ten minutes, and the sweep removes it", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t } = await people();
      const { state } = await begin(t);
      const late = await begin(t, tokenB);
      const expiresAt = Math.min(...(await all(t, "facebookStates")).map((row) => row.expiresAt));
      expect(expiresAt - Date.now()).toBeGreaterThanOrEqual(FACEBOOK_STATE_TTL_MS);
      // convex-test may run a transaction one millisecond ahead of a frozen clock, hence two to spare.
      vi.setSystemTime(expiresAt - 2);
      await t.mutation(anyApi.jobs.sweep, {});
      expect(await all(t, "facebookStates")).toHaveLength(2);
      expect((await complete(t, late.state, tokenB)).revoked).toBe(true);
      vi.setSystemTime(expiresAt);
      const used = fetchMock.mock.calls.length;
      await expect(complete(t, state)).rejects.toThrow(/expired or was already used/);
      expect(fetchMock).toHaveBeenCalledTimes(used);
      expect(await all(t, "facebookStates")).toHaveLength(1);
      await t.mutation(anyApi.jobs.sweep, {});
      expect(await all(t, "facebookStates")).toEqual([]);
    });
    it("rejects a malformed state or code before any database or network work", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const t = makeTest(); // nobody is registered: an authentication error would mean the database was read
      for (const [state, code] of [
        ["", CODE], ["nope", CODE], ["F".repeat(64), CODE], ["f".repeat(63), CODE], ["f".repeat(65), CODE], [`${"f".repeat(63)}g`, CODE],
        ["f".repeat(64), ""], ["f".repeat(64), "x".repeat(4_001)],
      ]) await expect(complete(t, state, tokenA, code)).rejects.toThrow(/could not be verified/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("is refused at the daily Discover cap, leaving the sign-in pending", async () => {
      configureFacebook();
      const { fetchMock } = network();
      const { t, a } = await people();
      const { state } = await begin(t);
      await t.run(async (ctx) => { await ctx.db.insert("discoverUsage", { profileId: a as any, day: "2026-11-11", count: DISCOVER_DAILY_LIMIT, people: 3 }); });
      await expect(complete(t, state)).rejects.toThrow(/today's limit/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await all(t, "facebookStates")).toHaveLength(1);
      expect((await all(t, "discoverUsage")).map((row) => [row.count, row.people])).toEqual([[DISCOVER_DAILY_LIMIT, 3]]);
      // The people-matching count does not stand in the way either: at 39 of 40 the read goes through.
      await t.run(async (ctx) => { const [row] = await ctx.db.query("discoverUsage").collect(); await ctx.db.patch(row._id, { count: DISCOVER_DAILY_LIMIT - 1, people: PEOPLE_DAILY_LIMIT }); });
      expect((await complete(t, state)).revoked).toBe(true);
      expect((await all(t, "discoverUsage")).map((row) => [row.count, row.people])).toEqual([[DISCOVER_DAILY_LIMIT, PEOPLE_DAILY_LIMIT]]);
    });
  });

  describe("reading likes and posts", () => {
    async function run(routes: Routes) {
      configureFacebook();
      const net = network(routes);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { t } = await people();
      const { state } = await begin(t);
      const outcome: { result?: any; error?: string } = await complete(t, state).then((result: unknown) => ({ result }), (error: Error) => ({ error: error.message }));
      const logged = log.mock.calls.map((args) => args.map(String).join(" "));
      // Whatever happened, nothing sensitive was logged, thrown or stored.
      for (const secret of [...SECRETS, proof, state, "secret provider body"]) {
        expect(JSON.stringify(logged)).not.toContain(secret);
        expect(outcome.error ?? "").not.toContain(secret);
        expect(await dump(t)).not.toContain(secret);
      }
      for (const line of logged) expect(line).toMatch(/^Facebook connect failed: [A-Z0-9_]+$/);
      return { ...net, ...outcome, logged, t };
    }
    it("asks for names alone when Facebook rejects the category field", async () => {
      const { hits, result, logged } = await run({
        likes: (hit) => (hit.url.searchParams.get("fields") === "name,category" ? new Response("secret provider body", { status: 400 }) : { data: PAGES.map(({ name }) => ({ name })) }),
      });
      const likes = hits.filter((hit) => hit.step === "likes");
      expect(likes.map((hit) => hit.url.searchParams.get("fields"))).toEqual(["name,category", "name"]);
      expect(Object.fromEntries(likes[1].url.searchParams)).toEqual({ fields: "name", limit: "100", access_token: ACCESS_TOKEN, appsecret_proof: proof });
      expect(result).toMatchObject({ pages: 2, posts: 2, revoked: true });
      expect(JSON.parse(hits.at(-1)!.body.messages[1].content).pages).toEqual([{ name: "Crux Climbing Gym", category: "" }, { name: "Flat Track Roasters", category: "" }]);
      expect(logged).toEqual([]);
    });
    it("gives up on likes after one retry and still reads posts", async () => {
      const { steps, result } = await run({ likes: () => new Response("secret provider body", { status: 400 }) });
      expect(steps()).toEqual(["token", "likes", "likes", "posts", "revoke", "muse"]);
      expect(result).toMatchObject({ pages: 0, posts: 2, revoked: true });
    });
    it("follows paging to a second page of likes and no further", async () => {
      const page = (from: number, after: string) => ({
        data: Array.from({ length: 100 }, (_, i) => ({ name: `Page ${from + i}`, category: "Interest" })),
        paging: { cursors: { before: "b", after }, next: `${GRAPH}/v27.0/me/likes?after=${after}` },
      });
      const { hits, result } = await run({ likes: (hit) => (hit.url.searchParams.get("after") === "cursor-1" ? page(100, "cursor-2") : page(0, "cursor-1")) });
      const likes = hits.filter((hit) => hit.step === "likes");
      expect(likes.map((hit) => hit.url.searchParams.get("after"))).toEqual([null, "cursor-1"]);
      expect(Object.fromEntries(likes[1].url.searchParams)).toEqual({ fields: "name,category", limit: "100", after: "cursor-1", access_token: ACCESS_TOKEN, appsecret_proof: proof });
      expect(result).toMatchObject({ pages: 200, posts: 2, revoked: true });
      const sent = JSON.parse(hits.at(-1)!.body.messages[1].content);
      expect(sent.pages).toHaveLength(200);
      expect(sent.pages[199]).toEqual({ name: "Page 199", category: "Interest" });
    });
    // Regression: a later page failing once threw away the Pages already read from the first.
    it("keeps the first page of likes when the second page fails", async () => {
      const first = { data: PAGES, paging: { cursors: { after: "cursor-1" }, next: `${GRAPH}/v27.0/me/likes?after=cursor-1` } };
      const { hits, result, error } = await run({
        likes: (hit) => (hit.url.searchParams.get("after") ? new Response("secret provider body", { status: 500 }) : first),
        posts: () => ({ data: [] }),
      });
      expect(hits.filter((hit) => hit.step === "likes")).toHaveLength(2);
      expect(error).toBeUndefined();
      expect(result).toEqual({ ...READ, pages: 2, posts: 0, revoked: true });
    });
    it("stops paging when Facebook gives a cursor but no next page", async () => {
      const { hits, result } = await run({ likes: () => ({ data: PAGES, paging: { cursors: { before: "b", after: "cursor-1" } } }) });
      expect(hits.filter((hit) => hit.step === "likes")).toHaveLength(1);
      expect(result).toMatchObject({ pages: 2 });
    });
    it("cleans what Facebook returns before Muse sees it", async () => {
      const { hits, result } = await run({
        likes: () => ({ data: [{ name: "  Crux\nClimbing  Gym " }, { name: "crux climbing gym", category: "Duplicate" }, { name: "" }, { category: "No name" }, null, "text", { name: "N".repeat(200), category: "C".repeat(200) }] }),
        posts: () => ({ data: [{ message: `  spaced\tout  ${"z".repeat(400)}` }, { message: 5 }, { story: "shared a link" }] }),
      });
      const sent = JSON.parse(hits.at(-1)!.body.messages[1].content);
      expect(sent.pages).toEqual([{ name: "Crux Climbing Gym", category: "" }, { name: "N".repeat(80), category: "C".repeat(60) }]);
      expect(sent.posts).toEqual([`spaced out ${"z".repeat(269)}`]);
      expect(result).toMatchObject({ pages: 2, posts: 1 });
    });
    it("works from posts alone when likes are refused", async () => {
      const { steps, result, hits, logged } = await run({ likes: () => new Response("secret provider body", { status: 403 }) });
      expect(steps()).toEqual(["token", "likes", "posts", "revoke", "muse"]);
      expect(result).toEqual({ ...READ, pages: 0, posts: 2, revoked: true });
      expect(JSON.parse(hits.at(-1)!.body.messages[1].content).pages).toEqual([]);
      expect(logged).toEqual([]);
    });
    it("works from likes alone when posts are refused", async () => {
      const { result } = await run({ posts: () => new Response("secret provider body", { status: 403 }) });
      expect(result).toEqual({ ...READ, pages: 2, posts: 0, revoked: true });
    });
    it("says permissions may have been declined when both come back empty, after removing access", async () => {
      const { steps, error, logged, t } = await run({ likes: () => ({ data: [] }), posts: () => ({ data: [{ id: "no message" }] }) });
      expect(error).toMatch(/returned no liked Pages or posts.*declined those permissions/);
      expect(steps()).toEqual(["token", "likes", "posts", "revoke"]);
      expect(logged).toEqual(["Facebook connect failed: FB_EMPTY"]);
      expect(await all(t, "facebookStates")).toEqual([]);
    });
    it("says permissions may have been declined when both are refused, after removing access", async () => {
      const { steps, error, logged } = await run({
        likes: () => new Response("secret provider body", { status: 403 }), posts: () => new Response("secret provider body", { status: 403 }),
      });
      expect(error).toMatch(/would not share your liked Pages or posts.*declined those permissions/);
      expect(steps()).toEqual(["token", "likes", "posts", "revoke"]);
      expect(logged).toEqual(["Facebook connect failed: FB_LIKES_HTTP_403"]);
    });
    it("points at the redirect settings when the code exchange is refused, and reads nothing", async () => {
      const { steps, error, logged, t } = await run({ token: () => json({ error: { message: "secret provider body" } }, 400) });
      expect(error).toMatch(/Valid OAuth Redirect URIs/);
      expect(steps()).toEqual(["token"]);
      expect(logged).toEqual(["Facebook connect failed: FB_TOKEN_HTTP_400"]);
      expect(await all(t, "facebookStates")).toEqual([]); // the state is spent either way
    });
    it("stops when the exchange returns no access token", async () => {
      const { steps, error, logged } = await run({ token: () => ({ token_type: "bearer" }) });
      expect(error).toMatch(/response Glance could not read/);
      expect(steps()).toEqual(["token"]);
      expect(logged).toEqual(["Facebook connect failed: FB_TOKEN_INVALID"]);
    });
    it.each([
      ["refuses", () => new Response("secret provider body", { status: 500 })],
      ["does not confirm", () => ({ success: false })],
    ])("still returns the interests when Facebook %s the revoke, and says so", async (_name, revoke) => {
      const { steps, result, logged } = await run({ revoke });
      expect(result).toEqual({ ...READ, pages: 2, posts: 2, revoked: false });
      expect(steps()).toEqual(["token", "likes", "posts", "revoke", "muse"]);
      expect(logged).toEqual([]);
    });
    it("says so when Muse finds no interests", async () => {
      const { steps, error, logged } = await run({ muse: () => ({ interests: ["x", "  "], summary: "" }) });
      expect(error).toMatch(/Muse did not find interests in your liked Pages or posts/);
      expect(steps()).toEqual(["token", "likes", "posts", "revoke", "muse"]);
      expect(logged).toEqual(["Facebook connect failed: FB_NO_INTERESTS"]);
    });
    it.each([
      ["rejects the key", () => new Response("secret provider body", { status: 401 }), /Meta rejected the API key/, "FACEBOOK_HTTP_401"],
      ["is rate limiting", () => new Response("secret provider body", { status: 429 }), /rate-limiting/, "FACEBOOK_HTTP_429"],
      ["returns nonsense", () => new Response("secret provider body"), /did not pass validation/, "INVALID_FACEBOOK"],
    ])("reports a Muse failure by code when Meta %s", async (_name, museReply, message, code) => {
      const { steps, error, logged } = await run({ muse: museReply });
      expect(error).toMatch(message);
      expect(steps().slice(-2)).toEqual(["revoke", "muse"]);
      expect(logged).toEqual([`Facebook connect failed: ${code}`]);
    });
    it("reports an unreachable Facebook without details", async () => {
      configureFacebook();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`fetch failed for ${GRAPH}/?client_secret=${APP_SECRET}`)));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { t } = await people();
      const { state } = await begin(t);
      const message = await failure(complete(t, state));
      expect(message).toMatch(/could not reach Facebook/);
      expect(message).not.toContain(APP_SECRET);
      expect(log.mock.calls.map((args) => String(args[0]))).toEqual(["Facebook connect failed: FB_TOKEN_NETWORK"]);
    });
    it("cleans and bounds what Muse returns", async () => {
      const { result } = await run({ muse: () => ({ interests: [" Bouldering ", "#bouldering", ...Array.from({ length: 30 }, (_, i) => `topic ${i}`)], summary: ` Climbing\nand   coffee. ${"s".repeat(300)}` }) });
      expect(result.interests).toHaveLength(16);
      expect(result.interests.slice(0, 2)).toEqual(["Bouldering", "topic 0"]);
      expect(result.summary).toHaveLength(200);
      expect(result.summary.startsWith("Climbing and coffee. sss")).toBe(true);
    });
  });
});

describe("sweep", () => {
  it("deletes stored matches after the retention period and keeps fresh ones", async () => {
    const { t, a, b, eventId } = await party();
    const now = Date.now();
    const row = (profileId: string, updatedAt: number) => ({ profileId, eventId, key: "k", matches: [], source: "muse" as const, updatedAt });
    await t.run(async (ctx) => {
      await ctx.db.insert("peopleMatches", row(a, now - PEOPLE_MATCH_RETENTION_MS - 1) as any);
      await ctx.db.insert("peopleMatches", row(b, now - PEOPLE_MATCH_RETENTION_MS + 60_000) as any);
    });
    await t.mutation(anyApi.jobs.sweep, {});
    expect((await all(t, "peopleMatches")).map((r) => r.profileId)).toEqual([b]);
    expect(PEOPLE_MATCH_RETENTION_MS).toBe(24 * 60 * 60_000);
    vi.setSystemTime(now + 60_001);
    await t.mutation(anyApi.jobs.sweep, {});
    expect(await all(t, "peopleMatches")).toEqual([]);
  });
  it("leaves saved interests and unexpired sign-ins alone", async () => {
    const { t, a } = await party();
    await save(t, tokenA, ["coffee"]);
    await t.run(async (ctx) => { await ctx.db.insert("facebookStates", { profileId: a as any, stateHash: "h".repeat(64), redirectUri: REDIRECT, expiresAt: Date.now() + 1 }); });
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60_000);
    await t.mutation(anyApi.jobs.sweep, {});
    expect(await all(t, "interestProfiles")).toHaveLength(1);
    expect(await all(t, "facebookStates")).toEqual([]);
  });
  it("removes a Muse result a day after it was stored, so the app asks again", async () => {
    configure();
    muse([], []);
    const { t, eventId } = await party();
    await save(t, tokenA, ["jazz"]); await save(t, tokenB, ["jazz"]);
    expect(await match(t, eventId)).toBe("muse");
    vi.setSystemTime(Date.now() + PEOPLE_MATCH_RETENTION_MS - 60_000);
    await t.mutation(anyApi.jobs.sweep, {});
    expect(await all(t, "peopleMatches")).toHaveLength(1);
    vi.setSystemTime(Date.now() + 60_010);
    await t.mutation(anyApi.jobs.sweep, {});
    expect(await all(t, "peopleMatches")).toEqual([]);
    expect((await snap(t, tokenA, eventId)).matching).toEqual({ source: "basic", stale: true });
  });
});

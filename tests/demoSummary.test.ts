import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { labelTurns, speakerTranscript } from "../convex/meta";
import { validateWav } from "../convex/validation";
import { concatSamples, encodeWav, resample } from "../src/audio/wav";
import { demoReducer, initialDemo, createDemoEncounter } from "../src/demo";

const modules = {
  "../convex/_generated/server.ts": () => import("../convex/server"),
  "../convex/glance.ts": () => import("../convex/glance"),
  "../convex/jobs.ts": () => import("../convex/jobs"),
  "../convex/pipeline.ts": () => import("../convex/pipeline"),
  "../convex/demoAudio.ts": () => import("../convex/demoAudio"),
  "../convex/demoSummary.ts": () => import("../convex/demoSummary"),
};
const makeTest = () => convexTest({ schema, modules, transactionLimits: true });
const tone = (seconds: number, rate = 16_000) =>
  Float32Array.from({ length: seconds * rate }, (_, i) => 0.3 * Math.sin(i / 8));
const turns = [
  { turnId: 1, startMs: 0, endMs: 2_400, transcript: "Hi, I build tools for designers.", speaker: "B" },
  { turnId: 2, startMs: 2_500, endMs: 5_000, transcript: "Nice, I'm prototyping a camera app.", speaker: "A" },
  { turnId: 3, startMs: 5_100, endMs: 6_000, transcript: "Let's swap demos next week.", speaker: "B" },
];
const recap = { summary: "Speaker 1 builds design tools; Speaker 2 is prototyping a camera app.", topics: ["Design tools"], nextSteps: ["Swap demos next week"] };
function provider() {
  return vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: turns.map((t) => t.transcript).join(" "), turns })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recap) } }] })));
}
async function stored(t: ReturnType<typeof makeTest>) {
  return t.run((ctx) => ctx.storage.store(new Blob([encodeWav(tone(2))], { type: "audio/wav" })));
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T15:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("browser WAV encoding", () => {
  it("produces mono 16-bit 16 kHz PCM that the backend validator accepts", () => {
    const wav = encodeWav(resample(concatSamples([tone(1, 48_000), tone(1, 48_000)]), 48_000, 16_000));
    expect(validateWav(wav)).toEqual({ durationMs: 2_000, sampleRate: 16_000 });
  });
  it("clamps out-of-range samples instead of wrapping", () => {
    const view = new DataView(encodeWav(Float32Array.from([2, -2, 0])));
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, -32768, 0]);
  });
});

describe("speaker labelling", () => {
  it("numbers anonymous speakers by first appearance and skips malformed turns", () => {
    const labelled = labelTurns([...turns, { speaker: "A", startMs: 9, endMs: 1, transcript: "backwards" }, null, { transcript: " " }]);
    expect(labelled.map((t) => t.speaker)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1"]);
    expect(labelTurns(undefined)).toEqual([]);
  });
  it("merges consecutive turns from one speaker for the summarizer", () => {
    const text = speakerTranscript([
      { speaker: "Speaker 1", startMs: 0, endMs: 1, text: "Hello." },
      { speaker: "Speaker 1", startMs: 1, endMs: 2, text: "Again." },
      { speaker: "Speaker 2", startMs: 2, endMs: 3, text: "Hi." },
    ]);
    expect(text).toBe("Speaker 1: Hello. Again.\nSpeaker 2: Hi.");
  });
});

describe("local demo summaries", () => {
  it("are off unless the deployment enables them, and never touch storage when off", async () => {
    const t = makeTest();
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(t.mutation(anyApi.demoAudio.generateUploadUrl, {})).rejects.toThrow(/disabled/);
    const storageId = await stored(t);
    await expect(t.action(anyApi.demoSummary.summarize, { storageId })).rejects.toThrow(/disabled/);
    expect(network).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true);
  });

  it("returns a validated recap with a Speaker 1/2 transcript and deletes the upload", async () => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    vi.stubEnv("META_API_BASE_URL", "http://127.0.0.1:9999/");
    const fetchMock = provider(); vi.stubGlobal("fetch", fetchMock);
    expect(typeof await t.mutation(anyApi.demoAudio.generateUploadUrl, {})).toBe("string");
    const storageId = await stored(t);
    const result = await t.action(anyApi.demoSummary.summarize, { storageId });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:9999/v1/asr/transcribe");
    expect(JSON.parse(await fetchMock.mock.calls[0][1].body.get("request").text()).mode).toBe("DIARIZATION");
    const prompt = JSON.parse(fetchMock.mock.calls[1][1].body).messages[1].content;
    expect(prompt).toBe("Speaker 1: Hi, I build tools for designers.\nSpeaker 2: Nice, I'm prototyping a camera app.\nSpeaker 1: Let's swap demos next week.");
    expect(result.recap).toMatchObject({ ...recap, source: "ai" });
    expect(result.recap.transcript.map((turn: { speaker: string }) => turn.speaker)).toEqual(["Speaker 1", "Speaker 2", "Speaker 1"]);
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });

  it("hides provider failures behind a safe message and still deletes the upload", async () => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-error", { status: 503 })));
    const storageId = await stored(t);
    const failure = t.action(anyApi.demoSummary.summarize, { storageId });
    await expect(failure).rejects.toThrow(/AI processing failed/);
    await expect(failure).rejects.not.toThrow(/private-provider-error/);
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });

  it("reports a missing key without calling the provider", async () => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(t.action(anyApi.demoSummary.summarize, { storageId: await stored(t) })).rejects.toThrow(/not configured/);
    expect(network).not.toHaveBeenCalled();
  });

  it("refuses, and never deletes, a real conversation's recording", async () => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "unit-test-not-a-real-key");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const storageId = await stored(t);
    await t.run(async (ctx) => {
      const profile = { tokenHash: "x", name: "A", role: "", photoUrl: "data:image/png;base64,AA==" };
      const a = await ctx.db.insert("profiles", profile), b = await ctx.db.insert("profiles", { ...profile, tokenHash: "y" });
      const eventId = await ctx.db.insert("events", { title: "E", location: "", inviteCode: "CODE", hostId: a });
      await ctx.db.insert("conversations", {
        eventId, participantA: a, participantB: b, recorderId: a, status: "ended", recordingConsent: [a, b],
        exchangeConsent: [], lastSeen: {}, generation: 0, audioStorageId: storageId,
      });
    });
    await expect(t.action(anyApi.demoSummary.summarize, { storageId })).rejects.toThrow(/belongs to a conversation/);
    expect(network).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true);
  });
});

describe("specific, body-free provider failures", () => {
  it.each([
    [401, "transcription", /Meta rejected the API key/, "ASR_HTTP_401"],
    [429, "transcription", /rate-limiting/, "ASR_HTTP_429"],
    [413, "transcription", /could not accept this recording/, "ASR_HTTP_413"],
    [403, "summary", /Meta rejected the API key/, "SUMMARY_HTTP_403"],
  ] as const)("HTTP %i from %s explains what to fix and logs only the code", async (status, step, message, code) => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "unit-test-secret-key");
    const failure = new Response("private-provider-body", { status });
    vi.stubGlobal("fetch", step === "transcription" ? vi.fn().mockResolvedValue(failure)
      : vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "Hello there.", turns }))).mockResolvedValueOnce(failure));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(t.action(anyApi.demoSummary.summarize, { storageId: await stored(t) })).rejects.toThrow(message);
    const lines = logged.mock.calls.flat().join(" ");
    expect(lines).toContain(code);
    expect(lines).not.toMatch(/private-provider-body|unit-test-secret-key/);
    logged.mockRestore();
  });

  it("a network failure says the backend could not reach Meta", async () => {
    const t = makeTest();
    vi.stubEnv("GLANCE_DEMO_SUMMARIES", "enabled");
    vi.stubEnv("META_API_KEY", "unit-test-secret-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(t.action(anyApi.demoSummary.summarize, { storageId: await stored(t) })).rejects.toThrow(/could not reach Meta/);
    expect(logged.mock.calls.flat().join(" ")).toContain("ASR_NETWORK");
    logged.mockRestore();
  });
});

describe("preview conversation summaries", () => {
  const encounter = () => {
    const state = initialDemo();
    return demoReducer(state, { type: "pair", conversation: createDemoEncounter(state, "builders", "sam", "c") });
  };
  it("opens chat with the recap pending, then fills it with the real summary", () => {
    let state = demoReducer(encounter(), { type: "finish", id: "c", method: "gesture", awaitingSummary: true });
    expect(state.conversations[0].status).toBe("processing");
    expect(state.conversations[0].recap).toBeUndefined();
    expect(state.conversations[0].connectedAt).toBeDefined();
    state = demoReducer(state, { type: "actor", id: "sam" });
    state = demoReducer(state, { type: "recap", id: "c", recap: { ...recap, source: "ai", transcript: [] } });
    expect(state.conversations[0]).toMatchObject({ status: "shared", recap: { summary: recap.summary, source: "ai" } });
    // A late duplicate never replaces a published recap.
    state = demoReducer(state, { type: "recapFailed", id: "c", error: "late" });
    expect(state.conversations[0].status).toBe("shared");
  });
  it("shows the failure, keeps the connection, and keeps the sample recap path without audio", () => {
    const failed = demoReducer(demoReducer(encounter(), { type: "finish", id: "c", method: "button", awaitingSummary: true }),
      { type: "recapFailed", id: "c", error: "No intelligible speech was returned." });
    expect(failed.conversations[0]).toMatchObject({ status: "failed", error: "No intelligible speech was returned." });
    expect(failed.conversations[0].connectedAt).toBeDefined();
    const sample = demoReducer(encounter(), { type: "finish", id: "c", method: "gesture" });
    expect(sample.conversations[0]).toMatchObject({ status: "shared", recap: { source: "sample" } });
  });
});

import type { Recap } from "../src/domain";

const SUMMARY_LIMIT = 2000;
const ITEM_LIMIT = 300;
const LIST_LIMIT = 12;
const clip = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

/**
 * Cleans a model's recap before validation, so a small flaw does not cost the whole recap:
 * spaces around text, blank list items, a missing list, and text or lists past their limits.
 * It never adds content. Anything of the wrong type or with other fields is left as it is,
 * for validateRecap to reject.
 */
export function tidyRecap(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const data: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (typeof data.summary === "string") data.summary = clip(data.summary.trim(), SUMMARY_LIMIT);
  for (const key of ["topics", "nextSteps"]) {
    const list = data[key];
    if (list === null) data[key] = [];
    else if (Array.isArray(list) && list.every((item) => typeof item === "string")) {
      data[key] = (list as string[]).map((item) => clip(item.trim(), ITEM_LIMIT)).filter(Boolean).slice(0, LIST_LIMIT);
    }
  }
  return data;
}

/**
 * Throws a code that names the flaw and nothing else (never the text), so a failure can be
 * diagnosed from the logs: INVALID_RECAP_SHAPE, _FIELDS, _SUMMARY, _TOPICS or _NEXT_STEPS.
 */
export function validateRecap(value: unknown): Recap & { source: "ai" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RECAP_SHAPE");
  const data = value as Record<string, unknown>;
  const list = (input: unknown): input is string[] =>
    Array.isArray(input) && input.length <= LIST_LIMIT && input.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= ITEM_LIMIT);
  if (Object.keys(data).sort().join(",") !== "nextSteps,summary,topics") throw new Error("INVALID_RECAP_FIELDS");
  if (typeof data.summary !== "string" || !data.summary.trim() || data.summary.length > SUMMARY_LIMIT) throw new Error("INVALID_RECAP_SUMMARY");
  if (!list(data.topics)) throw new Error("INVALID_RECAP_TOPICS");
  if (!list(data.nextSteps)) throw new Error("INVALID_RECAP_NEXT_STEPS");
  return { summary: data.summary, topics: data.topics, nextSteps: data.nextSteps, source: "ai" };
}

/** Inspect all RIFF chunks, not just a presumed 44-byte header. */
export function validateWav(buffer: ArrayBuffer, maxDurationMs = 600_000): { durationMs: number; sampleRate: number } {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tag = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length < 44 || bytes.length > 30_000_000 || tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE") throw new Error("INVALID_WAV");
  if (view.getUint32(4, true) + 8 > bytes.length) throw new Error("INVALID_WAV");
  let sampleRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error("INVALID_WAV");
    if (tag(offset, 4) === "fmt ") {
      if (size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 ||
        view.getUint16(start + 14, true) !== 16 || view.getUint16(start + 12, true) !== 2) throw new Error("INVALID_WAV");
      sampleRate = view.getUint32(start + 4, true);
      if (![16_000, 24_000].includes(sampleRate) || view.getUint32(start + 8, true) !== sampleRate * 2) throw new Error("INVALID_WAV");
    }
    if (tag(offset, 4) === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!sampleRate || !dataBytes || dataBytes % 2) throw new Error("INVALID_WAV");
  const durationMs = dataBytes / (sampleRate * 2) * 1000;
  if (durationMs > Math.min(600_000, maxDurationMs)) throw new Error("AUDIO_TOO_LONG");
  return { durationMs, sampleRate };
}

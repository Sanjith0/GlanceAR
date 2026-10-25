import type { Recap } from "../src/domain";

export function validateRecap(value: unknown): Recap & { source: "ai" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RECAP");
  const data = value as Record<string, unknown>;
  const list = (input: unknown): input is string[] =>
    Array.isArray(input) && input.length <= 12 && input.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= 300);
  if (Object.keys(data).sort().join(",") !== "nextSteps,summary,topics" ||
    typeof data.summary !== "string" || !data.summary.trim() || data.summary.length > 2000 ||
    !list(data.topics) || !list(data.nextSteps)) throw new Error("INVALID_RECAP");
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

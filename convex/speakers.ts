import type { Recap, SpeakerTurn } from "../src/domain";

/** A turn as the transcription returns it, before anyone is put to a voice. */
type PlainTurn = Omit<SpeakerTurn, "speakerId">;

/** Where the samples are in a mono 16-bit PCM WAV that validateWav has already accepted. */
function wavSamples(buffer: ArrayBuffer): { view: DataView; offset: number; count: number; sampleRate: number } | null {
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  let sampleRate = 0;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > buffer.byteLength) return null;
    if (tag(at) === "fmt " && size >= 16) sampleRate = view.getUint32(start + 4, true);
    if (tag(at) === "data" && sampleRate) return { view, offset: start, count: Math.floor(size / 2), sampleRate };
    at = start + size + (size % 2);
  }
  return null;
}

/** Mean signal power of each speaker's turns. A speaker with no audible samples is left out. */
export function speakerLoudness(wav: ArrayBuffer, turns: PlainTurn[]): Map<string, number> {
  const loudness = new Map<string, number>();
  const audio = wavSamples(wav);
  if (!audio) return loudness;
  const totals = new Map<string, { power: number; samples: number }>();
  // Every fourth sample is plenty to compare two voices, and keeps a ten-minute recording quick.
  const STEP = 4;
  for (const turn of turns) {
    const from = Math.max(0, Math.floor(turn.startMs / 1000 * audio.sampleRate));
    const to = Math.min(audio.count, Math.ceil(turn.endMs / 1000 * audio.sampleRate));
    const total = totals.get(turn.speaker) ?? { power: 0, samples: 0 };
    for (let index = from; index < to; index += STEP) {
      const sample = audio.view.getInt16(audio.offset + index * 2, true);
      total.power += sample * sample;
      total.samples += 1;
    }
    totals.set(turn.speaker, total);
  }
  for (const [speaker, total] of totals) if (total.samples > 0) loudness.set(speaker, total.power / total.samples);
  return loudness;
}

/**
 * Puts the two participants to the two main voices in the recording. The recording is made
 * on the recorder's own device, so the louder voice is taken to be the recorder's. This is
 * an estimate from the audio, not an identification: the app says so wherever it shows the
 * names. With fewer than two voices, or no usable audio, nobody is named.
 */
export function nameSpeakers<Id extends string>(
  turns: PlainTurn[], wav: ArrayBuffer, recorderId: Id, partnerId: Id | undefined,
): (PlainTurn & { speakerId?: Id })[] {
  if (!partnerId) return turns;
  const talk = new Map<string, number>();
  for (const turn of turns) talk.set(turn.speaker, (talk.get(turn.speaker) ?? 0) + (turn.endMs - turn.startMs));
  const loudness = speakerLoudness(wav, turns);
  // The two who spoke longest; anyone else in the recording keeps an anonymous label.
  const main = [...talk.keys()].filter((speaker) => loudness.has(speaker))
    .sort((a, b) => talk.get(b)! - talk.get(a)!).slice(0, 2);
  if (main.length < 2) return turns;
  const [louder, quieter] = loudness.get(main[0])! >= loudness.get(main[1])! ? main : [main[1], main[0]];
  const ids = new Map<string, Id>([[louder, recorderId], [quieter, partnerId]]);
  return turns.map((turn) => ids.has(turn.speaker) ? { ...turn, speakerId: ids.get(turn.speaker)! } : turn);
}

/**
 * What is shared when the words are known but the AI summary could not be written: the
 * transcript on its own. A recording the service did not split into turns becomes one
 * unlabelled turn.
 */
export function transcriptOnly<Turn extends PlainTurn>(
  turns: Turn[], transcript: string, durationMs: number,
): Omit<Recap, "source" | "transcript"> & { source: "transcript"; transcript: (Turn | PlainTurn)[] } {
  const whole: PlainTurn = { speaker: "", startMs: 0, endMs: Math.max(0, Math.round(durationMs)), text: transcript.trim().slice(0, 4_000) };
  return { summary: "", topics: [], nextSteps: [], source: "transcript", transcript: turns.length ? turns : [whole] };
}

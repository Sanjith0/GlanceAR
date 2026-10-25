/** Pure PCM helpers for browser capture. Output matches convex/validation.ts validateWav. */
export const WAV_SAMPLE_RATE = 16_000;

export function concatSamples(chunks: Float32Array[]): Float32Array {
  const output = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Linear resampling; adequate for speech recognition, not for music. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !input.length) return input;
  const output = new Float32Array(Math.max(1, Math.round(input.length * to / from)));
  const step = from / to;
  for (let i = 0; i < output.length; i++) {
    const position = i * step, index = Math.floor(position), fraction = position - index;
    const next = input[Math.min(index + 1, input.length - 1)];
    output[i] = input[Math.min(index, input.length - 1)] * (1 - fraction) + next * fraction;
  }
  return output;
}

/** Mono, signed 16-bit little-endian PCM in a minimal RIFF/WAVE container. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

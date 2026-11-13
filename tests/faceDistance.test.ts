import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_MAX_DESCRIPTORS, FACE_SCAN_SAMPLES, type FaceTemplate } from '../src/domain';
import { keepFarSamples, matchDescriptor, validDescriptors, SMALL_FACE_WIDTH } from '../src/face';
import { dedupe, tileOrigins } from '../src/capture/faceDetect';

const vec = (value: number, length = 128) => Array.from({ length }, (_, i) => (i === 0 ? value : 0));
const template = (profileId: string, ...values: number[]): FaceTemplate =>
  ({ profileId, model: 'm', descriptors: values.map(v => vec(v)) } as unknown as FaceTemplate);

describe('far-sighted scans', () => {
  it('accepts close-up plus far samples, and no more', () => {
    expect(FACE_MAX_DESCRIPTORS).toBeGreaterThan(FACE_SCAN_SAMPLES);
    expect(validDescriptors(Array.from({ length: FACE_MAX_DESCRIPTORS }, () => vec(0.1)))).toBe(true);
    expect(validDescriptors(Array.from({ length: FACE_MAX_DESCRIPTORS + 1 }, () => vec(0.1)))).toBe(false);
  });

  it('keeps far samples that still look like the scan and drops bad reads', () => {
    const near = [vec(0.1), vec(0.12)];
    expect(keepFarSamples(near, [vec(0.4), vec(0.95)])).toEqual([vec(0.4)]);
  });

  it('matches against the closest of the close and far samples', () => {
    const templates = [template('a', 0, 0.4), template('b', 0.9)];
    // 0.43 from a's close sample but 0.03 from its far one.
    expect(matchDescriptor(vec(0.43), templates)?.profileId).toBe('a');
  });

  it('asks for a wider margin on small faces', () => {
    const templates = [template('a', 0.2), template('b', 0.3)];
    // 0.1 apart: enough for a normal face (0.06), not for a small one (0.1 needed, 0.09 here).
    const probe = vec(0.21);
    expect(matchDescriptor(probe, templates, SMALL_FACE_WIDTH + 20)?.profileId).toBe('a');
    expect(matchDescriptor(probe, templates, SMALL_FACE_WIDTH - 10)).toBeNull();
    expect(matchDescriptor(vec(0.1), [template('a', 0.2), template('b', 0.5)], SMALL_FACE_WIDTH - 10)?.profileId).toBe('a'); // a clear winner still matches
  });
});

describe('tiled detection geometry', () => {
  it('uses one square for a squarish frame and two overlapping squares along the long side', () => {
    expect(tileOrigins(480, 480)).toEqual([{ x: 0, y: 0, side: 480 }]);
    expect(tileOrigins(504, 896)).toEqual([{ x: 0, y: 0, side: 504 }, { x: 0, y: 392, side: 504 }]);
    expect(tileOrigins(1280, 720)).toEqual([{ x: 0, y: 0, side: 720 }, { x: 560, y: 0, side: 720 }]);
  });

  it('keeps the strongest of overlapping boxes', () => {
    const kept = dedupe([
      { box: { x: 10, y: 10, width: 50, height: 50 }, score: 0.6 },
      { box: { x: 14, y: 12, width: 50, height: 50 }, score: 0.9 },
      { box: { x: 300, y: 300, width: 40, height: 40 }, score: 0.5 },
    ]);
    expect(kept.map(f => f.score)).toEqual([0.9, 0.5]);
  });
});

describe('web device credential', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); store.clear(); });
  const load = async () => (await import('../src/session')).getDeviceToken;

  it('survives a reload when there is a backend', async () => {
    vi.stubEnv('EXPO_PUBLIC_CONVEX_URL', 'https://x.convex.cloud');
    vi.stubGlobal('localStorage', storage);
    const first = await (await load())();
    vi.resetModules();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await load())()).toBe(first);
  });

  it('writes nothing to browser storage in the sample walkthrough', async () => {
    vi.stubEnv('EXPO_PUBLIC_CONVEX_URL', '');
    vi.stubGlobal('localStorage', storage);
    await (await load())();
    expect(store.size).toBe(0);
  });

  it('ignores a damaged stored value and still works when storage is blocked', async () => {
    vi.stubEnv('EXPO_PUBLIC_CONVEX_URL', 'https://x.convex.cloud');
    store.set('glance.device-token.v1', 'not-a-token');
    vi.stubGlobal('localStorage', storage);
    expect(await (await load())()).toMatch(/^[0-9a-f]{64}$/);
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(await (await load())()).toMatch(/^[0-9a-f]{64}$/);
  });
});

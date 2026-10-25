import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessHand, TwoHandGate, type HandPoint, type HandSample } from '../src/handGesture';
import { startHandTracking, type HandEngine } from '../src/capture/handEngine';

/** Explicit synthetic geometry, not claimed as camera/model or hardware evidence. */
function fixture(x = 0.3): HandSample {
  const triples = [
    [0, 0, 0], [-.025, .015, 0], [-.05, .03, 0], [-.075, .045, 0], [-.1, .06, 0],
    [-.03, .07, 0], [-.035, .11, 0], [-.038, .14, 0], [-.04, .165, 0],
    [0, .075, 0], [0, .125, 0], [0, .155, 0], [0, .18, 0],
    [.03, .067, 0], [.035, .10, 0], [.035, .081, -.025], [.03, .06, -.018],
    [.055, .05, 0], [.06, .075, 0], [.06, .06, -.020], [.053, .045, -.015],
  ];
  const worldLandmarks = triples.map(([x, y, z]) => ({ x, y, z }));
  return { worldLandmarks, landmarks: worldLandmarks.map(p => ({ x: x + p.x * 1.5, y: .7 - p.y * 1.5, z: p.z * 1.5 })) };
}
function edit(sample: HandSample, index: number, point: HandPoint) {
  sample.worldLandmarks![index] = point;
  return sample;
}
const pair = () => [assessHand(fixture()), assessHand(fixture(.72))];
function hold(gate: TwoHandGate, start = 0) {
  return [0, 130, 260, 390, 520, 650].map(offset => gate.observe(pair(), start + offset));
}

describe('anonymous thumb/index/middle geometry', () => {
  it('accepts only the requested extended/folded pattern', () => {
    expect(assessHand(fixture())).toMatchObject({ valid: true, complete: true, fingers: [true, true, true, false, false] });
  });
  it('rejects the old index/middle/ring pose and a tucked thumb', () => {
    const old = fixture();
    edit(old, 3, { x: -.02, y: .05, z: 0 }); edit(old, 4, { x: .005, y: .055, z: 0 });
    edit(old, 15, { x: .04, y: .13, z: 0 }); edit(old, 16, { x: .045, y: .155, z: 0 });
    expect(assessHand(old).valid).toBe(false);
    const tucked = fixture();
    edit(tucked, 3, { x: .015, y: .05, z: 0 }); edit(tucked, 4, { x: .06, y: .06, z: 0 });
    expect(assessHand(tucked).valid).toBe(false);
  });
  it('rejects straight fingers pointed down instead of curled, open palms and bent index', () => {
    const down = fixture();
    for (const [index, y] of [[14, .04], [15, .01], [16, -.02]]) edit(down, index, { x: .03, y, z: 0 });
    expect(assessHand(down).valid).toBe(false);
    const open = fixture();
    edit(open, 15, { x: .04, y: .13, z: 0 }); edit(open, 16, { x: .045, y: .155, z: 0 });
    expect(assessHand(open).valid).toBe(false);
    const bent = fixture(); edit(bent, 8, { x: -.03, y: .09, z: -.02 });
    expect(assessHand(bent).valid).toBe(false);
  });
  it('is invariant to 3D rotation, mirrored hands, translation and scale', () => {
    for (const mirror of [-1, 1]) for (const radians of [0, .5, 1.4, Math.PI, 4.5]) {
      const hand = fixture();
      hand.worldLandmarks = hand.worldLandmarks!.map(p => ({
        x: 3 + mirror * (p.x * Math.cos(radians) - p.y * Math.sin(radians)) * 2,
        y: 4 + ((p.x * Math.sin(radians) + p.y * Math.cos(radians)) * Math.cos(.8) - p.z * Math.sin(.8)) * 2,
        z: 2 + ((p.x * Math.sin(radians) + p.y * Math.cos(radians)) * Math.sin(.8) + p.z * Math.cos(.8)) * 2,
      }));
      hand.landmarks = hand.landmarks.map(p => {
        const x = p.x - .3, y = p.y - .5;
        return { x: .5 + mirror * (x * Math.cos(radians) - y * Math.sin(radians)),
          y: .5 + x * Math.sin(radians) + y * Math.cos(radians), z: p.z };
      });
      expect(assessHand(hand).valid).toBe(true);
    }
  });
  it('tolerates small landmark noise without turning threshold uncertainty into acceptance', () => {
    for (let seed = 0; seed < 20; seed++) {
      const hand = fixture();
      hand.worldLandmarks = hand.worldLandmarks!.map((p, i) => ({
        x: p.x + Math.sin(i * 7 + seed) * .0004, y: p.y + Math.cos(i * 3 + seed) * .0004, z: p.z,
      }));
      expect(assessHand(hand).valid).toBe(true);
    }
  });
  it('rejects truncated, missing, tiny, NaN and degenerate landmarks', () => {
    const cropped = fixture(); cropped.landmarks[4].x = .002;
    expect(assessHand(cropped).valid).toBe(false);
    const missing = fixture(); missing.landmarks.pop(); expect(assessHand(missing).valid).toBe(false);
    const tiny = fixture(); tiny.landmarks = tiny.landmarks.map(p => ({ ...p, x: p.x * .1 + .4, y: p.y * .1 + .4, z: p.z * .1 }));
    expect(assessHand(tiny).valid).toBe(false);
    const bad = fixture(); bad.worldLandmarks![8].z = NaN; expect(assessHand(bad).valid).toBe(false);
    const degenerate = fixture(); degenerate.worldLandmarks = Array(21).fill({ x: 0, y: 0, z: 0 });
    expect(assessHand(degenerate).valid).toBe(false);
  });
  it('corrects image aspect ratio when world landmarks are absent', () => {
    const hand = fixture();
    hand.landmarks = hand.worldLandmarks!.map(p => ({ x: .5 + p.x, y: .6 - p.y * 2, z: p.z }));
    delete hand.worldLandmarks;
    expect(assessHand(hand, 2).valid).toBe(true);
  });
});

describe('continuous exactly-two-hand gate', () => {
  it('requires six fresh observations across 650 ms then fires only once until reset', () => {
    const gate = new TwoHandGate(), results = hold(gate);
    expect(results.slice(0, -1).every(result => !result.stable)).toBe(true);
    expect(results.at(-1)).toEqual({ hands: 2, stable: true, progress: 1 });
    expect(hold(gate, 800).some(result => result.stable)).toBe(false);
    gate.reset(); expect(hold(gate, 1800).at(-1)?.stable).toBe(true);
  });
  it('rejects no hands, one hand, extra hands and overlapping/duplicate detections', () => {
    for (const hands of [[], pair().slice(0, 1), [...pair(), assessHand(fixture(.5))], [pair()[0], pair()[0]]]) {
      const gate = new TwoHandGate();
      expect([0, 150, 300, 450, 600, 750].some(time => gate.observe(hands, time).stable)).toBe(false);
    }
  });
  it('resets on invalid pose, long frame gap, backwards/repeated timestamp and moving to different hands', () => {
    for (const interruption of ['pose', 'gap', 'backwards', 'duplicate', 'jump']) {
      const gate = new TwoHandGate();
      [0, 130, 260, 390, 520].forEach(time => gate.observe(pair(), time));
      if (interruption === 'pose') gate.observe([{ ...pair()[0], valid: false }, pair()[1]], 600);
      if (interruption === 'gap') gate.observe(pair(), 1000);
      if (interruption === 'backwards') gate.observe(pair(), 100);
      if (interruption === 'duplicate') gate.observe(pair(), 520);
      if (interruption === 'jump') gate.observe(pair().map(h => ({ ...h, center: { ...h.center, y: .1 } })), 600);
      expect(gate.observe(pair(), 1100).stable).toBe(false);
    }
  });
  it('accepts detector result order swaps without assigning person identity', () => {
    const gate = new TwoHandGate();
    const results = [0, 130, 260, 390, 520, 650].map((time, i) => gate.observe(i % 2 ? pair().reverse() : pair(), time));
    expect(results.at(-1)?.stable).toBe(true);
  });
  it('does not let many frames in a brief burst or sparse frames satisfy the hold', () => {
    const gate = new TwoHandGate();
    for (let time = 0; time < 650; time += 10) expect(gate.observe(pair(), time).stable).toBe(false);
    const sparse = new TwoHandGate();
    for (const time of [0, 250, 500, 750]) expect(sparse.observe(pair(), time).stable).toBe(false);
  });
});

describe('hand engine lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('fences a late model after a layout-committed scope change before passive cleanup', async () => {
    let resolve!: (engine: HandEngine) => void;
    let scope = 'conversation:old';
    const engine: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const onReady = vi.fn(), onFrame = vi.fn(), onError = vi.fn();
    const stop = startHandTracking({ video: {} as HTMLVideoElement,
      create: () => new Promise(done => { resolve = done; }),
      isCurrent: () => scope === 'conversation:old', onReady, onFrame, onError });
    scope = 'conversation:new'; // New layout committed, old effect not cleaned yet.
    resolve(engine); await Promise.resolve();
    expect(engine.close).toHaveBeenCalledTimes(1); expect(engine.detect).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled(); expect(onFrame).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    stop(); expect(engine.close).toHaveBeenCalledTimes(1);
  });
  it('suppresses an inference result if scope changes before its callback can publish', async () => {
    let current = true;
    const engine: HandEngine = { detect: vi.fn(() => { current = false; return [fixture()]; }), close: vi.fn() };
    const onFrame = vi.fn(), onError = vi.fn();
    const stop = startHandTracking({ video: { readyState: 2, videoWidth: 640, currentTime: 1 } as HTMLVideoElement,
      create: async () => engine, isCurrent: () => current, onFrame, onError });
    await Promise.resolve();
    expect(engine.detect).toHaveBeenCalledTimes(1); expect(onFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled(); expect(engine.close).toHaveBeenCalledTimes(1);
    stop(); expect(engine.close).toHaveBeenCalledTimes(1);
  });
  it('suppresses a late model failure after a scope change without waiting for cleanup', async () => {
    let reject!: (error: unknown) => void;
    let current = true;
    const onError = vi.fn();
    const stop = startHandTracking({ video: {} as HTMLVideoElement,
      create: () => new Promise((_, fail) => { reject = fail; }), isCurrent: () => current, onFrame: vi.fn(), onError });
    current = false; reject(new Error('old model failure'));
    await Promise.resolve(); await Promise.resolve();
    expect(onError).not.toHaveBeenCalled(); stop();
  });
  it('closes a model that finishes loading after unmount without publishing stale work', async () => {
    let resolve!: (engine: HandEngine) => void;
    const create = () => new Promise<HandEngine>(done => { resolve = done; });
    const engine: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const onFrame = vi.fn(), onReady = vi.fn();
    const stop = startHandTracking({ video: {} as HTMLVideoElement, create, onFrame, onReady, onError: vi.fn() });
    stop(); resolve(engine); await Promise.resolve();
    expect(engine.close).toHaveBeenCalledTimes(1); expect(engine.detect).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled(); expect(onReady).not.toHaveBeenCalled();
  });
  it('ignores late loading failures after cancellation', async () => {
    let reject!: (error: unknown) => void;
    const onError = vi.fn();
    const stop = startHandTracking({ video: {} as HTMLVideoElement, create: () => new Promise((_, fail) => { reject = fail; }),
      onFrame: vi.fn(), onError });
    stop(); reject(new Error('late')); await Promise.resolve(); await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
  it('never counts a frozen video twice and cancels pending scheduled work', async () => {
    vi.useFakeTimers();
    const video = { readyState: 2, videoWidth: 640, currentTime: 1 } as HTMLVideoElement;
    const engine: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const onFrame = vi.fn();
    const stop = startHandTracking({ video, create: async () => engine, onFrame, onError: vi.fn() });
    await Promise.resolve(); vi.advanceTimersByTime(500);
    expect(engine.detect).toHaveBeenCalledTimes(1);
    video.currentTime = 2; vi.advanceTimersByTime(100);
    expect(engine.detect).toHaveBeenCalledTimes(2);
    stop(); video.currentTime = 3; vi.advanceTimersByTime(500);
    expect(onFrame).toHaveBeenCalledTimes(2); expect(engine.close).toHaveBeenCalledTimes(1);
  });
  it('closes a failed inference engine and does not retry uncontrolled', async () => {
    vi.useFakeTimers();
    const engine: HandEngine = { detect: vi.fn(() => { throw new Error('inference failed'); }), close: vi.fn() };
    const onError = vi.fn();
    const stop = startHandTracking({ video: { readyState: 2, videoWidth: 640, currentTime: 1 } as HTMLVideoElement,
      create: async () => engine, onFrame: vi.fn(), onError });
    await Promise.resolve(); vi.advanceTimersByTime(500); stop();
    expect(onError).toHaveBeenCalledTimes(1); expect(engine.close).toHaveBeenCalledTimes(1);
  });
  it('does not infer or signal from a stopped camera track', async () => {
    const engine: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const onFrame = vi.fn(), onError = vi.fn();
    const stop = startHandTracking({ video: { readyState: 2, videoWidth: 640, currentTime: 1 } as HTMLVideoElement,
      create: async () => engine, isLive: () => false, onFrame, onError });
    await Promise.resolve(); stop();
    expect(engine.detect).not.toHaveBeenCalled(); expect(onFrame).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1); expect(engine.close).toHaveBeenCalledTimes(1);
  });
});

import { OneHandGate as LiveOneHandGate } from '../src/handGesture';
describe('OneHandGate (live: this camera sees the other person)', () => {
  const hand = (x: number, valid = true) => ({ valid, complete: valid, fingers: [true, true, true, false, false] as [boolean, boolean, boolean, boolean, boolean], center: { x, y: 0.5, z: 0 }, scale: 0.2 });
  it('fires after a short hold of one valid hand and tolerates one misread frame', () => {
    const gate = new LiveOneHandGate();
    expect(gate.observe([hand(0.5)], 0).stable).toBe(false);
    expect(gate.observe([hand(0.5, false)], 200).stable).toBe(false);
    expect(gate.observe([hand(0.51)], 400).stable).toBe(false);
    expect(gate.observe([hand(0.52)], 520).stable).toBe(true);
    expect(gate.observe([hand(0.52)], 600).stable).toBe(false);
  });
  it('restarts after a long gap', () => {
    const gate = new LiveOneHandGate();
    gate.observe([hand(0.5)], 0); gate.observe([hand(0.5)], 200);
    expect(gate.observe([hand(0.5)], 1_200).progress).toBeLessThan(0.5);
  });
});

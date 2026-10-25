import { describe, expect, it } from 'vitest';
import { RecognitionCountdown, RECOGNITION_HOLD_MS, RECOGNITION_MAX_GAP_MS } from '../src/recognitionCountdown';

/** Synthetic opaque IDs only; these tests make no recognition/model claims. */
const self = 'synthetic-self', partner = 'synthetic-partner', other = 'synthetic-other';
const pair = [self, partner];
const idle = { partnerId: null, secondsRemaining: null, progress: 0, completed: false };
const hold = (gate: RecognitionCountdown, start = 0) =>
  [0, 1_000, 2_000, 3_000, 4_000, 5_000].map(offset => gate.observe(pair, self, start + offset));

describe('opaque-ID recognition countdown', () => {
  it('shows 5,4,3,2,1 and completes only on a fresh frame at 5000ms', () => {
    const gate = new RecognitionCountdown();
    const results = hold(gate);
    expect(RECOGNITION_HOLD_MS).toBe(5_000);
    expect(RECOGNITION_MAX_GAP_MS).toBe(1_200);
    expect(results.map(result => result.secondsRemaining)).toEqual([5, 4, 3, 2, 1, null]);
    expect(results.map(result => result.progress)).toEqual([0, .2, .4, .6, .8, 1]);
    expect(results.slice(0, -1).every(result => !result.completed)).toBe(true);
    expect(results.at(-1)).toEqual({ partnerId: partner, secondsRemaining: null, progress: 1, completed: true });
  });

  it('never finishes early, even with many frames or fractional timestamps', () => {
    const gate = new RecognitionCountdown();
    for (let now = 0; now < 5_000; now += 10) expect(gate.observe(pair, self, now).completed).toBe(false);
    expect(gate.observe(pair, self, 4_999.999)).toMatchObject({ secondsRemaining: 1, completed: false });
    expect(gate.observe(pair, self, 5_000).completed).toBe(true);
  });

  it('accepts detector order changes without changing the partner', () => {
    const gate = new RecognitionCountdown();
    const results = [0, 1_000, 2_000, 3_000, 4_000, 5_000]
      .map((now, i) => gate.observe(i % 2 ? [...pair].reverse() : pair, self, now));
    expect(results.at(-1)?.completed).toBe(true);
  });

  it.each([
    ['no faces', []],
    ['self only', [self]],
    ['partner only', [partner]],
    ['unmatched partner', [self, null]],
    ['missing descriptor', [self, undefined]],
    ['empty match', [self, '']],
    ['whitespace match', [self, '   ']],
    ['duplicate self', [self, self]],
    ['duplicate partner', [partner, partner]],
    ['self absent', [partner, other]],
    ['extra recognized face', [self, partner, other]],
    ['extra unrecognized face', [self, partner, null]],
  ] as const)('clears immediately for %s and requires a new full hold', (_, ids) => {
    const gate = new RecognitionCountdown();
    [0, 1_000, 2_000, 3_000, 4_000].forEach(now => gate.observe(pair, self, now));
    expect(gate.observe(ids, self, 4_500)).toEqual(idle);
    const restarted = hold(gate, 4_600);
    expect(restarted[0].secondsRemaining).toBe(5);
    expect(restarted.slice(0, -1).some(result => result.completed)).toBe(false);
    expect(restarted.at(-1)?.completed).toBe(true);
  });

  it.each([null, undefined, '', ' '])('requires valid current self %s', invalidSelf => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 0);
    expect(gate.observe(pair, invalidSelf, 1_000)).toEqual(idle);
  });

  it('restarts on partner changes, including a change at the completion deadline', () => {
    const gate = new RecognitionCountdown();
    [0, 1_000, 2_000, 3_000, 4_000].forEach(now => gate.observe(pair, self, now));
    expect(gate.observe([self, other], self, 5_000))
      .toEqual({ partnerId: other, secondsRemaining: 5, progress: 0, completed: false });
    expect(gate.observe(pair, self, 5_100)).toMatchObject({ partnerId: partner, secondsRemaining: 5, completed: false });
  });

  it('restarts when self changes even if the same two IDs remain', () => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 0);
    gate.observe(pair, self, 1_000);
    expect(gate.observe(pair, partner, 2_000))
      .toEqual({ partnerId: self, secondsRemaining: 5, progress: 0, completed: false });
  });

  it('allows the exact maximum gap but restarts across larger gaps without a watchdog', () => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 0);
    expect(gate.observe(pair, self, 1_200).progress).toBe(.24);
    expect(gate.observe(pair, self, 2_400.001)).toMatchObject({ secondsRemaining: 5, progress: 0, completed: false });
    const sparse = new RecognitionCountdown();
    expect(sparse.observe(pair, self, 0).completed).toBe(false);
    expect(sparse.observe(pair, self, 5_000)).toMatchObject({ secondsRemaining: 5, completed: false });
  });

  it('watchdog clears no-frame progress and never completes on its own', () => {
    const gate = new RecognitionCountdown();
    [0, 1_000, 2_000, 3_000, 4_000].forEach(now => gate.observe(pair, self, now));
    expect(gate.view(5_000)).toMatchObject({ secondsRemaining: 1, progress: 1, completed: false });
    expect(gate.view(5_200)).toMatchObject({ secondsRemaining: 1, completed: false });
    expect(gate.view(5_200.001)).toEqual(idle);
    expect(gate.view(10_000)).toEqual(idle);
    expect(gate.observe(pair, self, 10_001)).toMatchObject({ secondsRemaining: 5, completed: false });
  });

  it('view can animate 5,4,3,2,1 but does not consume a completion-frame timestamp', () => {
    const gate = new RecognitionCountdown();
    const seconds = [0, 1_000, 2_000, 3_000, 4_000].map(now => {
      gate.observe(pair, self, now);
      return gate.view(now).secondsRemaining;
    });
    expect(seconds).toEqual([5, 4, 3, 2, 1]);
    expect(gate.view(5_000).completed).toBe(false);
    expect(gate.observe(pair, self, 5_000).completed).toBe(true);
  });

  it('starts at delivery, not the earlier sample, and rejects pre-deadline completion frames', () => {
    const gate = new RecognitionCountdown();
    expect(gate.observe(pair, self, 100, 0)).toMatchObject({ secondsRemaining: 5, progress: 0 });
    [1_100, 2_100, 3_100, 4_100].forEach(now => gate.observe(pair, self, now, now - 100));
    expect(gate.observe(pair, self, 5_100, 5_000)).toMatchObject({ secondsRemaining: 1, completed: false });
    expect(gate.view(5_150).completed).toBe(false);
    expect(gate.observe(pair, self, 5_200, 5_100).completed).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid delivery clock %s without preserving progress', now => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 0);
    gate.observe(pair, self, 1_000);
    expect(gate.observe(pair, self, now)).toEqual(idle);
    expect(gate.observe(pair, self, 1_100)).toMatchObject({ secondsRemaining: 5, completed: false });
  });

  it.each([NaN, Infinity, -Infinity, -1, 2_001, 799])('rejects nonfinite, future or stale sample %s', sampledAt => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 1_000);
    expect(gate.observe(pair, self, 2_000, sampledAt)).toEqual(idle);
    expect(gate.observe(pair, self, 2_100)).toMatchObject({ secondsRemaining: 5, completed: false });
  });

  it('rejects repeated/backwards sample timestamps rather than refreshing or completing', () => {
    for (const sample of [4_000, 3_999]) {
      const gate = new RecognitionCountdown();
      [0, 1_000, 2_000, 3_000, 4_000].forEach(now => gate.observe(pair, self, now));
      expect(gate.observe(pair, self, 5_000, sample)).toEqual(idle);
      expect(gate.view(5_100)).toEqual(idle);
      expect(gate.observe(pair, self, 5_200, 5_100)).toMatchObject({ secondsRemaining: 5, completed: false });
    }
  });

  it('rejects repeated/backwards delivery timestamps and view clock regressions', () => {
    for (const time of [1_000, 999]) {
      const gate = new RecognitionCountdown();
      gate.observe(pair, self, 0);
      gate.observe(pair, self, 1_000);
      expect(gate.observe(pair, self, time)).toEqual(idle);
      expect(gate.observe(pair, self, 1_100)).toMatchObject({ secondsRemaining: 5, completed: false });
    }
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 1_000);
    gate.view(1_100);
    expect(gate.observe(pair, self, 1_050)).toEqual(idle);
    gate.observe(pair, self, 1_200);
    expect(gate.view(1_199)).toEqual(idle);
    gate.observe(pair, self, 1_300);
    expect(gate.view(NaN)).toEqual(idle);
  });

  it('bounds source-frame gaps even with prompt deliveries', () => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 1_000, 0);
    gate.observe(pair, self, 1_100, 100);
    expect(gate.observe(pair, self, 1_301, 1_301)).toMatchObject({ secondsRemaining: 5, progress: 0 });
  });

  it('watchdog expires delivery silence without charging accepted inference latency twice', () => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 1_000, 0);
    expect(gate.view(1_200)).toMatchObject({ secondsRemaining: 5 });
    expect(gate.view(1_200.001)).toMatchObject({ secondsRemaining: 5 });
    expect(gate.view(2_200)).toMatchObject({ secondsRemaining: 4 });
    expect(gate.view(2_200.001)).toEqual(idle);
    expect(gate.observe(pair, self, 2_300, 2_300)).toMatchObject({ secondsRemaining: 5, progress: 0 });
  });

  it.each([[600, 720], [1_000, 1_120]])(
    'shows the full countdown with %ims inference and %ims frame intervals',
    (latency, interval) => {
      const gate = new RecognitionCountdown();
      const firstDelivery = latency;
      const deadline = firstDelivery + RECOGNITION_HOLD_MS;
      const events: { now: number; sampledAt?: number }[] = [];
      for (let frame = 0; frame <= 10; frame++) {
        const sampledAt = frame * interval;
        events.push({ now: sampledAt + latency, sampledAt });
      }
      for (let now = firstDelivery; now <= latency + 10 * interval; now += 100) events.push({ now });
      events.sort((a, b) => a.now - b.now || Number(b.sampledAt !== undefined) - Number(a.sampledAt !== undefined));
      const shown: number[] = [];
      const completions: { now: number; sampledAt: number }[] = [];
      for (const event of events) {
        const result = event.sampledAt === undefined ? gate.view(event.now)
          : gate.observe(pair, self, event.now, event.sampledAt);
        expect(result.partnerId).toBe(partner);
        if (result.secondsRemaining !== null && shown.at(-1) !== result.secondsRemaining) shown.push(result.secondsRemaining);
        if (event.sampledAt === undefined) expect(result.completed).toBe(false);
        if (event.sampledAt !== undefined && event.sampledAt < deadline) expect(result.completed).toBe(false);
        if (result.completed) completions.push({ now: event.now, sampledAt: event.sampledAt! });
      }
      expect(shown).toEqual([5, 4, 3, 2, 1]);
      expect(completions).toHaveLength(1);
      expect(completions[0].now).toBeGreaterThanOrEqual(deadline);
      expect(completions[0].sampledAt).toBeGreaterThanOrEqual(deadline);
      expect(completions[0].sampledAt).toBe(Math.ceil(deadline / interval) * interval);
    },
  );

  it('emits once and keeps the latch across invalid frames, watchdog expiry and clock errors', () => {
    const gate = new RecognitionCountdown();
    expect(hold(gate).at(-1)?.completed).toBe(true);
    expect(gate.observe([], self, 5_100).completed).toBe(false);
    expect(gate.observe([self, other], self, 5_200).completed).toBe(false);
    expect(gate.observe(pair, self, NaN).completed).toBe(false);
    expect(gate.view(20_000).completed).toBe(false);
    expect(hold(gate, 21_000).some(result => result.completed)).toBe(false);
    gate.reset();
    expect(gate.view(0)).toEqual(idle);
    expect(hold(gate).at(-1)?.completed).toBe(true);
  });

  it('explicit scope reset clears partial evidence and timestamp watermarks', () => {
    const gate = new RecognitionCountdown();
    gate.observe(pair, self, 100_000);
    gate.observe(pair, self, 101_000);
    gate.reset();
    expect(gate.view(0)).toEqual(idle);
    expect(hold(gate).map(result => result.completed)).toEqual([false, false, false, false, false, true]);
  });
});

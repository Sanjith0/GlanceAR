import { describe, expect, it } from 'vitest';
import { TapCounter } from '../src/secretTaps';

describe('hidden tap shortcut', () => {
  it('fires on the sixth quick tap and not before', () => {
    const taps = new TapCounter();
    expect([0, 200, 400, 600, 800].map(t => taps.tap(t))).toEqual([false, false, false, false, false]);
    expect(taps.tap(1_000)).toBe(true);
  });

  it('starts over after a pause', () => {
    const taps = new TapCounter(6, 700);
    for (const t of [0, 200, 400, 600, 800]) taps.tap(t);
    expect(taps.tap(1_600)).toBe(false); // 800 ms since the last tap: counts as the first of a new run
    expect([1_800, 2_000, 2_200, 2_400].map(t => taps.tap(t))).toEqual([false, false, false, false]);
    expect(taps.tap(2_600)).toBe(true);
  });

  it('needs a fresh run each time', () => {
    const taps = new TapCounter(3, 700);
    expect([0, 100, 200].map(t => taps.tap(t))).toEqual([false, false, true]);
    expect([300, 400].map(t => taps.tap(t))).toEqual([false, false]);
    expect(taps.tap(500)).toBe(true);
  });
});

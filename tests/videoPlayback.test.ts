import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_ATTEMPTS, PLAYBACK_RETRY_MS, PlaybackBlocked, startVideo } from '../src/capture/videoPlayback';

const refused = () => Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
/** A video that refuses `play()` a number of times before accepting. */
function video(refusals: number, options: { autoplayed?: boolean } = {}) {
  const element = { calls: 0, paused: !options.autoplayed, play: async () => {
    element.calls++;
    if (element.calls <= refusals) throw refused();
    element.paused = false;
  } };
  return element;
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('starting a camera video', () => {
  it('plays straight away when the browser allows it', async () => {
    const element = video(0);
    await expect(startVideo(element, () => true)).resolves.toBe(true);
    expect(element.calls).toBe(1);
  });

  it('keeps trying through a refusal that clears a moment later', async () => {
    const element = video(3);
    const started = startVideo(element, () => true);
    await vi.advanceTimersByTimeAsync(PLAYBACK_RETRY_MS * 3);
    await expect(started).resolves.toBe(true);
    expect(element.calls).toBe(4);
  });

  it('accepts a video the autoplay attribute already started', async () => {
    const element = video(99, { autoplayed: true });
    await expect(startVideo(element, () => true)).resolves.toBe(true);
    expect(element.calls).toBe(1);
  });

  it('reports a block, not a permission problem, when every attempt is refused', async () => {
    const element = video(Infinity);
    const started = startVideo(element, () => true).catch(error => error);
    await vi.advanceTimersByTimeAsync(PLAYBACK_RETRY_MS * PLAYBACK_ATTEMPTS);
    const error = await started;
    expect(error).toBeInstanceOf(PlaybackBlocked);
    expect((error as Error).name).not.toBe('NotAllowedError');
    expect(element.calls).toBe(PLAYBACK_ATTEMPTS);
  });

  it('stops quietly when the screen moved on', async () => {
    let current = true;
    const element = video(Infinity);
    const started = startVideo(element, () => current);
    await vi.advanceTimersByTimeAsync(PLAYBACK_RETRY_MS);
    current = false;
    await vi.advanceTimersByTimeAsync(PLAYBACK_RETRY_MS * 2);
    await expect(started).resolves.toBe(false);
    expect(element.calls).toBeLessThan(5);
  });
});

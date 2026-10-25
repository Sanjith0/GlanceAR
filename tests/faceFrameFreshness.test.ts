import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFreshFaceFrames } from '../src/capture/faceFrameFreshness';

function setup() {
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0 } as HTMLVideoElement;
  const flags = { current: true, live: true, visible: true };
  const callbacks = { onFrame: vi.fn(), onReset: vi.fn(), onStopped: vi.fn(), onError: vi.fn() };
  const options = {
    video, ...callbacks,
    isCurrent: () => flags.current, isLive: () => flags.live, isVisible: () => flags.visible,
  };
  return { video, flags, callbacks, options };
}
function deferred<Value>() {
  let resolve!: (value: Value) => void, reject!: (error: unknown) => void;
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('face capture freshness without changing detection or matching', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('timestamps immediately before inference, not at delayed delivery, and preserves input dimensions', async () => {
    const { video, options, callbacks } = setup();
    const pending = deferred<string[]>();
    const now = vi.spyOn(performance, 'now').mockReturnValue(25);
    const detectFaces = vi.fn(() => { expect(now).toHaveBeenCalledTimes(1); return pending.promise; });
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    now.mockReturnValue(9000);
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    pending.resolve(['unaltered detector result']);
    await Promise.resolve();
    expect(callbacks.onFrame).toHaveBeenCalledExactlyOnceWith({
      faces: ['unaltered detector result'], sampledAt: 25, width: 640, height: 480,
    });
    expect(now).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never re-infers a frozen, backwards, negative or non-finite video timestamp', async () => {
    const { video, options, callbacks } = setup();
    const detectFaces = vi.fn(async () => ['face']);
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    await Promise.resolve();
    for (const time of [0, -1, NaN, Infinity, 0]) {
      video.currentTime = time;
      await vi.advanceTimersByTimeAsync(120);
    }
    expect(detectFaces).toHaveBeenCalledTimes(1);
    expect(callbacks.onFrame).toHaveBeenCalledTimes(1);
    expect(callbacks.onReset).not.toHaveBeenCalled();
    video.currentTime = 1;
    await vi.advanceTimersByTimeAsync(120);
    expect(detectFaces).toHaveBeenCalledTimes(2);
    stop();
  });

  it('requires advancement beyond the last accepted video time, not just a different value', async () => {
    const { video, options } = setup();
    video.currentTime = 5;
    const detectFaces = vi.fn(async () => []);
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    await Promise.resolve();
    for (const time of [4, 4.5, 5]) {
      video.currentTime = time; await vi.advanceTimersByTimeAsync(120);
    }
    expect(detectFaces).toHaveBeenCalledTimes(1);
    video.currentTime = 5.01; await vi.advanceTimersByTimeAsync(120);
    expect(detectFaces).toHaveBeenCalledTimes(2);
    stop();
  });

  it('drops old inference after a new layout scope commits, before passive cleanup', async () => {
    const { flags, options, callbacks } = setup();
    const pending = deferred<string[]>();
    const stop = startFreshFaceFrames({ ...options, detectFaces: () => pending.promise });
    flags.current = false;
    pending.resolve(['old scope face']); await Promise.resolve();
    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it.each(['live', 'visible'] as const)('rechecks %s after awaited inference and resets instead of publishing', async property => {
    const { flags, options, callbacks } = setup();
    const pending = deferred<string[]>();
    const stop = startFreshFaceFrames({ ...options, detectFaces: () => pending.promise });
    flags[property] = false;
    pending.resolve(['late face']); await Promise.resolve();
    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('does not begin inference when the track has ended', () => {
    const { flags, options, callbacks } = setup();
    flags.live = false;
    const detectFaces = vi.fn(async () => []);
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    expect(detectFaces).not.toHaveBeenCalled();
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1);
    stop();
  });

  it('drops a late failure from an old identity rather than calling the new error handler', async () => {
    const { flags, options, callbacks } = setup();
    const pending = deferred<string[]>();
    const stop = startFreshFaceFrames({ ...options, detectFaces: () => pending.promise });
    flags.current = false;
    pending.reject(new Error('old inference failure')); await Promise.resolve();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    stop();
  });

  it('resets on a current inference failure and does not schedule uncontrolled retries', async () => {
    const { options, callbacks } = setup();
    const error = new Error('inference failure');
    const stop = startFreshFaceFrames({ ...options, detectFaces: async () => { throw error; } });
    await Promise.resolve();
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('cleanup cancels scheduled work and suppresses a pending inference result', async () => {
    const { options, callbacks } = setup();
    const pending = deferred<string[]>();
    const detectFaces = vi.fn(() => pending.promise);
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    stop();
    pending.resolve(['face']); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks.onFrame).not.toHaveBeenCalled();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    expect(detectFaces).toHaveBeenCalledTimes(1);
  });

  it('keeps inference serial and waits for decodable frame dimensions', async () => {
    const { video, options, callbacks } = setup();
    Object.defineProperty(video, 'readyState', { value: 1, writable: true });
    const pending = deferred<string[]>();
    const detectFaces = vi.fn(() => pending.promise);
    const stop = startFreshFaceFrames({ ...options, detectFaces });
    expect(detectFaces).not.toHaveBeenCalled();
    expect(callbacks.onReset).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { value: 2 });
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(2000);
    expect(detectFaces).toHaveBeenCalledTimes(1);
    expect(callbacks.onFrame).not.toHaveBeenCalled();
    pending.resolve([]); await Promise.resolve();
    expect(callbacks.onFrame).toHaveBeenCalledTimes(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

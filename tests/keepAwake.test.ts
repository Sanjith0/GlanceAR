import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from '../src/capture/wakeLock';
import { startHandTracking, type HandEngine } from '../src/capture/handEngine';

/** A stand-in page with the Screen Wake Lock API. */
function page(options: { refuse?: boolean; api?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const state = { visibility: 'visible', requests: 0, releases: 0, held: 0 };
  const doc = {
    get visibilityState() { return state.visibility; },
    addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener); },
  };
  const wakeLock = { request: async () => {
    state.requests++;
    if (options.refuse) throw new Error('NotAllowedError');
    state.held++;
    let onRelease = () => {};
    const sentinel = {
      release: async () => { state.releases++; state.held--; onRelease(); },
      addEventListener: (_: 'release', listener: () => void) => { onRelease = listener; },
      /** The browser drops the lock when the page is hidden. */
      drop: () => { state.held--; onRelease(); },
    };
    drops.push(sentinel.drop);
    return sentinel;
  } };
  const drops: (() => void)[] = [];
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', options.api === false ? {} : { wakeLock });
  const setVisibility = (value: string) => {
    state.visibility = value;
    if (value === 'hidden') drops.splice(0).forEach(drop => drop());
    listeners.forEach(listener => listener());
  };
  return { state, setVisibility, listeners };
}
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('keeping the screen on', () => {
  it('holds a wake lock until told to stop', async () => {
    const p = page();
    const stop = keepScreenAwake();
    await settle();
    expect(p.state).toMatchObject({ requests: 1, held: 1 });
    stop(); await settle();
    expect(p.state).toMatchObject({ held: 0, releases: 1 });
    expect(p.listeners.size).toBe(0);
  });

  it('takes the lock again when the page comes back, since the browser drops it when hidden', async () => {
    const p = page();
    const stop = keepScreenAwake();
    await settle();
    p.setVisibility('hidden'); await settle();
    expect(p.state.held).toBe(0);
    p.setVisibility('visible'); await settle();
    expect(p.state).toMatchObject({ requests: 2, held: 1 });
    stop();
  });

  it('never holds two locks at once', async () => {
    const p = page();
    const stop = keepScreenAwake();
    p.setVisibility('visible'); p.setVisibility('visible');
    await settle();
    expect(p.state).toMatchObject({ requests: 1, held: 1 });
    stop();
  });

  it('releases a lock that arrives after it was told to stop', async () => {
    const p = page();
    keepScreenAwake()();
    await settle();
    expect(p.state.held).toBe(0);
  });

  it('carries on quietly when the browser refuses or has no wake lock', async () => {
    const refused = page({ refuse: true });
    const stop = keepScreenAwake();
    await settle();
    expect(refused.state.held).toBe(0);
    stop();
    page({ api: false });
    expect(() => keepScreenAwake()()).not.toThrow();
  });
});

describe('hand detection recovering from a failure', () => {
  const video = (time = 1) => ({ readyState: 2, videoWidth: 640, currentTime: time }) as HTMLVideoElement;

  it('rebuilds the model after a failure and carries on', async () => {
    vi.useFakeTimers();
    const broken: HandEngine = { detect: vi.fn(() => { throw new Error('context lost'); }), close: vi.fn() };
    const healthy: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const create = vi.fn().mockResolvedValueOnce(broken).mockResolvedValue(healthy);
    const onError = vi.fn(), onFrame = vi.fn(), onRecovering = vi.fn();
    const stop = startHandTracking({ video: video(), create, onFrame, onError, recover: 3, onRecovering });
    await vi.advanceTimersByTimeAsync(0);
    expect(broken.close).toHaveBeenCalledTimes(1);
    expect(onRecovering).toHaveBeenCalledWith(1);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(create).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(1);
    stop();
  });

  it('gives up after the allowed rebuilds in a row, and only then reports the error', async () => {
    vi.useFakeTimers();
    const made: HandEngine[] = [];
    const create = vi.fn(async () => { const e: HandEngine = { detect: vi.fn(() => { throw new Error('still broken'); }), close: vi.fn() }; made.push(e); return e; });
    const onError = vi.fn(), onRecovering = vi.fn();
    const stop = startHandTracking({ video: video(), create, onFrame: vi.fn(), onError, recover: 2, onRecovering });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(create).toHaveBeenCalledTimes(3); // the first try and two rebuilds
    expect(onRecovering.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(made.every(e => (e.close as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(create).toHaveBeenCalledTimes(3); // nothing further once it has given up
    stop();
  });

  it('does not rebuild when the camera itself has stopped', async () => {
    vi.useFakeTimers();
    const engine: HandEngine = { detect: vi.fn(() => []), close: vi.fn() };
    const create = vi.fn(async () => engine);
    const onError = vi.fn(), onRecovering = vi.fn();
    const stop = startHandTracking({ video: video(), create, isLive: () => false, onFrame: vi.fn(), onError, recover: 3, onRecovering });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRecovering).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops rebuilding once the screen has moved on', async () => {
    vi.useFakeTimers();
    let current = true;
    const create = vi.fn(async (): Promise<HandEngine> => ({ detect: vi.fn(() => { throw new Error('broken'); }), close: vi.fn() }));
    const onError = vi.fn();
    const stop = startHandTracking({ video: video(), create, isCurrent: () => current, onFrame: vi.fn(), onError, recover: 3 });
    await vi.advanceTimersByTimeAsync(0);
    current = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(create.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onError).not.toHaveBeenCalled();
    stop();
  });
});

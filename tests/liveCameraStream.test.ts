import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveCameraPool } from '../src/capture/liveCameraStream';

function fixture() {
  let visible = true;
  const tracks: { readyState: string; stop: ReturnType<typeof vi.fn> }[] = [];
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => {
    const track = {
      readyState: 'live',
      stop: vi.fn(() => { track.readyState = 'ended'; }),
      getSettings: () => ({ facingMode: 'user' }),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    };
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  });
  const pool = new LiveCameraPool({ getUserMedia, visible: () => visible, now: () => Date.now() });
  return { pool, getUserMedia, tracks, hide: () => { visible = false; pool.stopAll(); } };
}
afterEach(() => { vi.useRealTimers(); });

describe('scoped video-only camera handoff', () => {
  it('reuses exactly the original stream and facing through an explicit conversation transfer', async () => {
    const f = fixture();
    const first = await f.pool.acquire('user', 'live:event');
    expect(f.pool.prepareHandoff('conversation:one')).toBe(true);
    first.release();
    expect(f.tracks[0].stop).not.toHaveBeenCalled();
    const next = await f.pool.acquire('environment', 'conversation:one');
    expect(next.stream).toBe(first.stream);
    expect(next.mirrored).toBe(true);
    expect(f.getUserMedia).toHaveBeenCalledTimes(1);
    expect(f.getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
    next.release();
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('allows overlapping source cleanup only for the explicitly named destination', async () => {
    const f = fixture(), first = await f.pool.acquire('environment', 'live:event');
    f.pool.prepareHandoff('conversation:one');
    await expect(f.pool.acquire('environment', 'conversation:other')).rejects.toThrow('already in use');
    const next = await f.pool.acquire('environment', 'conversation:one');
    first.release();
    expect(f.tracks[0].stop).not.toHaveBeenCalled();
    next.release();
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('stops immediately on ordinary release and makes repeated release harmless', async () => {
    const f = fixture(), lease = await f.pool.acquire();
    lease.release(); lease.release();
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('closes an unclaimed handoff before another route requests a different camera', async () => {
    const f = fixture(), first = await f.pool.acquire('user', 'live:event');
    f.pool.prepareHandoff('conversation:one');
    first.release();
    const unrelated = await f.pool.acquire('environment', 'different:route');
    expect(unrelated.stream).not.toBe(first.stream);
    expect(f.tracks[0].stop).toHaveBeenCalledOnce();
    expect(f.getUserMedia).toHaveBeenCalledTimes(2);
    unrelated.release();
  });

  it.each(['abort', 'hide'] as const)('does not request permission after same-tick %s', async reason => {
    const f = fixture(), cancellation = new AbortController();
    const pending = f.pool.acquire('environment', 'cancelled', cancellation.signal);
    if (reason === 'abort') cancellation.abort(); else f.hide();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });

  it('expires an unclaimed handoff without allowing renders to refresh it', async () => {
    vi.useFakeTimers();
    const f = fixture(), lease = await f.pool.acquire('environment', 'live:event');
    f.pool.prepareHandoff('conversation:one');
    lease.release();
    vi.advanceTimersByTime(900);
    expect(f.pool.prepareHandoff('conversation:one')).toBe(false);
    vi.advanceTimersByTime(600);
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('cancels an abandoned destination and never stops a later owner', async () => {
    const f = fixture(), first = await f.pool.acquire('environment', 'live:event');
    f.pool.prepareHandoff('conversation:one');
    first.release();
    f.pool.cancelHandoff('conversation:one');
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
    const later = await f.pool.acquire('environment', 'conversation:two');
    f.pool.cancelHandoff('conversation:one');
    first.release();
    expect(f.tracks[1].stop).not.toHaveBeenCalled();
    later.release();
  });

  it('closes the stream synchronously when the tab is hidden, even during transfer', async () => {
    const f = fixture(), first = await f.pool.acquire();
    f.pool.prepareHandoff('conversation:one');
    f.hide();
    expect(f.tracks[0].stop).toHaveBeenCalledTimes(1);
    await expect(f.pool.acquire('environment', 'conversation:one')).rejects.toMatchObject({ name: 'AbortError' });
    first.release();
  });

  it('stops late permission results after cancellation without stealing a newer scope', async () => {
    const f = fixture();
    let resolve!: (stream: MediaStream) => void;
    f.getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>(done => { resolve = done; }));
    const cancellation = new AbortController();
    const pending = f.pool.acquire('environment', 'old', cancellation.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    cancellation.abort();
    const newer = await f.pool.acquire('environment', 'new');
    const stop = vi.fn();
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
    expect(f.tracks[0].stop).not.toHaveBeenCalled();
    newer.release();
  });

  it('does not request a camera for an already cancelled scope', async () => {
    const f = fixture(), cancellation = new AbortController();
    cancellation.abort();
    await expect(f.pool.acquire('environment', 'old', cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });
});

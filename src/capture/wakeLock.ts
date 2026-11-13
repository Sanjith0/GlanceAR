import { useEffect } from 'react';

/**
 * Keeps the screen on while a camera or a conversation is in use.
 *
 * A conversation needs both phones checking in every second, and nobody touches a
 * phone while they talk, so without this the screen locks, the page stops, and the
 * conversation ends by itself. Uses the Screen Wake Lock API where the browser has it
 * and does nothing otherwise (the Glance Live iPhone app keeps its own screen on).
 * The browser drops the lock whenever the page is hidden, so it is taken again each
 * time the page comes back.
 */
type Sentinel = { release(): Promise<void>; addEventListener?(type: 'release', listener: () => void): void };
type WakeLockNavigator = { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

export function keepScreenAwake(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return () => {};
  const api = (navigator as unknown as WakeLockNavigator).wakeLock;
  if (!api) return () => {};
  let stopped = false, held: Sentinel | null = null, asking = false;
  const take = () => {
    if (stopped || held || asking || document.visibilityState !== 'visible') return;
    asking = true;
    api.request('screen').then(sentinel => {
      asking = false;
      if (stopped) { void sentinel.release().catch(() => {}); return; }
      held = sentinel;
      sentinel.addEventListener?.('release', () => { if (held === sentinel) held = null; });
    }, () => { asking = false; }); // refused (low battery, no permission): carry on without it
  };
  const onVisible = () => { if (document.visibilityState === 'visible') take(); };
  document.addEventListener('visibilitychange', onVisible);
  take();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    const sentinel = held; held = null;
    if (sentinel) void sentinel.release().catch(() => {});
  };
}

/** Keeps the screen on while `active` is true. */
export function useKeepAwake(active: boolean): void {
  useEffect(() => (active ? keepScreenAwake() : undefined), [active]);
}

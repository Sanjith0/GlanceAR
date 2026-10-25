/** One video-only camera owner, with an explicit, short route-transfer window. */
export type CameraFacing = 'environment' | 'user';
export type LiveCameraLease = {
  stream: MediaStream;
  mirrored: boolean;
  release: () => void;
};

const HANDOFF_MS = 1_500;
type Entry = {
  facing: CameraFacing;
  owners: Map<symbol, string>;
  stream: MediaStream | null;
  pending: Promise<MediaStream>;
  handoff: { scope: string; until: number; timer: ReturnType<typeof setTimeout> } | null;
  ended: (() => void) | null;
};
type CameraDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  visible: () => boolean;
  now: () => number;
};

const aborted = () => Object.assign(new Error('Camera request was cancelled.'), { name: 'AbortError' });

/**
 * A handoff is not a generic keep-alive. Ordinary release closes tracks
 * immediately, and a pending permission result cannot revive a released scope.
 */
export class LiveCameraPool {
  private entry: Entry | null = null;

  constructor(private readonly dependencies: CameraDependencies) {}

  async acquire(
    facing: CameraFacing = 'environment',
    scope = 'camera',
    signal?: AbortSignal,
  ): Promise<LiveCameraLease> {
    if (signal?.aborted || !this.dependencies.visible()) throw aborted();
    let entry = this.entry;
    if (entry?.handoff && entry.handoff.until <= this.dependencies.now()) {
      this.clearHandoff(entry);
      if (!entry.owners.size) this.close(entry);
      entry = this.entry;
    }
    if (entry?.stream && !entry.stream.getVideoTracks().some(track => track.readyState === 'live')) {
      this.close(entry);
      entry = null;
    }
    const transfer = entry?.handoff?.scope === scope;
    if (entry?.handoff && !transfer && !entry.owners.size) {
      // A different destination must not inherit a previous route's camera.
      this.close(entry);
      entry = null;
    }
    if (entry) {
      const sameScope = [...entry.owners.values()].every(owner => owner === scope);
      if (!transfer && (!sameScope || entry.facing !== facing)) {
        throw new Error('The camera is already in use by another Glance screen.');
      }
    }
    if (!entry) {
      const next: Entry = {
        facing, owners: new Map(), stream: null,
        pending: Promise.resolve(null as unknown as MediaStream),
        handoff: null, ended: null,
      };
      this.entry = next;
      // Defer invocation so even a synchronous permission failure enters the
      // same cancellation path as a rejected browser permission promise.
      next.pending = Promise.resolve().then(() => {
        if (this.entry !== next || !next.owners.size || !this.dependencies.visible()) throw aborted();
        return this.dependencies.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }).then(stream => {
        if (this.entry !== next || !next.owners.size || !this.dependencies.visible()) {
          stream.getTracks().forEach(track => track.stop());
          throw aborted();
        }
        next.stream = stream;
        next.ended = () => { if (this.entry === next) this.close(next); };
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', next.ended!));
        return stream;
      });
      entry = next;
    }
    const ownedEntry = entry;
    const owner = Symbol(scope);
    ownedEntry.owners.set(owner, scope);
    if (transfer) this.clearHandoff(ownedEntry);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', release);
      ownedEntry.owners.delete(owner);
      if (this.entry !== ownedEntry) return;
      if (!ownedEntry.owners.size && !ownedEntry.handoff) this.close(ownedEntry);
    };
    signal?.addEventListener('abort', release, { once: true });
    try {
      const stream = await ownedEntry.pending;
      if (released || signal?.aborted || this.entry !== ownedEntry || !this.dependencies.visible()) throw aborted();
      return {
        stream,
        mirrored: stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment',
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  prepareHandoff(scope: string): boolean {
    const entry = this.entry;
    if (!entry?.stream || !entry.owners.size || !this.dependencies.visible()
      || !entry.stream.getVideoTracks().some(track => track.readyState === 'live')) return false;
    if (entry.handoff) {
      // Repeated renders cannot slide the original handoff's expiry.
      return entry.handoff.scope === scope && entry.handoff.until > this.dependencies.now();
    }
    const until = this.dependencies.now() + HANDOFF_MS;
    const timer = setTimeout(() => {
      if (this.entry !== entry || entry.handoff?.until !== until) return;
      this.clearHandoff(entry);
      if (!entry.owners.size) this.close(entry);
    }, HANDOFF_MS);
    entry.handoff = { scope, until, timer };
    return true;
  }

  cancelHandoff(scope: string): void {
    const entry = this.entry;
    if (!entry || entry.handoff?.scope !== scope) return;
    this.clearHandoff(entry);
    if (!entry.owners.size) this.close(entry);
  }

  stopAll(): void {
    if (this.entry) this.close(this.entry);
  }

  private clearHandoff(entry: Entry): void {
    if (entry.handoff) clearTimeout(entry.handoff.timer);
    entry.handoff = null;
  }

  private close(entry: Entry): void {
    if (this.entry === entry) this.entry = null;
    this.clearHandoff(entry);
    if (entry.ended) {
      entry.stream?.getVideoTracks().forEach(track => track.removeEventListener('ended', entry.ended!));
    }
    entry.owners.clear();
    entry.stream?.getTracks().forEach(track => track.stop());
    entry.stream = null;
  }
}

const pool = new LiveCameraPool({
  getUserMedia: constraints => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error('Camera access requires a supported browser over HTTPS or localhost.'));
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  },
  visible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
  now: () => performance.now(),
});
let listening = false;
function installLifecycleGuards() {
  if (listening || typeof document === 'undefined' || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') pool.stopAll();
  });
  window.addEventListener('pagehide', () => pool.stopAll());
}

export function acquireLiveCameraStream(facing?: CameraFacing, scope?: string, signal?: AbortSignal) {
  installLifecycleGuards();
  return pool.acquire(facing, scope, signal);
}
export function prepareLiveCameraHandoff(scope: string): boolean { return pool.prepareHandoff(scope); }
export function cancelLiveCameraHandoff(scope: string): void { pool.cancelHandoff(scope); }

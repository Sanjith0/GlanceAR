/** Timing and opaque matched IDs only; no face data, matching or side effects. */
export const RECOGNITION_HOLD_MS = 5_000;
export const RECOGNITION_MAX_GAP_MS = 1_200;

export type RecognitionCountdownView = {
  partnerId: string | null;
  secondsRemaining: 5 | 4 | 3 | 2 | 1 | null;
  progress: number;
  /** A one-shot event returned by observe only, never by view. */
  completed: boolean;
};
type MatchedId = string | null | undefined;
const validId = (id: MatchedId): id is string => typeof id === 'string' && id.trim().length > 0;

/**
 * Require the same exactly-two matched participants, including self, for 5 seconds.
 * Pass every detection, retaining null for unmatched faces; never filter the array.
 * All timestamps use one monotonic clock. The adapter must also suppress repeated
 * video frames; timestamps alone cannot prove that the underlying image is new.
 * Reset on camera, scope, registry, enrollment, focus or visibility changes.
 */
export class RecognitionCountdown {
  private startedAt: number | null = null;
  private lastObservationAt: number | null = null;
  private lastSampleAt: number | null = null;
  private lastClockAt: number | null = null;
  private selfId: string | null = null;
  private partnerId: string | null = null;
  private fired = false;

  reset(): void {
    this.clearHold();
    this.lastObservationAt = null;
    this.lastSampleAt = null;
    this.lastClockAt = null;
    this.fired = false;
  }

  private clearHold(): void {
    this.startedAt = null;
    this.selfId = null;
    this.partnerId = null;
  }

  private acceptClock(now: number): boolean {
    if (!Number.isFinite(now) || now < 0 || (this.lastClockAt !== null && now < this.lastClockAt)) {
      this.clearHold();
      return false;
    }
    this.lastClockAt = now;
    return true;
  }

  private snapshot(now: number, completed = false): RecognitionCountdownView {
    if (this.startedAt === null) return { partnerId: null, secondsRemaining: null, progress: 0, completed: false };
    const elapsed = Math.max(0, now - this.startedAt);
    return {
      partnerId: this.partnerId,
      // A timer may reach the deadline, but only a fresh frame may finish.
      secondsRemaining: this.fired ? null
        : Math.max(1, Math.ceil((RECOGNITION_HOLD_MS - elapsed) / 1_000)) as 5 | 4 | 3 | 2 | 1,
      progress: Math.min(1, elapsed / RECOGNITION_HOLD_MS),
      completed,
    };
  }

  /** Watchdog/UI read: expires stale evidence but can never emit completion. */
  view(now: number): RecognitionCountdownView {
    if (this.fired) return this.snapshot(this.startedAt! + RECOGNITION_HOLD_MS);
    if (!this.acceptClock(now)) return this.snapshot(now);
    // Sample age is checked at delivery. Comparing this UI clock to the previous
    // sample would charge inference latency again while the next frame is pending.
    if (this.lastObservationAt !== null && now - this.lastObservationAt > RECOGNITION_MAX_GAP_MS) this.clearHold();
    return this.snapshot(now);
  }

  /**
   * now: delivery/UI time. sampledAt: sampled immediately BEFORE detector await.
   * A late inference sampled before the deadline cannot complete the hold.
   */
  observe(ids: readonly MatchedId[], selfId: MatchedId, now: number, sampledAt = now): RecognitionCountdownView {
    if (this.fired) return this.snapshot(this.startedAt! + RECOGNITION_HOLD_MS);
    if (!this.acceptClock(now)) return this.snapshot(now);
    if (!Number.isFinite(sampledAt) || sampledAt < 0 || sampledAt > now
      || now - sampledAt > RECOGNITION_MAX_GAP_MS
      || (this.lastObservationAt !== null && now <= this.lastObservationAt)
      || (this.lastSampleAt !== null && sampledAt <= this.lastSampleAt)) {
      // Keep timestamp watermarks: rejected/replayed evidence cannot refresh them.
      this.clearHold();
      return this.snapshot(now);
    }
    if ((this.lastObservationAt !== null && now - this.lastObservationAt > RECOGNITION_MAX_GAP_MS)
      || (this.lastSampleAt !== null && sampledAt - this.lastSampleAt > RECOGNITION_MAX_GAP_MS)) this.clearHold();
    this.lastObservationAt = now;
    this.lastSampleAt = sampledAt;

    if (!validId(selfId) || ids.length !== 2 || !ids.every(validId)
      || ids[0] === ids[1] || !ids.includes(selfId)) {
      this.clearHold();
      return this.snapshot(now);
    }
    const partnerId = ids[0] === selfId ? ids[1]! : ids[0]!;
    if (this.selfId !== selfId || this.partnerId !== partnerId) this.clearHold();
    this.startedAt ??= now;
    this.selfId = selfId;
    this.partnerId = partnerId;
    if (now - this.startedAt >= RECOGNITION_HOLD_MS && sampledAt - this.startedAt >= RECOGNITION_HOLD_MS) {
      this.fired = true;
      return this.snapshot(now, true);
    }
    return this.snapshot(now);
  }
}

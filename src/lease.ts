import { RECORDING_FRESHNESS_MS, type RecordingLease } from './domain';

/** Use monotonic time and subtract the entire request round trip; never trust the phone wall clock. */
export function remainingLeaseMs(lease: RecordingLease, requestStarted: number, now: number): number {
  if (![lease.leaseUntil, lease.serverNow, requestStarted, now].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(RECORDING_FRESHNESS_MS, lease.leaseUntil - lease.serverNow) - Math.max(0, now - requestStarted));
}

import type { RecordingLease } from './domain';

/** Use monotonic time and subtract the entire request round trip; never trust the phone wall clock. */
export function remainingLeaseMs(lease: RecordingLease, requestStarted: number, now: number): number {
  if (![lease.leaseUntil, lease.serverNow, requestStarted, now].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(5000, lease.leaseUntil - lease.serverNow) - Math.max(0, now - requestStarted));
}

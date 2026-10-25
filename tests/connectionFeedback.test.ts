import { describe, expect, it } from 'vitest';
import {
  beginConnectionFinish, completeConnectionAcknowledgment, reconcileConnectionFeedback,
  settleConnectionFinish, type ConnectionFeedback,
} from '../src/connectionFeedback';

const initial: ConnectionFeedback = { id: 'one', phase: 'idle' };
const active = { id: 'one', recording: true, connected: false, visible: true };

describe('authoritative connection acknowledgment', () => {
  it('does not show success merely because a finish call returned', () => {
    const watching = reconcileConnectionFeedback(initial, active);
    const finishing = beginConnectionFinish(watching);
    expect(finishing.phase).toBe('finishing');
    expect(settleConnectionFinish(finishing).phase).toBe('retry');
    expect(reconcileConnectionFeedback(settleConnectionFinish(finishing), active).phase).toBe('retry');
  });

  it('shows one green stage after confirmed finish, then enters chat', () => {
    const watching = reconcileConnectionFeedback(initial, active);
    const finishing = beginConnectionFinish(watching);
    const saved = { ...active, recording: false, connected: true };
    const confirmed = reconcileConnectionFeedback(finishing, saved);
    expect(confirmed.phase).toBe('confirmed');
    expect(settleConnectionFinish(confirmed)).toBe(confirmed);
    const complete = completeConnectionAcknowledgment(confirmed);
    expect(complete.phase).toBe('complete');
    expect(reconcileConnectionFeedback(complete, saved)).toBe(complete);
  });

  it('also acknowledges an authoritative peer finish without a local gesture', () => {
    const watching = reconcileConnectionFeedback(initial, active);
    expect(reconcileConnectionFeedback(watching, { ...active, connected: true, recording: false }).phase).toBe('confirmed');
  });

  it('does not replay success when opening a previous connection or another conversation', () => {
    const saved = { ...active, recording: false, connected: true };
    expect(reconcileConnectionFeedback(initial, saved).phase).toBe('complete');
    const old: ConnectionFeedback = { id: 'old', phase: 'finishing' };
    expect(reconcileConnectionFeedback(old, saved).phase).toBe('complete');
  });

  it('never turns ordinary Stop, failed finish, or cancellation into success', () => {
    const watching = reconcileConnectionFeedback(initial, active);
    expect(reconcileConnectionFeedback(watching, { ...active, recording: false }).phase).toBe('watching');
    const pending = beginConnectionFinish(watching);
    const failed = settleConnectionFinish(pending);
    expect(reconcileConnectionFeedback(failed, { ...active, recording: false }).phase).toBe('retry');
  });

  it('does not replay an interrupted green stage after backgrounding', () => {
    const watching = reconcileConnectionFeedback(initial, active);
    const saved = { ...active, recording: false, connected: true };
    const green = reconcileConnectionFeedback(watching, saved);
    const hidden = reconcileConnectionFeedback(green, { ...saved, visible: false });
    expect(hidden.phase).toBe('complete');
    expect(reconcileConnectionFeedback(hidden, saved).phase).toBe('complete');
  });

  it('does not advance a pending finish on a stale acknowledgment timer', () => {
    const pending = beginConnectionFinish(reconcileConnectionFeedback(initial, active));
    expect(completeConnectionAcknowledgment(pending)).toBe(pending);
    expect(beginConnectionFinish(pending)).toBe(pending);
  });

  it('accepts late authoritative success after an uncertain finish without resubmitting', () => {
    const retry = settleConnectionFinish(beginConnectionFinish(reconcileConnectionFeedback(initial, active)));
    expect(reconcileConnectionFeedback(retry, { ...active, connected: true, recording: false }).phase).toBe('confirmed');
  });

  it('closes a cancelled encounter even while the finish promise has not settled', () => {
    const pending = beginConnectionFinish(reconcileConnectionFeedback(initial, active));
    const cancelled = reconcileConnectionFeedback(pending, { ...active, recording: false, cancelled: true });
    expect(cancelled.phase).toBe('complete');
    expect(settleConnectionFinish(cancelled)).toBe(cancelled);
    expect(reconcileConnectionFeedback(cancelled, { ...active, recording: false, cancelled: true }).phase).not.toBe('confirmed');
  });
});

import { describe, expect, it } from 'vitest';
import { demoReducer, demoSnapshot, initialDemo, samplePeople } from '../src/demo';
import { remainingLeaseMs } from '../src/lease';
import type { Conversation } from '../src/domain';

const pair: Conversation = { id: 'c', eventId: 'builders', participants: samplePeople, recorderId: 'alex', status: 'consent', recordingConsent: [], exchangeConsent: [] };
describe('labelled walkthrough state', () => {
  it('requires both approvals and the designated recorder', () => {
    let state = demoReducer(initialDemo(), { type: 'pair', conversation: pair });
    state = demoReducer(state, { type: 'start', id: 'c' });
    expect(state.conversations[0].status).toBe('consent');
    state = demoReducer(state, { type: 'consent', id: 'c' });
    state = demoReducer(state, { type: 'start', id: 'c' });
    expect(state.conversations[0].status).toBe('consent');
    state = demoReducer(state, { type: 'actor', id: 'sam' });
    state = demoReducer(state, { type: 'consent', id: 'c' });
    state = demoReducer(state, { type: 'start', id: 'c' });
    expect(state.conversations[0].status).toBe('consent');
    state = demoReducer(state, { type: 'actor', id: 'alex' });
    state = demoReducer(state, { type: 'start', id: 'c' });
    expect(state.conversations[0].status).toBe('recording');
  });
  it('gesture does not authorize sharing and recaps are symmetric', () => {
    let state = demoReducer(initialDemo(), { type: 'pair', conversation: { ...pair, status: 'recording' } });
    state = demoReducer(state, { type: 'stop', id: 'c' });
    expect(state.conversations[0].recap).toBeUndefined();
    state = demoReducer(state, { type: 'exchange', id: 'c' });
    expect(state.conversations[0].recap).toBeUndefined();
    state = demoReducer(state, { type: 'actor', id: 'sam' });
    state = demoReducer(state, { type: 'exchange', id: 'c' });
    const sam = demoSnapshot(state);
    state = demoReducer(state, { type: 'actor', id: 'alex' });
    const alex = demoSnapshot(state);
    expect(sam.conversations[0].recap).toEqual(alex.conversations[0].recap);
    expect(alex.conversations[0].recap?.source).toBe('sample');
    expect(sam.me.id).not.toBe(alex.me.id);
  });
});
describe('conservative monotonic capture lease', () => {
  it('subtracts full round trip independently of phone epoch time', () => {
    expect(remainingLeaseMs({ serverNow: 9_000_000, leaseUntil: 9_005_000 }, 100, 350)).toBe(4750);
  });
  it('rejects expired/invalid leases and caps overlong authorization', () => {
    expect(remainingLeaseMs({ serverNow: 100, leaseUntil: 99 }, 10, 20)).toBe(0);
    expect(remainingLeaseMs({ serverNow: NaN, leaseUntil: 999 }, 10, 20)).toBe(0);
    expect(remainingLeaseMs({ serverNow: 100, leaseUntil: 100000 }, 10, 20)).toBe(4990);
  });
});

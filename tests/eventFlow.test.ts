import { describe, expect, it } from 'vitest';
import { createDemoEncounter, demoReducer, demoSnapshot, initialDemo, type DemoState } from '../src/demo';
import { EVENT_PERMISSION_POLICY_VERSION } from '../src/domain';

function encounter(state = initialDemo(), id = 'first') {
  return demoReducer(state, { type: 'pair', conversation: createDemoEncounter(state, 'builders', 'sam', id, 1000) });
}
function finish(state: DemoState, id = 'first') {
  return demoReducer(state, { type: 'finish', id, method: 'gesture' });
}

describe('event-mode preview, distinct from legacy per-conversation consent', () => {
  it('starts a simulated encounter automatically with the two fictional event grants', () => {
    const state = encounter();
    const c = state.conversations[0];
    expect(c).toMatchObject({ status: 'recording', consentMode: 'event', captureSource: 'phone', startedAt: 1000 });
    expect(c.recordingConsent).toEqual(['alex', 'sam']);
    expect(c.exchangeConsent).toEqual([]);
    expect(c.connectedAt).toBeUndefined();
    expect(demoSnapshot(state, 'builders').eventPermission).toEqual({ enabled: true, policyVersion: EVENT_PERMISSION_POLICY_VERSION });
    expect(demoSnapshot(state).activeRecorderConversationId).toBe('first');
  });

  it('requires each account’s own event grant, not just a portrait or membership', () => {
    const paused = demoReducer(initialDemo(), { type: 'eventPermission', eventId: 'builders', enabled: false });
    expect(createDemoEncounter.bind(null, paused, 'builders', 'sam', 'blocked')).toThrow('Glance enabled');
    const sam = demoReducer(paused, { type: 'actor', id: 'sam' });
    const ownGrant = demoReducer(sam, { type: 'eventPermission', eventId: 'builders', enabled: true });
    expect(ownGrant.eventPermissions.builders).toEqual(['sam']);
    expect(demoSnapshot(ownGrant, 'builders').members.find(p => p.id === 'alex')?.glanceEnabled).toBe(false);
  });

  it('does not auto-grant a newly created event', () => {
    const state = demoReducer(initialDemo(), { type: 'event', event: { id: 'new', title: 'New event', location: 'Studio', hostId: 'alex', inviteCode: 'NEW123' } });
    expect(demoSnapshot(state, 'new').eventPermission?.enabled).toBe(false);
    expect(demoSnapshot(state, 'builders').eventPermission?.enabled).toBe(true);
  });

  it('one finish signal connects, shares the same recap, and opens both participant message views', () => {
    const state = finish(encounter());
    const a = demoSnapshot(state, 'builders');
    const b = demoSnapshot(demoReducer(state, { type: 'actor', id: 'sam' }), 'builders');
    expect(a.conversations[0]).toMatchObject({ status: 'shared', finishMethod: 'gesture', exchangeConsent: ['alex', 'sam'], messages: [] });
    expect(a.conversations[0].connectedAt).toBeGreaterThan(0);
    expect(b.conversations[0].recap).toEqual(a.conversations[0].recap);
    expect(a.conversations[0].participants.find(p => p.id !== a.me.id)?.id).toBe('sam');
    expect(b.conversations[0].participants.find(p => p.id !== b.me.id)?.id).toBe('alex');
  });

  it('permits either authorized participant to finish by the backup button', () => {
    const sam = demoReducer(encounter(), { type: 'actor', id: 'sam' });
    const state = demoReducer(sam, { type: 'finish', id: 'first', method: 'button' });
    expect(state.conversations[0].finishMethod).toBe('button');
    expect(state.conversations[0].status).toBe('shared');
  });

  it('ordinary Stop is final and does not connect through a late gesture or legacy confirmation', () => {
    let state = demoReducer(encounter(), { type: 'stop', id: 'first' });
    state = finish(state);
    state = demoReducer(state, { type: 'exchange', id: 'first' });
    state = demoReducer(state, { type: 'actor', id: 'sam' });
    state = demoReducer(state, { type: 'exchange', id: 'first' });
    expect(state.conversations[0]).toMatchObject({ status: 'ended', exchangeConsent: [] });
    expect(state.conversations[0].recap).toBeUndefined();
    expect(state.conversations[0].connectedAt).toBeUndefined();
  });

  it('revocation terminates unfinished capture and re-enabling cannot resurrect it', () => {
    let state = demoReducer(encounter(), { type: 'eventPermission', eventId: 'builders', enabled: false });
    state = demoReducer(state, { type: 'eventPermission', eventId: 'builders', enabled: true });
    expect(finish(state).conversations[0].status).toBe('cancelled');
  });

  it('pausing the event preserves already shared chats', () => {
    const state = demoReducer(finish(encounter()), { type: 'eventPermission', eventId: 'builders', enabled: false });
    expect(state.conversations[0].status).toBe('shared');
    expect(state.conversations[0].recap?.source).toBe('sample');
  });

  it('sends real in-memory messages to both views without adding an automatic response', () => {
    let state = finish(encounter());
    state = demoReducer(state, { type: 'message', id: 'first', message: {
      id: 'm1', conversationId: 'first', senderId: 'alex', text: '  Coffee next week?  ', createdAt: 2000,
    } });
    const sam = demoSnapshot(demoReducer(state, { type: 'actor', id: 'sam' }));
    expect(sam.conversations[0].messages).toEqual([{ id: 'm1', conversationId: 'first', senderId: 'alex', text: 'Coffee next week?', createdAt: 2000 }]);
    expect(finish(state).conversations[0].messages).toHaveLength(1);
  });

  it('rejects blank, overlength, misattributed and pre-connection messages', () => {
    const unfinished = encounter();
    const message = { id: 'm1', conversationId: 'first', senderId: 'alex', text: 'Hello', createdAt: 2000 };
    expect(demoReducer(unfinished, { type: 'message', id: 'first', message }).conversations[0].messages).toEqual([]);
    for (const bad of [{ text: '   ' }, { text: 'x'.repeat(2001) }, { senderId: 'sam' }, { conversationId: 'wrong' }]) {
      const state = demoReducer(finish(unfinished), { type: 'message', id: 'first', message: { ...message, ...bad } });
      expect(state.conversations[0].messages).toEqual([]);
    }
  });

  it('segments the next encounter into a new thread and deletes only the chosen thread', () => {
    let state = finish(encounter());
    const first = state.conversations[0];
    state = encounter(state, 'second');
    expect(state.conversations).toHaveLength(2);
    expect(state.conversations.find(c => c.id === 'first')).toEqual(first);
    state = demoReducer(state, { type: 'delete', id: 'first' });
    expect(state.conversations.map(c => c.id)).toEqual(['second']);
  });

  it('rejects overlapping or duplicate encounter insertion', () => {
    const state = encounter();
    expect(() => createDemoEncounter(state, 'builders', 'sam', 'second')).toThrow('current conversation');
    expect(demoReducer(state, { type: 'pair', conversation: state.conversations[0] }).conversations).toHaveLength(1);
    expect(demoReducer(state, { type: 'pair', conversation: { ...state.conversations[0], id: 'stale' } }).conversations).toHaveLength(1);
  });
});

import portraits from '../assets/demo-portraits.json';
import type { Conversation, Event, Profile, Recap, Snapshot } from './domain';

export const samplePeople: Profile[] = [
  { id: 'alex', name: 'Alex Chen', role: 'Builder · human-centered AI', photoUrl: portraits.alex },
  { id: 'sam', name: 'Sam Rivera', role: 'Designer · creative tools', photoUrl: portraits.sam },
];
export const sampleRecap: Recap = {
  summary: 'You connected over making technology feel more human. Alex is building tools that help people stay present, while Sam is exploring more thoughtful ways to capture creative ideas. You both want useful AI that stays out of the way.',
  topics: ['Human-centered AI', 'Creative collaboration', 'Designing for presence'],
  nextSteps: ['Compare your early prototypes over coffee.', 'Share one example of an AI interaction that feels natural.'],
  source: 'sample',
};
export interface DemoState {
  actor: string;
  people: Profile[];
  events: Event[];
  memberships: Record<string, string[]>;
  conversations: Conversation[];
}
export function initialDemo(): DemoState {
  return {
    actor: 'alex', people: [...samplePeople],
    events: [{ id: 'builders', title: 'Builders, after hours', location: 'The studio · Demo event', inviteCode: 'GLANCE2026', hostId: 'alex' }],
    memberships: { builders: ['alex', 'sam'] }, conversations: [],
  };
}
export type DemoAction =
  | { type: 'actor'; id: string }
  | { type: 'profile'; profile: Profile }
  | { type: 'event'; event: Event }
  | { type: 'join'; eventId: string }
  | { type: 'pair'; conversation: Conversation }
  | { type: 'consent' | 'start' | 'stop' | 'exchange' | 'cancel' | 'delete'; id: string };

/** A visibly labelled in-memory walkthrough. This reducer never records or calls an AI. */
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'actor') return { ...state, actor: action.id };
  if (action.type === 'profile') return { ...state, people: state.people.map(p => p.id === action.profile.id ? action.profile : p) };
  if (action.type === 'event') return { ...state, events: [...state.events, action.event], memberships: { ...state.memberships, [action.event.id]: [state.actor] } };
  if (action.type === 'join') return { ...state, memberships: { ...state.memberships, [action.eventId]: [...new Set([...(state.memberships[action.eventId] ?? []), state.actor])] } };
  if (action.type === 'pair') return { ...state, conversations: [action.conversation, ...state.conversations] };
  if (action.type === 'delete') return { ...state, conversations: state.conversations.filter(c => c.id !== action.id) };
  return { ...state, conversations: state.conversations.map(c => {
    if (c.id !== action.id || !c.participants.some(p => p.id === state.actor)) return c;
    if (action.type === 'consent' && c.status === 'consent') return { ...c, recordingConsent: [...new Set([...c.recordingConsent, state.actor])] };
    if (action.type === 'start' && c.status === 'consent' && c.recorderId === state.actor && c.participants.every(p => c.recordingConsent.includes(p.id)))
      return { ...c, status: 'recording', startedAt: Date.now() };
    if (action.type === 'stop' && c.status === 'recording') return { ...c, status: 'ended', endedAt: Date.now() };
    if (action.type === 'exchange' && c.status === 'ended') {
      const exchangeConsent = [...new Set([...c.exchangeConsent, state.actor])];
      return c.participants.every(p => exchangeConsent.includes(p.id))
        ? { ...c, exchangeConsent, status: 'shared', recap: sampleRecap } : { ...c, exchangeConsent };
    }
    if (action.type === 'cancel' && c.status !== 'shared') return { ...c, status: 'cancelled', recap: undefined };
    return c;
  }) };
}
export function demoSnapshot(state: DemoState, eventId?: string): Snapshot {
  const events = state.events.filter(e => state.memberships[e.id]?.includes(state.actor));
  const event = events.find(e => e.id === eventId);
  const me = state.people.find(p => p.id === state.actor)!;
  return {
    me, events, event,
    members: event ? state.people.filter(p => state.memberships[event.id]?.includes(p.id)) : [],
    conversations: state.conversations.filter(c => c.participants.some(p => p.id === state.actor))
      .map(c => ({ ...c, participants: c.participants.map(p => state.people.find(fresh => fresh.id === p.id) ?? p) })),
  };
}

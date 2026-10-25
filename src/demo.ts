import portraits from '../assets/demo-portraits.json';
import type { ChatMessage, Conversation, Event, FaceDirectory, Profile, Recap, Snapshot } from './domain';
import { DEMO_FACE_LIMIT, EVENT_PERMISSION_POLICY_VERSION, FACE_MODEL } from './domain';
import { compactDescriptor, validDescriptors } from './face';

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
  /** Fictional attendees' event-entry permissions, never a grant for a real account. */
  eventPermissions: Record<string, string[]>;
  conversations: Conversation[];
  /** Face scans taken in this tab. Memory only; a reload erases them. */
  faceScans: Record<string, number[][]>;
}
export function initialDemo(): DemoState {
  return {
    actor: 'alex', people: [...samplePeople],
    events: [{ id: 'builders', title: 'Builders, after hours', location: 'The studio · Demo event', inviteCode: 'GLANCE2026', hostId: 'alex' }],
    memberships: { builders: ['alex', 'sam'] },
    eventPermissions: { builders: ['alex', 'sam'] }, conversations: [], faceScans: {},
  };
}
export type DemoAction =
  | { type: 'actor'; id: string }
  | { type: 'profile'; profile: Profile }
  | { type: 'event'; event: Event }
  | { type: 'join'; eventId: string }
  | { type: 'eventPermission'; eventId: string; enabled: boolean }
  | { type: 'pair'; conversation: Conversation }
  | { type: 'finish'; id: string; method: 'gesture' | 'button' }
  | { type: 'message'; id: string; message: ChatMessage }
  /** A preview attendee for someone physically present; joins with Glance enabled. */
  | { type: 'addPerson'; eventId: string; profile: Profile }
  | { type: 'faceScan'; profileId: string; descriptors: number[][] }
  | { type: 'faceScanDelete'; profileId: string }
  | { type: 'consent' | 'start' | 'stop' | 'exchange' | 'cancel' | 'delete'; id: string };

/** A visibly labelled in-memory walkthrough. This reducer never records or calls an AI. */
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'actor') return state.people.some(p => p.id === action.id) ? { ...state, actor: action.id } : state;
  if (action.type === 'profile') return { ...state, people: state.people.map(p => p.id === action.profile.id ? action.profile : p) };
  if (action.type === 'event') return { ...state, events: [...state.events, action.event], memberships: { ...state.memberships, [action.event.id]: [state.actor] } };
  if (action.type === 'addPerson') {
    const members = state.memberships[action.eventId];
    if (!members?.includes(state.actor) || members.length >= DEMO_FACE_LIMIT
      || state.people.some(p => p.id === action.profile.id) || !action.profile.name.trim()) return state;
    return {
      ...state, people: [...state.people, action.profile],
      memberships: { ...state.memberships, [action.eventId]: [...members, action.profile.id] },
      eventPermissions: { ...state.eventPermissions, [action.eventId]: [...(state.eventPermissions[action.eventId] ?? []), action.profile.id] },
    };
  }
  if (action.type === 'faceScan') {
    if (!state.people.some(p => p.id === action.profileId) || !validDescriptors(action.descriptors)) return state;
    return { ...state, faceScans: { ...state.faceScans, [action.profileId]: action.descriptors.map(compactDescriptor) } };
  }
  if (action.type === 'faceScanDelete') {
    const { [action.profileId]: _removed, ...faceScans } = state.faceScans;
    return { ...state, faceScans };
  }
  if (action.type === 'join') return { ...state, memberships: { ...state.memberships, [action.eventId]: [...new Set([...(state.memberships[action.eventId] ?? []), state.actor])] } };
  if (action.type === 'eventPermission') {
    if (!state.memberships[action.eventId]?.includes(state.actor)) return state;
    const permissions = state.eventPermissions[action.eventId] ?? [];
    return {
      ...state,
      eventPermissions: { ...state.eventPermissions, [action.eventId]: action.enabled
        ? [...new Set([...permissions, state.actor])] : permissions.filter(id => id !== state.actor) },
      conversations: action.enabled ? state.conversations : state.conversations.map(c =>
        c.eventId === action.eventId && c.consentMode === 'event' && c.status !== 'shared' && c.status !== 'cancelled'
          && c.participants.some(p => p.id === state.actor)
          ? { ...c, status: 'cancelled', recap: undefined, recordingConsent: [], exchangeConsent: [] } : c),
    };
  }
  if (action.type === 'pair') {
    const c = action.conversation;
    if (state.conversations.some(existing => existing.id === c.id)) return state;
    if (c.consentMode === 'event' && (
      !c.participants.every(p => state.memberships[c.eventId]?.includes(p.id) && state.eventPermissions[c.eventId]?.includes(p.id))
      || state.conversations.some(existing => ['consent', 'recording'].includes(existing.status)
        && existing.participants.some(p => c.participants.some(next => next.id === p.id))))) return state;
    return { ...state, conversations: [c, ...state.conversations] };
  }
  if (action.type === 'delete') return { ...state, conversations: state.conversations.filter(c => c.id !== action.id || !c.participants.some(p => p.id === state.actor)) };
  return { ...state, conversations: state.conversations.map(c => {
    if (c.id !== action.id || !c.participants.some(p => p.id === state.actor)) return c;
    if (action.type === 'finish' && c.consentMode === 'event' && c.status === 'recording') {
      if (!c.participants.every(p => state.eventPermissions[c.eventId]?.includes(p.id))) return c;
      const now = Date.now();
      return { ...c, endedAt: now, connectedAt: now, finishMethod: action.method,
        exchangeConsent: c.participants.map(p => p.id), status: 'shared', recap: sampleRecap, messages: [] };
    }
    if (action.type === 'message' && (c.connectedAt || c.status === 'shared') && c.status !== 'cancelled') {
      const text = action.message.text.trim();
      if (!text || text.length > 2000 || action.message.senderId !== state.actor || action.message.conversationId !== c.id) return c;
      if (c.messages?.some(m => m.id === action.message.id)) return c;
      return { ...c, messages: [...(c.messages ?? []), { ...action.message, text }].slice(-50) };
    }
    if (action.type === 'consent' && c.consentMode !== 'event' && c.status === 'consent') return { ...c, recordingConsent: [...new Set([...c.recordingConsent, state.actor])] };
    if (action.type === 'start' && c.consentMode !== 'event' && c.status === 'consent' && c.recorderId === state.actor && c.participants.every(p => c.recordingConsent.includes(p.id)))
      return { ...c, status: 'recording', startedAt: Date.now() };
    if (action.type === 'stop' && c.status === 'recording') return { ...c, status: 'ended', endedAt: Date.now() };
    if (action.type === 'exchange' && c.consentMode !== 'event' && c.status === 'ended') {
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
    me: event ? { ...me, glanceEnabled: state.eventPermissions[event.id]?.includes(me.id) ?? false } : me,
    events, event,
    eventPermission: event ? {
      enabled: state.eventPermissions[event.id]?.includes(me.id) ?? false,
      policyVersion: EVENT_PERMISSION_POLICY_VERSION,
    } : undefined,
    members: event ? state.people.filter(p => state.memberships[event.id]?.includes(p.id))
      .map(p => ({ ...p, glanceEnabled: state.eventPermissions[event.id]?.includes(p.id) ?? false })) : [],
    conversations: state.conversations.filter(c => c.participants.some(p => p.id === state.actor))
      .map(c => ({ ...c, participants: c.participants.map(p => state.people.find(fresh => fresh.id === p.id) ?? p) })),
    activeRecorderConversationId: state.conversations.find(c => c.recorderId === state.actor && ['consent', 'recording'].includes(c.status))?.id,
  };
}

/** Mirrors the backend directory: withheld unless the actor enabled Glance for the event. */
export function demoFaceDirectory(state: DemoState, eventId: string): FaceDirectory {
  const permitted = state.eventPermissions[eventId] ?? [];
  const enabled = Boolean(state.memberships[eventId]?.includes(state.actor) && permitted.includes(state.actor));
  return {
    model: FACE_MODEL, enabled, scanned: Boolean(state.faceScans[state.actor]),
    templates: enabled ? (state.memberships[eventId] ?? []).filter(id => permitted.includes(id) && state.faceScans[id])
      .map(id => ({ profileId: id, descriptors: state.faceScans[id] })) : [],
  };
}

export function createDemoEncounter(state: DemoState, eventId: string, partnerId: string, id: string, now = Date.now()): Conversation {
  const participants = state.people.filter(p => [state.actor, partnerId].includes(p.id));
  if (state.actor === partnerId || participants.length !== 2
    || !participants.every(p => state.memberships[eventId]?.includes(p.id)))
    throw new Error('Both people need to be members of this event.');
  if (!participants.every(p => state.eventPermissions[eventId]?.includes(p.id)))
    throw new Error('Both people need Glance enabled for this event.');
  if (state.conversations.some(c => ['consent', 'recording'].includes(c.status)
    && c.participants.some(p => [state.actor, partnerId].includes(p.id))))
    throw new Error('Finish or stop your current conversation first.');
  return {
    id, eventId, participants, recorderId: state.actor, consentMode: 'event', captureSource: 'phone',
    status: 'recording', recordingConsent: participants.map(p => p.id),
    exchangeConsent: [], startedAt: now, messages: [],
  };
}

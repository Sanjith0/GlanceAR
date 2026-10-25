import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type { ChatMessage } from '../domain';
import type {
  AuthStatus, ConnectionRecord, EventDetails, EventDraft, FaceEnrollmentResult, FaceEnrollmentState, PersonDetails,
  ProfileDraft, RecognitionPreferences, RecognitionScenario, Rsvp,
} from './contracts';
import { emptyProfileDraft } from './contracts';
import type { FaceScanScenario, LinkedInScenario } from './adapters';
import { fixtureDetails } from '../fixtures/people';
import { fixtureEvents } from '../fixtures/events';
import { fixtureConnections } from '../fixtures/connections';

/** Developer state selector values; inspected from /dev, never from the user journey. */
export interface DevOverrides {
  events: 'ready' | 'empty' | 'loading' | 'error';
  connections: 'ready' | 'empty' | 'loading' | 'error';
  faceScan: FaceScanScenario;
  linkedin: LinkedInScenario;
  recognition: RecognitionScenario;
}

export interface AppState {
  auth: AuthStatus;
  draft: ProfileDraft;
  enrollment: FaceEnrollmentState & { result?: FaceEnrollmentResult };
  /** Invitation code to resume once the person has signed up or logged in. */
  intendedInvite?: string;
  details: Record<string, PersonDetails>;
  eventDetails: Record<string, EventDetails>;
  /** Events the signed-in person was invited to but has not joined yet. */
  invitations: string[];
  rsvps: Record<string, Rsvp>;
  connections: ConnectionRecord[];
  /** Private "remember this person" marks, keyed `eventId:personId`. Never shared. */
  bookmarks: string[];
  preferences: RecognitionPreferences;
  eventDraft: EventDraft | null;
  dev: DevOverrides;
}

export function initialAppState(): AppState {
  const events = fixtureEvents();
  return {
    auth: 'signed-out',
    draft: emptyProfileDraft(),
    enrollment: { status: 'none', sample: false },
    details: { ...fixtureDetails },
    eventDetails: Object.fromEntries(events.map(item => [item.event.id, item.details])),
    invitations: ['printshop'],
    rsvps: { builders: 'going', salon: 'going', cafe: 'going' },
    connections: fixtureConnections(),
    bookmarks: ['salon:priya'],
    preferences: { recognizeByDefault: true, showStarters: true },
    eventDraft: null,
    dev: { events: 'ready', connections: 'ready', faceScan: 'success', linkedin: 'success', recognition: 'recognized' },
  };
}

type Action =
  | { type: 'auth'; auth: AuthStatus }
  | { type: 'draft'; patch: Partial<ProfileDraft> }
  | { type: 'resetDraft' }
  | { type: 'enrollment'; enrollment: AppState['enrollment'] }
  | { type: 'intendedInvite'; code?: string }
  | { type: 'details'; id: string; patch: Partial<PersonDetails> }
  | { type: 'eventDetails'; id: string; details: EventDetails }
  | { type: 'invitation'; id: string; present: boolean }
  | { type: 'rsvp'; eventId: string; rsvp: Rsvp }
  | { type: 'connection'; record: ConnectionRecord }
  | { type: 'connectionPatch'; id: string; patch: Partial<Pick<ConnectionRecord, 'note' | 'bookmarked'>> }
  | { type: 'connectionMessage'; id: string; message: ChatMessage }
  | { type: 'connectionRemove'; id: string }
  | { type: 'bookmark'; key: string; present: boolean }
  | { type: 'preferences'; patch: Partial<RecognitionPreferences> }
  | { type: 'eventDraft'; draft: EventDraft | null }
  | { type: 'dev'; patch: Partial<DevOverrides> }
  | { type: 'reset' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'auth': return { ...state, auth: action.auth };
    case 'draft': return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'resetDraft': return { ...state, draft: emptyProfileDraft(), enrollment: { status: 'none', sample: false } };
    case 'enrollment': return { ...state, enrollment: action.enrollment };
    case 'intendedInvite': return { ...state, intendedInvite: action.code };
    case 'details': {
      const current = state.details[action.id] ?? { occupation: '', interests: [], facts: [] };
      return { ...state, details: { ...state.details, [action.id]: { ...current, ...action.patch } } };
    }
    case 'eventDetails': return { ...state, eventDetails: { ...state.eventDetails, [action.id]: action.details } };
    case 'invitation': return { ...state, invitations: action.present ? [...new Set([...state.invitations, action.id])] : state.invitations.filter(id => id !== action.id) };
    case 'rsvp': return { ...state, rsvps: { ...state.rsvps, [action.eventId]: action.rsvp } };
    case 'connection': return state.connections.some(c => c.id === action.record.id) ? state : { ...state, connections: [action.record, ...state.connections] };
    case 'connectionPatch': return { ...state, connections: state.connections.map(c => c.id === action.id ? { ...c, ...action.patch } : c) };
    case 'connectionMessage': return { ...state, connections: state.connections.map(c => c.id === action.id && !c.messages.some(m => m.id === action.message.id)
      ? { ...c, messages: [...c.messages, action.message].slice(-50) } : c) };
    case 'connectionRemove': return { ...state, connections: state.connections.filter(c => c.id !== action.id) };
    case 'bookmark': return { ...state, bookmarks: action.present ? [...new Set([...state.bookmarks, action.key])] : state.bookmarks.filter(key => key !== action.key) };
    case 'preferences': return { ...state, preferences: { ...state.preferences, ...action.patch } };
    case 'eventDraft': return { ...state, eventDraft: action.draft };
    case 'dev': return { ...state, dev: { ...state.dev, ...action.patch } };
    case 'reset': return initialAppState();
    default: return state;
  }
}

const Context = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null);

/**
 * Local presentation and sample-data state for the redesigned frontend. It sits
 * beside `GlanceProvider` (which owns backend-shaped state) and never records,
 * uploads or sends anything. Memory only: a reload resets it.
 */
export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialAppState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppStore() {
  const context = useContext(Context);
  if (!context) throw new Error('AppStoreProvider is missing.');
  return context;
}

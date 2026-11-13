import { useSyncExternalStore } from 'react';
import { MAX_INTERESTS, cleanInterests, type Recommendation } from './catalog';

export type UiMode = 'glance' | 'events';
export type Rsvp = 'going' | 'interested';
export interface DiscoverState {
  /** Which product face is showing: the usual Glance UI or the Events (Discover) UI. */
  ui: UiMode;
  interests: string[];
  /** One sentence about what the person watches, from a screenshot read or the sample. */
  summary: string;
  /** Where the shared social signals came from, so the UI can label them honestly. */
  shared: 'none' | 'sample' | 'screenshot' | 'facebook';
  useIntro: boolean;
  /**
   * Sample walkthrough only: whether people matching is switched on. With a
   * backend, the saved list on the server (`snapshot.me.interests`) is the switch.
   */
  matchPeople: boolean;
  rsvps: Record<string, Rsvp>;
  /** Catalog event id → the private Glance room created for it. */
  rooms: Record<string, string>;
  recs: Recommendation | null;
  /** The signalsKey() the current picks were computed for. */
  recsKey: string;
  ranking: boolean;
}

/**
 * Memory only, with no cookies or browser storage for this state, so a
 * reload returns to the Glance UI with no signals, picks or RSVPs.
 */
const initial = (): DiscoverState => ({
  ui: 'glance', interests: [], summary: '', shared: 'none', useIntro: true, matchPeople: false,
  rsvps: {}, rooms: {}, recs: null, recsKey: '', ranking: false,
});
let state = initial();
const listeners = new Set<() => void>();

export const getDiscover = (): DiscoverState => state;
export function setDiscover(patch: Partial<DiscoverState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export const resetDiscover = (): void => setDiscover(initial());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useDiscover = (): DiscoverState => useSyncExternalStore(subscribe, getDiscover, getDiscover);
const sampleMatchInterests = (): string[] | undefined => (state.matchPeople ? state.interests : undefined);
/**
 * The interests the sample walkthrough matches people on; undefined while that
 * switch is off. Changes only when they do, so the app provider can subscribe to it.
 */
export const useSampleMatchInterests = (): string[] | undefined =>
  useSyncExternalStore(subscribe, sampleMatchInterests, sampleMatchInterests);

export const setUi = (ui: UiMode): void => setDiscover({ ui });
export function addInterests(values: string[], from?: { shared: 'sample' | 'screenshot' | 'facebook'; summary: string }): void {
  setDiscover({
    interests: cleanInterests([...state.interests, ...values], MAX_INTERESTS),
    ...(from ? { shared: from.shared, summary: from.summary } : {}),
  });
}
export const removeInterest = (value: string): void =>
  setDiscover({ interests: state.interests.filter((interest) => interest !== value) });
export const clearSignals = (): void => setDiscover({ interests: [], summary: '', shared: 'none', recs: null, recsKey: '' });
/** Tapping the current answer again clears it. */
export function toggleRsvp(eventId: string, kind: Rsvp): void {
  const rsvps = { ...state.rsvps };
  if (rsvps[eventId] === kind) delete rsvps[eventId]; else rsvps[eventId] = kind;
  setDiscover({ rsvps });
}

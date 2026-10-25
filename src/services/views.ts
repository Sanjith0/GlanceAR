import { useEffect, useMemo, useState } from 'react';
import type { Conversation, Event, Profile } from '../domain';
import { useGlance } from '../state';
import { useAppStore } from './store';
import type { ConnectionRecord, EventDetails, EventView, PersonDetails, PersonProfile, Rsvp } from './contracts';
import { createSampleFaceEnrollment, createSampleLinkedInImport, createSampleRecognition } from './adapters';
import { fixturePeople } from '../fixtures/people';

/** A render-safe clock: initialized once, refreshed every minute from a timer (never during render). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export const defaultEventDetails = (): EventDetails => ({
  startsAt: 0, address: '', description: '', purpose: '', visibility: 'invite', prompt: '', cover: 'arches',
});

export function withDetails(profile: Profile, details?: PersonDetails): PersonProfile {
  return { ...profile, occupation: details?.occupation || profile.role, interests: details?.interests ?? [], facts: details?.facts ?? [], phone: details?.phone, email: details?.email };
}

/** Everyone the view layer can see: the sample world in demo mode, otherwise the current snapshot. */
export function usePeopleIndex(): Map<string, PersonProfile> {
  const { snapshot, demoState } = useGlance();
  const { state } = useAppStore();
  return useMemo(() => {
    const base: Profile[] = demoState ? demoState.people : [...(snapshot ? [snapshot.me] : []), ...(snapshot?.members ?? [])];
    const index = new Map<string, PersonProfile>();
    for (const profile of base) index.set(profile.id, withDetails(profile, state.details[profile.id]));
    return index;
  }, [demoState, snapshot, state.details]);
}

export function useMe(): PersonProfile | undefined {
  const { snapshot } = useGlance();
  const { state } = useAppStore();
  return useMemo(() => snapshot ? withDetails(snapshot.me, state.details[snapshot.me.id]) : undefined, [snapshot, state.details]);
}

export function buildEventView(event: Event, input: {
  details?: EventDetails; people: Map<string, PersonProfile>; members: string[]; enabled: string[];
  meId?: string; rsvp: Rsvp; joined: boolean; now: number;
}): EventView {
  const details = input.details ?? defaultEventDetails();
  const host = input.people.get(event.hostId) ?? withDetails({ id: event.hostId, name: 'Your host', role: '', photoUrl: '' });
  const guests = input.members.filter(id => id !== input.meId).map(id => input.people.get(id)).filter((p): p is PersonProfile => Boolean(p))
    .map(p => ({ ...p, glanceEnabled: input.enabled.includes(p.id) }));
  const past = Boolean(details.startsAt) && (details.endsAt ?? details.startsAt + 3 * 3_600_000) < input.now;
  return { ...event, ...details, host, guests, rsvp: input.rsvp, joined: input.joined, isHost: event.hostId === input.meId, past };
}

export function useEventViews(): { status: 'ready' | 'loading' | 'error' | 'empty'; events: EventView[]; invitations: EventView[] } {
  const { snapshot, demoState, loading } = useGlance();
  const { state } = useAppStore();
  const people = usePeopleIndex();
  const now = useNow();
  return useMemo(() => {
    const meId = snapshot?.me.id;
    const build = (event: Event, joined: boolean) => buildEventView(event, {
      details: state.eventDetails[event.id], people, meId, now, joined,
      members: demoState?.memberships[event.id] ?? (snapshot?.event?.id === event.id ? (snapshot.members ?? []).map(p => p.id) : []),
      enabled: demoState?.eventPermissions[event.id] ?? (snapshot?.event?.id === event.id ? (snapshot.members ?? []).filter(p => p.glanceEnabled).map(p => p.id) : []),
      rsvp: state.rsvps[event.id] ?? 'none',
    });
    if (state.dev.events === 'loading' || (loading && !snapshot)) return { status: 'loading' as const, events: [], invitations: [] };
    if (state.dev.events === 'error') return { status: 'error' as const, events: [], invitations: [] };
    if (state.dev.events === 'empty') return { status: 'empty' as const, events: [], invitations: [] };
    const joinedIds = new Set((snapshot?.events ?? []).map(e => e.id));
    const events = (snapshot?.events ?? []).map(e => build(e, true)).sort((a, b) => (a.startsAt || Infinity) - (b.startsAt || Infinity));
    const invitations = (demoState?.events ?? []).filter(e => state.invitations.includes(e.id) && !joinedIds.has(e.id)).map(e => build(e, false));
    return { status: events.length || invitations.length ? 'ready' as const : 'empty' as const, events, invitations };
  }, [snapshot, demoState, loading, state.eventDetails, state.rsvps, state.invitations, state.dev.events, people, now]);
}

export function useEventView(id: string | undefined): EventView | undefined {
  const { events, invitations } = useEventViews();
  const { demoState, snapshot } = useGlance();
  const { state } = useAppStore();
  const people = usePeopleIndex();
  const now = useNow();
  if (!id) return undefined;
  const found = [...events, ...invitations].find(e => e.id === id);
  if (found) return found;
  // A code-joined or deep-linked event the person has not joined yet.
  const event = demoState?.events.find(e => e.id === id);
  if (!event || !demoState) return undefined;
  return buildEventView(event, { details: state.eventDetails[id], people, meId: snapshot?.me.id, now, joined: false,
    members: demoState.memberships[id] ?? [], enabled: demoState.eventPermissions[id] ?? [], rsvp: state.rsvps[id] ?? 'none' });
}

export interface ConnectionView extends ConnectionRecord {
  person: PersonProfile;
  event?: EventView;
  conversation?: Conversation;
}

/** Remembered people: seeded sample records plus any conversation that finished with a connection. */
export function useConnections(): { status: 'ready' | 'loading' | 'error' | 'empty'; connections: ConnectionView[] } {
  const { snapshot } = useGlance();
  const { state } = useAppStore();
  const people = usePeopleIndex();
  const { events } = useEventViews();
  const now = useNow();
  return useMemo(() => {
    if (state.dev.connections === 'loading') return { status: 'loading' as const, connections: [] };
    if (state.dev.connections === 'error') return { status: 'error' as const, connections: [] };
    if (state.dev.connections === 'empty') return { status: 'empty' as const, connections: [] };
    const meId = snapshot?.me.id;
    const fromConversations: ConnectionView[] = (snapshot?.conversations ?? [])
      .filter(c => c.status !== 'cancelled' && (c.connectedAt || c.status === 'shared'))
      .flatMap(c => {
        const other = c.participants.find(p => p.id !== meId);
        const person = other ? people.get(other.id) ?? withDetails(other) : undefined;
        if (!person) return [];
        const local = state.connections.find(record => record.conversationId === c.id);
        return [{
          id: c.id, personId: person.id, eventId: c.eventId, connectedAt: c.connectedAt ?? c.endedAt ?? now, recap: c.recap,
          messages: c.messages ?? [], note: local?.note ?? '', bookmarked: local?.bookmarked ?? false, origin: 'conversation' as const,
          conversationId: c.id, person, event: events.find(e => e.id === c.eventId), conversation: c,
        }];
      });
    const seeded: ConnectionView[] = state.connections.filter(record => record.origin === 'sample' && record.personId !== meId).flatMap(record => {
      const person = people.get(record.personId);
      return person ? [{ ...record, person, event: events.find(e => e.id === record.eventId) }] : [];
    });
    const connections = [...fromConversations, ...seeded].sort((a, b) => b.connectedAt - a.connectedAt);
    return { status: connections.length ? 'ready' as const : 'empty' as const, connections };
  }, [snapshot, state.connections, state.dev.connections, people, events, now]);
}

export function useConnection(id: string | undefined): ConnectionView | undefined {
  const { connections } = useConnections();
  return connections.find(c => c.id === id);
}

/** Adapters for the simulated capabilities, keyed to the developer scenario selector. */
export function useAdapters() {
  const { state } = useAppStore();
  const dev = state.dev;
  return useMemo(() => ({
    faceEnrollment: createSampleFaceEnrollment({ scenario: () => dev.faceScan, portraitUrl: fixturePeople[0].photoUrl }),
    linkedIn: createSampleLinkedInImport(() => dev.linkedin),
    recognition: createSampleRecognition(),
  }), [dev.faceScan, dev.linkedin]);
}

const DAY = 86_400_000;
export function formatEventDate(startsAt: number, now = Date.now(), style: 'short' | 'long' = 'short'): string {
  if (!startsAt) return 'Date to be announced';
  const date = new Date(startsAt);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((startsAt - start.getTime()) / DAY);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (style === 'short') {
    if (dayDiff === 0) return `Tonight, ${time}`;
    if (dayDiff === 1) return `Tomorrow, ${time}`;
    return `${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
  }
  return `${date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} at ${time}`;
}
export function formatDateOnly(value: number): string {
  if (!value) return 'Date';
  return new Date(value).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
export function formatTimeOnly(value: number): string {
  if (!value) return 'Time';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function relativeDay(value: number, now = Date.now()): string {
  const diff = Math.round((now - value) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

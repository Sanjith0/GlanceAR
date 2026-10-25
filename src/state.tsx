import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { GlanceDataClient, ProfileInput, Snapshot } from './domain';
import { createGlanceClient } from './data/convexClient';
import { demoReducer, demoSnapshot, initialDemo, type DemoAction } from './demo';
import { getDeviceToken } from './session';

export const deploymentURL = process.env.EXPO_PUBLIC_CONVEX_URL ?? '';
interface GlanceState {
  mode: 'demo' | 'live';
  setMode: (mode: 'demo' | 'live') => void;
  snapshot: Snapshot | null;
  selectedEvent: string | undefined;
  selectEvent: (id?: string) => void;
  error: string;
  clearError: () => void;
  loading: boolean;
  needsEnrollment: boolean;
  token: string;
  client: GlanceDataClient | null;
  switchActor: (id: string) => void;
  demo: (action: DemoAction) => void;
  run: <T>(operation: () => Promise<T>) => Promise<T>;
  refresh: () => Promise<void>;
  saveProfile: (profile: ProfileInput) => Promise<void>;
  createEvent: (title: string, location: string) => Promise<string>;
  joinEvent: (code: string) => Promise<string>;
  pair: (eventId: string, partnerId: string) => Promise<string>;
}
const Context = createContext<GlanceState | null>(null);
export function GlanceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<'demo' | 'live'>(deploymentURL ? 'live' : 'demo');
  const [sample, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [selectedEvent, selectEvent] = useState<string>();
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(deploymentURL));
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  const client = useMemo(() => deploymentURL ? createGlanceClient(deploymentURL) : null, []);
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!client || !token || mode !== 'live') return;
    const sequence = ++requestSequence.current;
    try {
      const value = await client.snapshot(token, selectedEvent);
      if (sequence !== requestSequence.current) return;
      setLiveSnapshot(value);
      setNeedsEnrollment(false); setError('');
    } catch (e) {
      if (sequence !== requestSequence.current) return;
      const message = e instanceof Error ? e.message : 'Unable to reach Glance.';
      if (message.includes('not registered')) { setNeedsEnrollment(true); setError(''); }
      else setError(message);
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [client, token, mode, selectedEvent]);
  useEffect(() => {
    if (mode === 'live' && client) void getDeviceToken().then(setToken).catch(e => setError(String(e)));
  }, [mode, client]);
  useEffect(() => {
    if (!client || !token || mode !== 'live') return;
    const sequence = ++requestSequence.current;
    let cancelled = false;
    client.snapshot(token, selectedEvent).then(value => {
      if (cancelled || sequence !== requestSequence.current) return;
      setLiveSnapshot(value); setNeedsEnrollment(false); setError('');
    }).catch(e => {
      if (cancelled || sequence !== requestSequence.current) return;
      const message = e instanceof Error ? e.message : 'Unable to reach Glance.';
      if (message.includes('not registered')) { setNeedsEnrollment(true); setError(''); }
      else setError(message);
    }).finally(() => { if (!cancelled && sequence === requestSequence.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, token, mode, selectedEvent]);
  useEffect(() => {
    if (mode !== 'live' || !client || !token || needsEnrollment) return;
    return client.subscribe(token, selectedEvent, value => { setLiveSnapshot(value); setLoading(false); },
      e => { if (!e.message.includes('not registered')) setError(e.message); });
  }, [mode, client, token, selectedEvent, needsEnrollment]);
  useEffect(() => () => { void client?.close(); }, [client]);
  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setError('');
    try { return await operation(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      throw e;
    }
  }, []);
  const setMode = (next: 'demo' | 'live') => {
    if (next === 'live' && !client) { setError('Live mode needs EXPO_PUBLIC_CONVEX_URL and a deployed backend. The included walkthrough works without either.'); return; }
    requestSequence.current++;
    setModeState(next); setError(''); setLoading(next === 'live'); selectEvent(undefined);
  };
  const saveProfile = async (profile: ProfileInput) => {
    if (!profile.name.trim() || !profile.photoUrl) throw new Error('Add your name and a portrait to continue.');
    if (mode === 'demo') { dispatch({ type: 'profile', profile: { ...profile, id: sample.actor } }); return; }
    if (!client || !token) throw new Error('Your device session is not ready.');
    if (needsEnrollment) await client.register(token, profile); else await client.updateProfile(token, profile);
    setNeedsEnrollment(false); await refresh();
  };
  const createEvent = async (title: string, location: string) => {
    if (!title.trim()) throw new Error('Give your event a name.');
    if (mode === 'live') return client!.createEvent(token, title.trim(), location.trim());
    const id = `event-${Date.now()}`;
    dispatch({ type: 'event', event: { id, title: title.trim(), location: location.trim(), hostId: sample.actor, inviteCode: `DEMO${String(Date.now()).slice(-6)}` } });
    return id;
  };
  const joinEvent = async (code: string) => {
    if (mode === 'live') return client!.joinEvent(token, code);
    const event = sample.events.find(e => e.inviteCode === code.trim().toUpperCase());
    if (!event) throw new Error('That invitation was not found. Try GLANCE2026 for the sample event.');
    dispatch({ type: 'join', eventId: event.id }); return event.id;
  };
  const pair = async (eventId: string, partnerId: string) => {
    if (mode === 'live') return client!.createConversation(token, eventId, partnerId);
    if (sample.conversations.some(c => ['consent', 'recording'].includes(c.status) && c.participants.some(p => [sample.actor, partnerId].includes(p.id))))
      throw new Error('Finish or cancel your current conversation first.');
    const id = `conversation-${Date.now()}`;
    dispatch({ type: 'pair', conversation: {
      id, eventId, participants: sample.people.filter(p => [sample.actor, partnerId].includes(p.id)),
      recorderId: sample.actor, status: 'consent', recordingConsent: [], exchangeConsent: [],
    } });
    return id;
  };
  const snapshot = mode === 'demo' ? demoSnapshot(sample, selectedEvent) : liveSnapshot;
  return <Context.Provider value={{
    mode, setMode, snapshot, selectedEvent, selectEvent, error, clearError: () => setError(''),
    loading: mode === 'live' && loading, needsEnrollment: mode === 'live' && needsEnrollment,
    token, client, switchActor: id => dispatch({ type: 'actor', id }), demo: dispatch,
    run, refresh, saveProfile, createEvent, joinEvent, pair,
  }}>{children}</Context.Provider>;
}
export function useGlance(): GlanceState {
  const context = useContext(Context);
  if (!context) throw new Error('GlanceProvider is missing.');
  return context;
}

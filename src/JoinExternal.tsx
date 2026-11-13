import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ConvexError } from 'convex/values';
import { Button, Empty, Notice, Page } from './components';
import { colors, s } from './theme';
import { useGlance } from './state';
import { parseExternalJoin, setPendingJoin } from './externalJoin';

/**
 * Where a "Join with Glance" link from another app lands. It opens the Glance event
 * tied to that app's event (creating it the first time), then goes to the event page.
 * A person without a Glance profile creates one first and is brought back here.
 */
export function JoinExternalScreen() {
  const params = useLocalSearchParams();
  const app = useGlance();
  const key = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the params object is new each render; its contents are the key
  const join = useMemo(() => parseExternalJoin(params as Record<string, unknown>), [key]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  const { mode, loading, token, needsEnrollment, joinExternalEvent } = app;
  const ready = Boolean(app.snapshot);

  useEffect(() => {
    if (!join || mode !== 'live' || loading || !token) return;
    if (needsEnrollment) { setPendingJoin(join); return; }
    if (!ready || started.current === attempt) return;
    started.current = attempt;
    joinExternalEvent(join).then(eventId => {
      setPendingJoin(null);
      router.replace(`/event/${eventId}`);
    }, reason => {
      setError(reason instanceof ConvexError ? String(reason.data) : reason instanceof Error ? reason.message : 'Could not open this event.');
    });
  }, [join, mode, loading, token, needsEnrollment, ready, attempt, joinExternalEvent]);

  const toEvents = () => router.replace('/events');
  if (!join) return <Page title="Join with Glance">
    <Empty icon="link" title="This link does not open an event." text="Ask for a fresh Join with Glance link from the event page, or open one of your events." />
    <Button onPress={toEvents}>Go to your events</Button>
  </Page>;
  return <Page title="Join with Glance">
    <View style={{ gap: 8 }}>
      <Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>JOIN WITH GLANCE</Text>
      <Text testID="join-title" style={s.title}>{join.title}</Text>
      {join.location ? <Text style={s.muted}>{join.location}</Text> : null}
    </View>
    {mode !== 'live' ? <>
      <Notice>Joining from another app needs the live backend. This build runs the sample walkthrough.</Notice>
      <Button onPress={toEvents}>See the walkthrough</Button>
    </> : needsEnrollment ? <View style={[s.soft, { gap: 12 }]}>
      <Text style={s.heading}>Create your Glance profile first.</Text>
      <Text style={s.muted}>It takes a name. Then you go straight into this event, where people who turned Glance on can recognize each other.</Text>
      <Button testID="join-enroll" icon="user-plus" onPress={() => router.push('/enroll')}>Create your profile</Button>
    </View> : error ? <>
      <Notice error>{error}</Notice>
      <Button testID="join-retry" tone="secondary" icon="refresh-cw" onPress={() => { setError(''); setAttempt(value => value + 1); }}>Try again</Button>
      <Button tone="ghost" onPress={toEvents}>Go to your events</Button>
    </> : <View style={[s.row, { paddingVertical: 12 }]}>
      <ActivityIndicator color={colors.blue} />
      <Text style={[s.muted, s.grow]}>Opening this event in Glance…</Text>
    </View>}
  </Page>;
}

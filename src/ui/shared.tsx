import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Icon, Portrait, SampleTag } from '../components';
import { colors, s, type } from '../theme';
import { useGlance } from '../state';
import { samplePeople } from '../demo';

export function useScreenFocused() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}
export function useOperation() {
  const { run } = useGlance();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const perform = useCallback(async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await run(fn); } catch { /* The shared status region shows the failure. */ }
    finally { running.current = false; setBusy(false); }
  }, [run]);
  return { busy, perform };
}
export function GlobalStatus() {
  const app = useGlance();
  return <>
    {app.error ? <View style={[s.status, s.error, s.row]}>
      <Text accessibilityRole="alert" style={[type.small, s.grow, { color: colors.danger }]}>{app.error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={app.clearError}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" color={colors.danger} size={18} /></Pressable>
    </View> : null}
    {app.loading && !app.snapshot ? <ActivityIndicator color={colors.ink} /> : null}
    {app.needsEnrollment && <View style={s.soft}><Text style={type.heading}>Finish your profile.</Text>
      <Text style={type.secondary}>Add a portrait and your name before you join an event.</Text>
      <Button onPress={() => router.push('/signup/face')} icon="user-plus">Create your profile</Button></View>}
  </>;
}
/** Legacy preview label used by the camera lab. */
export function DemoBanner({ actors = false }: { actors?: boolean }) {
  const { mode, demoSummaries } = useGlance();
  if (mode !== 'demo') return null;
  return <View style={{ gap: 10 }}>
    <View style={[s.row, { flexWrap: 'wrap' }]}><SampleTag>Sample preview</SampleTag><Text style={type.small}>{demoSummaries ? 'Records conversations for real summaries' : 'No audio recorded'}</Text></View>
    {actors && <DemoActors />}
  </View>;
}
/** Preview the same shared chat from either sample participant's side. Demo mode only; never a connection approval. */
export function DemoActors({ participantIds }: { participantIds?: string[] }) {
  const { mode, snapshot, switchActor, demoState } = useGlance();
  if (mode !== 'demo' || !demoState) return null;
  const ids = samplePeople.map(p => p.id);
  if (participantIds && !ids.every(id => participantIds.includes(id))) return null;
  const people = ids.map(id => demoState.people.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.paper, borderRadius: 999, padding: 4, alignSelf: 'center' }}>
    <Text style={[type.micro, { paddingLeft: 10 }]}>Viewing as</Text>
    {people.map(p => {
      const selected = snapshot?.me.id === p.id;
      return <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`View as ${p.name}`} onPress={() => switchActor(p.id)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 32, borderRadius: 999, backgroundColor: selected ? colors.powder : 'transparent' }, pressed && s.pressed]}>
        <Portrait person={p} size={20} shape="round" /><Text style={[type.smallStrong, { color: colors.ink }]}>{p.name.split(' ')[0]}</Text>
      </Pressable>;
    })}
  </View>;
}

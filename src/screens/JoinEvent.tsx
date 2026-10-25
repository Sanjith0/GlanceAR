import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Notice, Page, SampleTag } from '../components';
import { colors, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { useSession } from '../services/session';
import { useDemoMode } from '../services/demoMode';
import { Arch } from '../ui/Arch';

/**
 * Join with a code or an invitation link (`/invite/CODE` lands here). If the
 * person is signed out, the code is kept and the welcome screen opens; after
 * signup or login they return here and the invitation opens.
 */
export function JoinEvent() {
  const { code: initial } = useLocalSearchParams<{ code?: string }>();
  const app = useGlance();
  const demo = useDemoMode();
  const { status } = useSession();
  const { state, dispatch } = useAppStore();
  const [code, setCode] = useState((initial ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoTried = useRef(false);

  const join = async (value: string) => {
    const clean = value.trim().toUpperCase();
    if (!clean) { setError('Enter the code from your invitation.'); return; }
    setBusy(true); setError('');
    try {
      const id = await app.joinEvent(clean);
      dispatch({ type: 'invitation', id, present: false });
      app.selectEvent(id);
      router.replace(`/event/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That code didn’t work.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (status === 'signed-out' && initial) dispatch({ type: 'intendedInvite', code: initial.toUpperCase() });
  }, [status, initial, dispatch]);
  useEffect(() => {
    if (status === 'signed-in' && initial && !autoTried.current) { autoTried.current = true; void join(initial); }
    // Only auto-join once per landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, initial]);

  if (status === 'signed-out') return <Redirect href="/welcome" />;
  if (status === 'needs-profile') return <Redirect href="/signup/face" />;

  return <Page back title="Join an event" fallback="/events" testID="join-event"
    footer={<Button busy={busy} icon="arrow-right" testID="join-submit" onPress={() => void join(code)}>Open invitation</Button>}>
    <View style={{ alignItems: 'center', gap: 16, paddingVertical: 10 }}>
      <Arch width={88} height={108} color={colors.powder} base={0.1} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.title, { color: colors.ink, fontSize: 40, lineHeight: 44 }]}>#</Text>
      </Arch>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <Text accessibilityRole="header" style={[type.display, { textAlign: 'center' }]}>You’re invited.</Text>
        <Text style={[type.secondary, { textAlign: 'center', maxWidth: 320 }]}>Enter the code from your host and the invitation opens.</Text>
      </View>
    </View>
    <Field label="Invitation code" testID="join-code" value={code} onChangeText={value => { setCode(value.toUpperCase()); setError(''); }}
      autoCapitalize="characters" autoCorrect={false} maxLength={24} placeholder={demo ? 'Try INKNIGHT or GLANCE2026' : 'For example GLANCE2026'}
      onSubmitEditing={() => void join(code)} returnKeyType="go" error={error || undefined} />
    {state.intendedInvite && <Notice icon="info">We kept the invitation you opened. It will open as soon as you join.</Notice>}
    {demo && <SampleTag>Sample codes join sample events</SampleTag>}
  </Page>;
}

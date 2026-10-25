import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Notice, Page, Portrait, SampleTag, Wordmark } from '../components';
import { colors, radius, type } from '../theme';
import { useAuth } from '../services/session';
import { useDemoMode } from '../services/demoMode';
import { useMe } from '../services/views';

/**
 * Login. There is no password system in this product: the production app signs
 * in with the device credential kept in the Keychain (`session.native.ts`). The
 * preview offers a clearly simulated path into the sample account.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const demo = useDemoMode();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await signIn(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not log in.'); } finally { setBusy(false); }
  };
  return <Page back fallback="/welcome" headerRight={<Wordmark size={22} />} testID="login">
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={type.display}>Welcome back.</Text>
      <Text style={type.secondary}>Glance remembers this device. There’s no password to type.</Text>
    </View>
    {demo && me ? <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 18, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Portrait person={me} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.subheading}>{me.name}</Text>
          <Text style={type.small}>{me.occupation}</Text>
        </View>
        <SampleTag>Sample account</SampleTag>
      </View>
      <Button testID="login-continue" busy={busy} icon="log-in" onPress={() => void go()}>{`Continue as ${me.name.split(' ')[0]}`}</Button>
    </View> : <Button testID="login-continue" busy={busy} icon="log-in" onPress={() => void go()}>Continue on this device</Button>}
    {error ? <Notice error icon="alert-circle">{error}</Notice> : null}
    <Text style={type.small}>{demo
      ? 'In this preview, logging in opens the sample account. The production app uses a device credential and your registered profile; nothing here is a password system.'
      : 'Your device credential is stored in the Keychain. If this device has no profile yet, you’ll be asked to create one.'}</Text>
    <Button tone="quiet" size="sm" onPress={() => router.replace('/signup/face')}>New here? Sign up instead</Button>
  </Page>;
}

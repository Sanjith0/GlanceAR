import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Notice, Page, Tag } from '../components';
import { colors, radius, s, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore, type DevOverrides } from '../services/store';
import { samplePeople } from '../demo';

function Picker<K extends keyof DevOverrides>({ label, name, options, hint }: { label: string; name: K; options: { key: DevOverrides[K]; label: string }[]; hint?: string }) {
  const { state, dispatch } = useAppStore();
  return <View style={{ gap: 8 }}>
    <View style={{ gap: 2 }}><Text style={type.label}>{label}</Text>{hint && <Text style={type.small}>{hint}</Text>}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(option => {
        const selected = state.dev[name] === option.key;
        return <Pressable key={String(option.key)} accessibilityRole="radio" accessibilityState={{ selected }} testID={`dev-${name}-${String(option.key)}`}
          onPress={() => dispatch({ type: 'dev', patch: { [name]: option.key } as Partial<DevOverrides> })}
          style={({ pressed }) => [{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: selected ? colors.ink : colors.paper, borderWidth: 1.5, borderColor: selected ? colors.ink : colors.line }, pressed && s.pressed]}>
          <Text style={[type.smallStrong, { color: selected ? colors.cream : colors.ink }]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

/**
 * Developer state selector. Lives outside the user journey; switches the
 * sample adapters between success, empty, loading and error states so each
 * screen can be inspected without touching the services.
 */
export function DevTools() {
  const app = useGlance();
  const { state, dispatch } = useAppStore();
  return <Page back title="Developer" fallback="/profile" testID="dev-tools">
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={type.display}>Preview states</Text>
      <Text style={type.secondary}>Everything here drives the sample adapters only. The real services replace them in <Text style={{ fontFamily: 'Inter_600SemiBold' }}>src/services/adapters.ts</Text>.</Text>
    </View>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Tag tone={app.mode === 'demo' ? 'sample' : 'green'}>{app.mode === 'demo' ? 'Sample data' : 'Live backend'}</Tag>
      <Text style={type.small}>{app.mode === 'demo' ? 'No EXPO_PUBLIC_CONVEX_URL configured; everything is in memory.' : 'Connected to the configured Convex deployment.'}</Text>
    </View>
    <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 18, gap: 18 }}>
      <Picker label="Events" name="events" options={[{ key: 'ready', label: 'Success' }, { key: 'empty', label: 'Empty' }, { key: 'loading', label: 'Loading' }, { key: 'error', label: 'Error' }]} />
      <Picker label="Connections" name="connections" options={[{ key: 'ready', label: 'Success' }, { key: 'empty', label: 'Empty' }, { key: 'loading', label: 'Loading' }, { key: 'error', label: 'Error' }]} />
      <Picker label="Face scan" name="faceScan" hint="Applies to the next scan you start." options={[{ key: 'success', label: 'Success' }, { key: 'interrupted', label: 'Interrupted' }, { key: 'unavailable', label: 'Unavailable' }]} />
      <Picker label="LinkedIn import" name="linkedin" options={[{ key: 'success', label: 'Sample results' }, { key: 'empty', label: 'Nothing found' }, { key: 'error', label: 'Error' }]} />
      <Picker label="Live recognition" name="recognition" hint="Scenario played by the sample recognition feed." options={[{ key: 'recognized', label: 'Recognized' }, { key: 'unknown', label: 'Unknown' }, { key: 'uncertain', label: 'Uncertain' }, { key: 'permission', label: 'No camera' }, { key: 'error', label: 'Model error' }]} />
    </View>
    {app.mode === 'demo' && <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 18, gap: 12 }}>
      <Text style={type.label}>Act as</Text>
      <Text style={type.small}>Switch the sample account to see a shared chat from the other side.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {samplePeople.map(p => <View key={p.id} style={{ flex: 1 }}><Button size="sm" tone={app.snapshot?.me.id === p.id ? 'primary' : 'ghost'} onPress={() => app.switchActor(p.id)}>{p.name.split(' ')[0]}</Button></View>)}
      </View>
    </View>}
    <View style={{ gap: 10 }}>
      <Text style={type.label}>Jump to</Text>
      {[
        { label: 'Welcome (signed out)', onPress: () => { dispatch({ type: 'auth', auth: 'signed-out' }); router.replace('/welcome'); } },
        { label: 'Signup: face scan', onPress: () => router.push('/signup/face') },
        { label: 'Live view, Builders', onPress: () => router.push('/event/builders/live') },
        { label: 'Camera lab: register faces (real camera)', onPress: () => router.push('/register/builders') },
        { label: 'Camera lab: LIVE Camera recognition (real camera)', onPress: () => router.push('/live/builders') },
        { label: 'Invitation link: /invite/INKNIGHT', onPress: () => router.push('/invite/INKNIGHT') },
      ].map(item => <Button key={item.label} tone="ghost" size="sm" align="start" icon="arrow-right" onPress={item.onPress}>{item.label}</Button>)}
    </View>
    <Notice icon="info">The camera lab is the repository’s existing face registration and LIVE Camera: real on-device face recognition, the in-memory face database and the three-second same-camera hold. It stays out of the main journey.</Notice>
    <Button tone="ghost" icon="rotate-ccw" onPress={() => dispatch({ type: 'reset' })}>Reset sample state</Button>
    <Text style={type.small}>Build: {state.auth === 'signed-in' ? 'signed in' : 'signed out'} · {state.connections.length} seeded connections · {Object.keys(state.eventDetails).length} event details</Text>
  </Page>;
}

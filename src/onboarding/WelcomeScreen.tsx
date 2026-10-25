import React from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Button, Portrait, Wordmark, useIsDesktop } from '../components';
import { colors, fonts, layout, space, type } from '../theme';
import { Arch } from '../ui/Arch';
import { fixturePeople } from '../fixtures/people';
import { useDemoMode } from '../services/demoMode';
import { useAppStore } from '../services/store';

/** A little gathering: three portraits in arches, one glance across the room. */
function Gathering({ size }: { size: number }) {
  const [alex, sam, maya] = fixturePeople;
  const w = size;
  return <View accessible accessibilityLabel="Three people at a gathering" style={{ width: w, height: w * 0.86, alignSelf: 'center' }}>
    <Arch width={w * 0.62} height={w * 0.78} color={colors.powder} base={0.06} style={{ position: 'absolute', left: w * 0.19, bottom: 0 }} />
    <View style={{ position: 'absolute', left: w * 0.03, bottom: w * 0.06 }}><Portrait person={maya} size={w * 0.34} ring /></View>
    <View style={{ position: 'absolute', right: w * 0.04, bottom: w * 0.1 }}><Portrait person={sam} size={w * 0.36} ring /></View>
    <View style={{ position: 'absolute', left: w * 0.31, bottom: w * 0.2 }}><Portrait person={alex} size={w * 0.4} ring /></View>
    <View style={{ position: 'absolute', right: w * 0.1, top: w * 0.02, width: w * 0.1, height: w * 0.1, borderRadius: w * 0.05, backgroundColor: colors.ink }} />
  </View>;
}

export function WelcomeScreen() {
  const desktop = useIsDesktop();
  const { width } = useWindowDimensions();
  const demo = useDemoMode();
  const { state } = useAppStore();
  const invited = Boolean(state.intendedInvite);
  const art = <Gathering size={Math.min(desktop ? 420 : width - 64, 360)} />;
  const copy = <View style={{ gap: space.lg, maxWidth: 440 }}>
    <Text accessibilityRole="header" style={[type.displayItalic, { fontSize: desktop ? 50 : 42, lineHeight: desktop ? 54 : 46 }]}>Good conversations deserve a second chapter.</Text>
    <Text style={[type.body, { maxWidth: 400 }]}>Glance is for meeting people at events. See who’s worth talking to, what you have in common, and remember them afterward.</Text>
    {invited && <Text style={[type.smallStrong, { color: colors.ink }]}>You’ve been invited. Sign up or log in to open the invitation.</Text>}
    <View style={{ gap: 10, paddingTop: 4 }}>
      <Button testID="welcome-signup" onPress={() => router.push('/signup/face')}>Sign up</Button>
      <Button testID="welcome-login" tone="ghost" onPress={() => router.push('/login')}>Log in</Button>
    </View>
    {demo && <Text style={type.small}>This is a sample preview. Nothing is recorded or sent.</Text>}
  </View>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: layout.gutter, paddingVertical: space.xl }}>
    <View style={{ width: '100%', maxWidth: desktop ? layout.wide : layout.column, alignSelf: 'center', flex: 1, gap: space.xxl }}>
      <Wordmark size={30} />
      {desktop
        ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 64, flex: 1, paddingVertical: 24 }}>
          <View style={{ flex: 1, alignItems: 'center' }}>{art}</View>
          <View style={{ flex: 1 }}>{copy}</View>
        </View>
        : <View style={{ flex: 1, justifyContent: 'center', gap: space.xxl, paddingVertical: 8 }}>{art}{copy}</View>}
      <Text style={[type.micro, { fontFamily: fonts.medium }]}>Meet in person. Keep the conversation, not just the contact.</Text>
    </View>
  </ScrollView>;
}

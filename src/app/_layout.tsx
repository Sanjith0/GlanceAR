import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { GlanceProvider } from '../state';
import { colors, s } from '../theme';
import { announceFacebookReturn, parseFacebookReturn, type FacebookReturn } from '../discover/facebook';

/**
 * The pop-up Facebook sends back after "Connect Facebook". It only passes the
 * result to the page that opened it and closes: it has no session of its own.
 */
function FacebookReturnScreen({ result }: { result: FacebookReturn }) {
  const [received, setReceived] = useState<boolean>();
  useEffect(() => announceFacebookReturn(result, setReceived), [result]);
  const title = received === false ? 'Go back to Glance.' : !result.code ? 'Facebook sign-in cancelled.' : received ? 'Signed in.' : 'Finishing up…';
  return <View style={[s.shell, { justifyContent: 'center' }]}><View testID="facebook-return" style={{ maxWidth: 360, padding: 28, gap: 10 }}>
    <Text accessibilityRole="header" style={s.heading}>{title}</Text>
    <Text style={s.muted}>{received === false
      ? 'This window could not reach the Glance page that opened it. Close it, go back to Glance and start again.'
      : 'You can close this window and go back to Glance.'}</Text>
  </View></View>;
}

export default function RootLayout() {
  // Read once, before the address is tidied, so a return is never mistaken for a normal visit.
  const [facebookReturn] = useState(() => (Platform.OS === 'web' && typeof window !== 'undefined'
    ? parseFacebookReturn(window.location.search) : null));
  const [loaded, error] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  });
  // Before the fonts: the one-time code should leave the address bar straight away.
  if (facebookReturn) return <FacebookReturnScreen result={facebookReturn} />;
  if (!loaded && !error) return <View style={[s.shell, { justifyContent: 'center' }]}><ActivityIndicator color={colors.blue} /></View>;
  return <GlanceProvider><View style={s.shell}><SafeAreaView edges={['top', 'bottom']} style={s.app}>
    <StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: 'fade' }} />
  </SafeAreaView></View></GlanceProvider>;
}

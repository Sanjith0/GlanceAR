import React from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { GlanceProvider } from '../state';
import { colors, s } from '../theme';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  });
  if (!loaded && !error) return <View style={[s.shell, { justifyContent: 'center' }]}><ActivityIndicator color={colors.blue} /></View>;
  return <GlanceProvider><View style={s.shell}><SafeAreaView edges={['top', 'bottom']} style={s.app}>
    <StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: 'fade' }} />
  </SafeAreaView></View></GlanceProvider>;
}

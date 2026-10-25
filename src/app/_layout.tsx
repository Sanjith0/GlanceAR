import React from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { GlanceProvider } from '../state';
import { AppStoreProvider } from '../services/store';
import { Shell } from '../ui/Shell';
import { colors, s } from '../theme';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
    Fraunces_600SemiBold: require('@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'),
    Fraunces_500Medium: require('@expo-google-fonts/fraunces/500Medium/Fraunces_500Medium.ttf'),
    Fraunces_400Regular_Italic: require('@expo-google-fonts/fraunces/400Regular_Italic/Fraunces_400Regular_Italic.ttf'),
    Fraunces_600SemiBold_Italic: require('@expo-google-fonts/fraunces/600SemiBold_Italic/Fraunces_600SemiBold_Italic.ttf'),
  });
  if (!loaded && !error) return <View style={[s.shell, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={colors.ink} /></View>;
  return <GlanceProvider><AppStoreProvider><View style={s.shell}><SafeAreaView edges={['top', 'bottom']} style={s.app}>
    <StatusBar style="dark" />
    <Shell>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas }, animation: 'fade', animationDuration: 180 }} />
    </Shell>
  </SafeAreaView></View></AppStoreProvider></GlanceProvider>;
}

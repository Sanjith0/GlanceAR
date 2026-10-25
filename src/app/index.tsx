import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '../theme';
import { useSession } from '../services/session';

/** Signed-out people land on the welcome screen; everyone else on Events. */
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}><ActivityIndicator color={colors.ink} /></View>;
  if (status === 'signed-out') return <Redirect href="/welcome" />;
  if (status === 'needs-profile') return <Redirect href="/signup/face" />;
  return <Redirect href="/events" />;
}

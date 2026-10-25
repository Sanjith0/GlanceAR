import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { colors } from '../theme';
import { useSession } from './session';

/** Wraps signed-in screens: waits for the session, otherwise sends the person to welcome or to finish their profile. */
export function Protected({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}><ActivityIndicator color={colors.ink} /></View>;
  if (status === 'signed-out') return <Redirect href="/welcome" />;
  if (status === 'needs-profile') return <Redirect href="/signup/face" />;
  return <>{children}</>;
}

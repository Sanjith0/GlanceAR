import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
/** Invitation links land here and continue through the join flow, which keeps the code across signup or login. */
export default function InviteRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/join', params: { code: (code ?? '').toUpperCase() } }} />;
}

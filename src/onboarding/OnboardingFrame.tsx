import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { IconButton, Page, Steps, Wordmark } from '../components';
import { type } from '../theme';

export const SIGNUP_STEPS = ['Face scan', 'Details', 'Interests', 'Review'];
export const SIGNUP_ROUTES = ['/signup/face', '/signup/details', '/signup/interests', '/signup/review'] as const;

/**
 * Every signup step shares this scaffold: wordmark, a consistent back action,
 * visible progress, one headline and one primary action in the footer.
 */
export function OnboardingFrame({ step, title, lede, children, footer, testID }: {
  step: number; title: string; lede?: string; children: React.ReactNode; footer: React.ReactNode; testID?: string;
}) {
  const back = () => {
    if (step === 0) { if (router.canGoBack()) router.back(); else router.replace('/welcome'); return; }
    router.replace(SIGNUP_ROUTES[step - 1]);
  };
  return <Page footer={footer} testID={testID}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: -10 }}>
      <IconButton name="arrow-left" label="Back" onPress={back} />
      <Wordmark size={22} />
    </View>
    <Steps steps={SIGNUP_STEPS} current={step} />
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={type.display}>{title}</Text>
      {lede && <Text style={type.secondary}>{lede}</Text>}
    </View>
    {children}
  </Page>;
}

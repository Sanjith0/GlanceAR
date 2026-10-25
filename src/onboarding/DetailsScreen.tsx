import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Field } from '../components';
import { OnboardingFrame } from './OnboardingFrame';
import { useAppStore } from '../services/store';

export function validateDetails(draft: { name: string; occupation: string; phone: string; email: string }) {
  const errors: { name?: string; occupation?: string; phone?: string; email?: string } = {};
  if (!draft.name.trim()) errors.name = 'Add the name people should remember you by.';
  if (!draft.occupation.trim()) errors.occupation = 'Say what you do, in your own words.';
  if (draft.phone.trim() && !/^[+\d][\d\s().-]{5,}$/.test(draft.phone.trim())) errors.phone = 'That doesn’t look like a phone number.';
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'That doesn’t look like an email address.';
  return errors;
}

/** Step 2: name and occupation are required; phone and email are visibly optional. */
export function DetailsScreen() {
  const { state, dispatch } = useAppStore();
  const draft = state.draft;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = validateDetails(draft);
  const show = (key: keyof typeof errors) => (submitted || touched[key]) ? errors[key] : undefined;
  const set = (patch: Partial<typeof draft>) => dispatch({ type: 'draft', patch });
  const next = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    router.push('/signup/interests');
  };
  return <OnboardingFrame step={1} title="How should people find you?" testID="signup-details"
    lede="Your name and what you do are how someone introduces you. Contact details stay private until you choose to share them."
    footer={<Button testID="details-continue" onPress={next} icon="arrow-right">Continue</Button>}>
    <View style={{ gap: 18 }}>
      <Field label="Name" testID="details-name" value={draft.name} onChangeText={name => set({ name })} onBlur={() => setTouched(t => ({ ...t, name: true }))}
        autoComplete="name" maxLength={80} placeholder="Your name" error={show('name')} />
      <Field label="What do you do?" testID="details-occupation" value={draft.occupation} onChangeText={occupation => set({ occupation })} onBlur={() => setTouched(t => ({ ...t, occupation: true }))}
        maxLength={120} placeholder="Student, founder, nurse, ceramicist…" error={show('occupation')}
        hint="Whatever you’d say at a party. It becomes your one-line introduction." />
      <Field label="Phone number" optional testID="details-phone" value={draft.phone} onChangeText={phone => set({ phone })} onBlur={() => setTouched(t => ({ ...t, phone: true }))}
        keyboardType="phone-pad" autoComplete="tel" maxLength={24} placeholder="Shared only when you connect" error={show('phone')} />
      <Field label="Email address" optional testID="details-email" value={draft.email} onChangeText={email => set({ email })} onBlur={() => setTouched(t => ({ ...t, email: true }))}
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={120} placeholder="Shared only when you connect" error={show('email')} />
    </View>
  </OnboardingFrame>;
}

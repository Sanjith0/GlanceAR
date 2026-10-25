import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Notice, SampleTag } from '../components';
import { type } from '../theme';
import { OnboardingFrame, SIGNUP_ROUTES } from './OnboardingFrame';
import { PersonCard } from '../ui/PersonCard';
import { useAppStore } from '../services/store';
import { useAuth, splitFacts } from '../services/session';
import { pickPortrait } from '../services/portrait';
import { useDemoMode } from '../services/demoMode';
import { validateDetails } from './DetailsScreen';

/** Step 4: exactly how the person will appear to other attendees, with a way back to every step. */
export function ReviewScreen() {
  const { state, dispatch } = useAppStore();
  const { signUp } = useAuth();
  const demo = useDemoMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = state.draft;
  const enrollment = state.enrollment.result ?? null;
  const portrait = draft.portraitUrl || enrollment?.portraitUrl || '';
  const problems = validateDetails(draft);
  const preview = {
    id: 'preview', name: draft.name.trim() || 'Your name', role: draft.occupation.trim(), photoUrl: portrait,
    occupation: draft.occupation.trim(), interests: draft.interests, facts: splitFacts(draft.facts),
  };
  const finish = async () => {
    setError('');
    if (Object.keys(problems).length) { router.replace('/signup/details'); return; }
    setBusy(true);
    try { await signUp(draft, enrollment); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not finish signup. Try again.'); }
    finally { setBusy(false); }
  };
  const replacePortrait = async () => {
    setError('');
    try { const value = await pickPortrait(); if (value) dispatch({ type: 'draft', patch: { portraitUrl: value } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not use that photo.'); }
  };
  return <OnboardingFrame step={3} title="This is how you’ll appear." testID="signup-review"
    lede="Attendees at your events see this card. Change anything before you finish."
    footer={<>
      {error ? <Notice error icon="alert-circle">{error}</Notice> : null}
      <Button testID="review-finish" busy={busy} icon="check" onPress={() => void finish()}>Finish and enter Glance</Button>
    </>}>
    <PersonCard person={preview} caption={demo && enrollment?.sample && portrait === enrollment.portraitUrl ? 'Sample portrait from the sample scan' : undefined} />
    {demo && enrollment?.sample && <SampleTag>Sample scan on file</SampleTag>}
    <View style={{ gap: 8 }}>
      <Text style={type.label}>Change something</Text>
      {[
        { label: 'Face scan', value: enrollment ? 'Saved' : 'Not set up', route: SIGNUP_ROUTES[0] },
        { label: 'Name and what you do', value: `${draft.name.trim() || '—'} · ${draft.occupation.trim() || '—'}`, route: SIGNUP_ROUTES[1] },
        { label: 'Contact details', value: [draft.phone.trim(), draft.email.trim()].filter(Boolean).join(' · ') || 'None, that’s fine', route: SIGNUP_ROUTES[1] },
        { label: 'Interests and facts', value: draft.interests.length || draft.facts.trim() ? `${draft.interests.length} interests` : 'Nothing yet', route: SIGNUP_ROUTES[2] },
      ].map(item => <Button key={item.label} tone="ghost" size="sm" align="start" icon="edit-2" accessibilityLabel={`Edit ${item.label}`}
        onPress={() => router.replace(item.route)}>{`${item.label}: ${item.value}`}</Button>)}
      <Button tone="ghost" size="sm" align="start" icon="image" onPress={() => void replacePortrait()}>{portrait ? 'Replace portrait' : 'Add a portrait'}</Button>
    </View>
  </OnboardingFrame>;
}

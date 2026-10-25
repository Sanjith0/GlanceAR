import React from 'react';
import { router } from 'expo-router';
import { Button } from '../components';
import { OnboardingFrame } from './OnboardingFrame';
import { InterestsEditor } from './InterestsEditor';
import { useAppStore } from '../services/store';

/** Step 3: reveal something human. Everything here is optional. */
export function InterestsScreen() {
  const { state, dispatch } = useAppStore();
  return <OnboardingFrame step={2} title="Something human." testID="signup-interests"
    lede="Your work introduces you. What you’re into is what people remember."
    footer={<>
      <Button testID="interests-continue" icon="arrow-right" onPress={() => router.push('/signup/review')}>Continue</Button>
      {!state.draft.interests.length && !state.draft.facts.trim() && <Button tone="quiet" size="sm" onPress={() => router.push('/signup/review')}>Skip for now</Button>}
    </>}>
    <InterestsEditor draft={state.draft} onChange={patch => dispatch({ type: 'draft', patch })} />
  </OnboardingFrame>;
}

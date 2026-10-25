import { useCallback } from 'react';
import { router } from 'expo-router';
import { useGlance } from '../state';
import { useAppStore } from './store';
import type { FaceEnrollmentResult, ProfileDraft } from './contracts';

export type SessionStatus = 'loading' | 'signed-out' | 'needs-profile' | 'signed-in';

/**
 * Who is here. In the preview, signing in is a local flag over the sample
 * account; against a backend the device credential decides, and `needs-profile`
 * means the credential exists but no profile has been registered yet.
 */
export function useSession(): { status: SessionStatus } {
  const { mode, loading, snapshot, needsEnrollment, error } = useGlance();
  const { state } = useAppStore();
  if (mode === 'demo') return { status: state.auth === 'signed-in' ? 'signed-in' : 'signed-out' };
  if (needsEnrollment) return { status: state.auth === 'signed-in' ? 'needs-profile' : 'signed-out' };
  if (!snapshot) return { status: loading || !error ? 'loading' : 'signed-out' };
  return { status: 'signed-in' };
}

export function splitFacts(text: string): string[] {
  return text.split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 6);
}

/** Simulated authentication adapter plus the hand-off that finishes signup. */
export function useAuth() {
  const app = useGlance();
  const { state, dispatch } = useAppStore();
  const { mode, snapshot, demo } = app;

  const continueAfterAuth = useCallback(() => {
    const code = state.intendedInvite;
    dispatch({ type: 'intendedInvite', code: undefined });
    if (code) router.replace({ pathname: '/join', params: { code } });
    else router.replace('/events');
  }, [state.intendedInvite, dispatch]);

  const signIn = useCallback(async () => {
    // Preview only: the sample account is already registered. The production
    // path keeps the device credential from `session.ts` and needs no form.
    dispatch({ type: 'auth', auth: 'signed-in' });
    continueAfterAuth();
  }, [dispatch, continueAfterAuth]);

  const signOut = useCallback(async () => {
    dispatch({ type: 'auth', auth: 'signed-out' });
    dispatch({ type: 'resetDraft' });
    router.replace('/welcome');
  }, [dispatch]);

  const signUp = useCallback(async (draft: ProfileDraft, enrollment: FaceEnrollmentResult | null) => {
    const name = draft.name.trim(), role = draft.occupation.trim();
    const photoUrl = draft.portraitUrl || enrollment?.portraitUrl || '';
    if (mode === 'demo') {
      const id = snapshot?.me.id ?? 'alex';
      demo({ type: 'profile', profile: { id, name, role, photoUrl } });
      dispatch({ type: 'details', id, patch: { occupation: role, interests: draft.interests, facts: splitFacts(draft.facts), phone: draft.phone.trim(), email: draft.email.trim() } });
    } else {
      await app.saveProfile({ name, role, photoUrl });
      // Interests, facts and contact details are not in the backend profile yet; keep them locally until the schema grows.
      const id = app.snapshot?.me.id;
      if (id) dispatch({ type: 'details', id, patch: { occupation: role, interests: draft.interests, facts: splitFacts(draft.facts), phone: draft.phone.trim(), email: draft.email.trim() } });
    }
    dispatch({ type: 'enrollment', enrollment: enrollment ? { status: 'enrolled', enrolledAt: enrollment.capturedAt, sample: enrollment.sample, result: enrollment } : { status: 'none', sample: false } });
    dispatch({ type: 'auth', auth: 'signed-in' });
    continueAfterAuth();
  }, [mode, snapshot?.me.id, demo, dispatch, app, continueAfterAuth]);

  return { signIn, signOut, signUp, continueAfterAuth };
}

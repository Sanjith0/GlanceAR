import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Field, Notice, Page, Portrait } from '../components';
import { s, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { useMe } from '../services/views';
import { splitFacts } from '../services/session';
import { pickPortrait } from '../services/portrait';
import { validateDetails } from '../onboarding/DetailsScreen';
import { InterestsEditor } from '../onboarding/InterestsEditor';
import type { ProfileDraft } from '../services/contracts';

/** Edit the attendee card: the same fields as signup, saved through the existing profile contract. */
export function EditProfile() {
  const app = useGlance();
  const me = useMe();
  const { dispatch } = useAppStore();
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    name: me?.name ?? '', occupation: me?.occupation ?? '', phone: me?.phone ?? '', email: me?.email ?? '',
    interests: me?.interests ?? [], facts: (me?.facts ?? []).join('\n'), portraitUrl: me?.photoUrl ?? '',
  }));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errors = validateDetails(draft);
  const set = (patch: Partial<ProfileDraft>) => setDraft(d => ({ ...d, ...patch }));
  if (!me) return null;
  const save = async () => {
    setSubmitted(true); setError('');
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const profile = { name: draft.name.trim(), role: draft.occupation.trim(), photoUrl: draft.portraitUrl };
      if (app.mode === 'demo') app.demo({ type: 'profile', profile: { id: me.id, ...profile } });
      else await app.saveProfile(profile);
      dispatch({ type: 'details', id: me.id, patch: { occupation: profile.role, interests: draft.interests, facts: splitFacts(draft.facts), phone: draft.phone.trim(), email: draft.email.trim() } });
      if (router.canGoBack()) router.back(); else router.replace('/profile');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); }
    finally { setBusy(false); }
  };
  return <Page back title="Edit profile" fallback="/profile" testID="edit-profile"
    footer={<>{error ? <Notice error icon="alert-circle">{error}</Notice> : null}<Button busy={busy} icon="check" testID="edit-save" onPress={() => void save()}>Save changes</Button></>}>
    <View style={[s.row, { gap: 16 }]}>
      <Portrait person={{ name: draft.name || me.name, photoUrl: draft.portraitUrl }} size={80} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={type.small}>Your portrait helps people remember you. It’s never used for recognition.</Text>
        <Button tone="ghost" size="sm" icon="image" onPress={() => void pickPortrait().then(value => value && set({ portraitUrl: value })).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not use that photo.'))}>Replace portrait</Button>
      </View>
    </View>
    <Field label="Name" value={draft.name} onChangeText={name => set({ name })} maxLength={80} error={submitted ? errors.name : undefined} testID="edit-name" />
    <Field label="What do you do?" value={draft.occupation} onChangeText={occupation => set({ occupation })} maxLength={120} error={submitted ? errors.occupation : undefined} testID="edit-occupation" />
    <Field label="Phone number" optional value={draft.phone} onChangeText={phone => set({ phone })} keyboardType="phone-pad" maxLength={24} error={submitted ? errors.phone : undefined} />
    <Field label="Email address" optional value={draft.email} onChangeText={email => set({ email })} keyboardType="email-address" autoCapitalize="none" maxLength={120} error={submitted ? errors.email : undefined} />
    <InterestsEditor draft={draft} onChange={set} />
  </Page>;
}

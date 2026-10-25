import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Chip, Field, Icon, useIsDesktop } from '../components';
import { colors, fonts, type } from '../theme';
import { LinkedInSheet } from './LinkedInSheet';
import type { ProfileDraft } from '../services/contracts';

const IDEAS = ['Trail running', 'Ceramics', 'Film photography', 'Cooking', 'Climbing', 'Typography', 'Jazz on vinyl', 'Board games', 'Gardening', 'Cycling', 'Sci-fi', 'Woodworking'];

/**
 * Interests and extra facts, shared by signup and profile editing. Freeform
 * writing comes first; chips are an optional, editable summary. The LinkedIn
 * shortcut sits beside the heading on wide screens and under it on phones.
 */
export function InterestsEditor({ draft, onChange, showLinkedIn = true }: {
  draft: ProfileDraft; onChange: (patch: Partial<ProfileDraft>) => void; showLinkedIn?: boolean;
}) {
  const desktop = useIsDesktop();
  const [pending, setPending] = useState('');
  const [linkedIn, setLinkedIn] = useState(false);
  const add = (value: string) => {
    const clean = value.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    if (draft.interests.some(i => i.toLowerCase() === clean.toLowerCase())) { setPending(''); return; }
    onChange({ interests: [...draft.interests, clean].slice(0, 12) });
    setPending('');
  };
  const remove = (value: string) => onChange({ interests: draft.interests.filter(i => i !== value) });
  const ideas = IDEAS.filter(idea => !draft.interests.some(i => i.toLowerCase() === idea.toLowerCase())).slice(0, 6);
  const importButton = showLinkedIn && <Button tone="ghost" size="sm" icon="download" testID="linkedin-open" onPress={() => setLinkedIn(true)}>Import from LinkedIn</Button>;

  return <View style={{ gap: 22 }}>
    <View style={{ gap: 10 }}>
      <View style={[desktop && { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }]}>
        <Text style={[type.heading, { flexShrink: 1 }]}>Outside work, I’m into…</Text>
        {desktop && importButton}
      </View>
      {!desktop && importButton && <View style={{ alignSelf: 'flex-start' }}>{importButton}</View>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {draft.interests.map(interest => <Chip key={interest} selected onRemove={() => remove(interest)}>{interest}</Chip>)}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 180, flexGrow: 1 }}>
          <TextInput value={pending} onChangeText={setPending} onSubmitEditing={() => add(pending)} blurOnSubmit={false} returnKeyType="done"
            accessibilityLabel="Add an interest" placeholder={draft.interests.length ? 'Add another' : 'Type an interest and press enter'} placeholderTextColor={colors.faint}
            maxLength={40} testID="interest-input" style={{ flex: 1, minHeight: 40, borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14,
              fontFamily: fonts.body, fontSize: 14, color: colors.ink, backgroundColor: colors.paper }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add interest" disabled={!pending.trim()} onPress={() => add(pending)} testID="interest-add"
            style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, backgroundColor: pending.trim() ? colors.ink : colors.creamDeep, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
            <Icon name="plus" size={18} color={pending.trim() ? colors.cream : colors.faint} />
          </Pressable>
        </View>
      </View>
      {ideas.length > 0 && <View style={{ gap: 8 }}>
        <Text style={type.small}>Or tap one</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{ideas.map(idea => <Chip key={idea} onPress={() => add(idea)}>{idea}</Chip>)}</View>
      </View>}
    </View>
    <Field label="Ask me about…" multiline testID="facts-input" value={draft.facts} onChangeText={facts => onChange({ facts })} maxLength={600}
      placeholder={'A project, a place, a strong opinion. One per line.\nAsk me about the kiln I built from scrap.'}
      hint="This is what makes you memorable. Two lines are plenty." />
    {linkedIn && <LinkedInSheet open={linkedIn} onClose={() => setLinkedIn(false)} draft={draft} onMerge={patch => {
      const interests = [...draft.interests];
      for (const interest of patch.interests) if (!interests.some(i => i.toLowerCase() === interest.toLowerCase())) interests.push(interest);
      const facts = [draft.facts.trim(), ...patch.facts].filter(Boolean).join('\n');
      onChange({ interests: interests.slice(0, 12), facts, ...(patch.occupation ? { occupation: patch.occupation } : {}) });
    }} />}
  </View>;
}

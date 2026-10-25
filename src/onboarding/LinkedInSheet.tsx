import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Button, Icon, Notice, SampleTag } from '../components';
import { colors, type } from '../theme';
import { Sheet } from '../ui/Sheet';
import type { LinkedInImport, ProfileDraft } from '../services/contracts';
import { useAdapters } from '../services/views';
import { useDemoMode } from '../services/demoMode';

type Phase = { kind: 'loading' } | { kind: 'review'; result: LinkedInImport } | { kind: 'error'; message: string };

function Check({ checked, label, detail, onPress, testID }: { checked: boolean; label: string; detail?: string; onPress: () => void; testID?: string }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} testID={testID}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, minHeight: 44 }, pressed && { opacity: 0.7 }]}>
    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? colors.ink : colors.lineStrong, backgroundColor: checked ? colors.ink : colors.paper, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
      {checked && <Icon name="check" size={14} color={colors.cream} />}
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.body}>{label}</Text>
      {detail && <Text style={type.small}>{detail}</Text>}
    </View>
  </Pressable>;
}

/**
 * The optional LinkedIn shortcut. Results are a labelled sample; the person
 * chooses what to keep and manual entries are only replaced on request.
 */
export function LinkedInSheet({ open, onClose, draft, onMerge }: {
  open: boolean; onClose: () => void; draft: ProfileDraft;
  onMerge: (patch: { occupation?: string; interests: string[]; facts: string[] }) => void;
}) {
  const { linkedIn } = useAdapters();
  const demo = useDemoMode();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [useOccupation, setUseOccupation] = useState(false);
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [facts, setFacts] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    linkedIn.importProfile().then(result => {
      if (cancelled) return;
      const existing = new Set(draft.interests.map(i => i.toLowerCase()));
      setInterests(new Set(result.interests.filter(i => !existing.has(i.toLowerCase()))));
      setFacts(new Set(result.facts.filter(f => !draft.facts.includes(f))));
      setUseOccupation(!draft.occupation.trim() && Boolean(result.occupation));
      setPhase({ kind: 'review', result });
    }).catch((error: unknown) => { if (!cancelled) setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'LinkedIn import failed.' }); });
    return () => { cancelled = true; };
    // Re-run only when the sheet opens or the person retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt, linkedIn]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => set(old => { const next = new Set(old); if (next.has(value)) next.delete(value); else next.add(value); return next; });
  const result = phase.kind === 'review' ? phase.result : null;
  const nothing = result && !result.occupation && !result.interests.length && !result.facts.length;
  const selected = interests.size + facts.size + (useOccupation ? 1 : 0);

  return <Sheet open={open} onClose={onClose} title="Import from LinkedIn" testID="linkedin-sheet"
    footer={result && !nothing ? <>
      <Button testID="linkedin-merge" disabled={!selected} icon="plus" onPress={() => {
        onMerge({ occupation: useOccupation ? result.occupation : undefined, interests: [...interests], facts: [...facts] });
        onClose();
      }}>{selected ? `Add ${selected} to my profile` : 'Choose what to keep'}</Button>
      <Button tone="quiet" size="sm" onPress={onClose}>Skip</Button>
    </> : undefined}>
    {phase.kind === 'loading' && <View style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
      <ActivityIndicator color={colors.ink} />
      <Text style={type.secondary}>Looking up your public profile…</Text>
    </View>}
    {phase.kind === 'error' && <View style={{ gap: 14 }}>
      <Notice error icon="alert-circle">{phase.message}</Notice>
      <Button tone="secondary" icon="rotate-ccw" onPress={() => { setPhase({ kind: 'loading' }); setAttempt(n => n + 1); }}>Try again</Button>
      <Button tone="quiet" size="sm" onPress={onClose}>Continue without importing</Button>
    </View>}
    {result && nothing && <View style={{ gap: 14 }}>
      <Notice icon="info">We couldn’t find anything public to import. Your own words work better anyway.</Notice>
      <Button tone="secondary" onPress={onClose}>Back to interests</Button>
    </View>}
    {result && !nothing && <View style={{ gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {demo && result.sample ? <SampleTag>Sample results</SampleTag> : null}
        <Text style={type.small}>Choose what to keep. Nothing replaces what you typed unless you say so.</Text>
      </View>
      {result.occupation ? <View style={{ gap: 4 }}>
        <Text style={type.label}>Headline</Text>
        <Check checked={useOccupation} onPress={() => setUseOccupation(v => !v)} testID="linkedin-occupation"
          label={result.occupation} detail={draft.occupation.trim() ? `Replaces “${draft.occupation.trim()}”` : 'Use as what you do'} />
      </View> : null}
      {result.interests.length > 0 && <View style={{ gap: 4 }}>
        <Text style={type.label}>Interests</Text>
        {result.interests.map(interest => <Check key={interest} checked={interests.has(interest)} onPress={() => toggle(setInterests, interest)}
          label={interest} detail={draft.interests.some(i => i.toLowerCase() === interest.toLowerCase()) ? 'Already on your profile' : undefined} />)}
      </View>}
      {result.facts.length > 0 && <View style={{ gap: 4 }}>
        <Text style={type.label}>Extra facts</Text>
        {result.facts.map(fact => <Check key={fact} checked={facts.has(fact)} onPress={() => toggle(setFacts, fact)} label={fact} />)}
      </View>}
    </View>}
  </Sheet>;
}

import React from 'react';
import { Text, View } from 'react-native';
import { Button, Chip, Icon, Tag } from '../components';
import { colors, radius, type } from '../theme';
import { Sheet } from './Sheet';
import { PersonCard } from './PersonCard';
import type { Suggestion } from '../services/contracts';

/**
 * The readable detail sheet behind a recognized or suggested person: who they
 * are, what you share, what to say first. Bookmarking is private; starting a
 * conversation is a separate, explicit action the caller controls.
 */
export function PersonSheet({ suggestion, open, onClose, bookmarked, onToggleBookmark, metBefore, primary }: {
  suggestion: Suggestion | null; open: boolean; onClose: () => void; bookmarked: boolean; onToggleBookmark: () => void;
  metBefore?: string; primary?: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; hint?: string };
}) {
  if (!suggestion) return null;
  const { person } = suggestion;
  const first = person.name.split(' ')[0];
  return <Sheet open={open} onClose={onClose} title={person.name} testID="person-sheet"
    footer={<>
      {primary && <Button busy={primary.busy} disabled={primary.disabled} icon="message-circle" testID="person-primary" onPress={primary.onPress}>{primary.label}</Button>}
      {primary?.hint && <Text style={[type.small, { textAlign: 'center' }]}>{primary.hint}</Text>}
      <Button tone={bookmarked ? 'secondary' : 'ghost'} icon={bookmarked ? 'bookmark' : 'bookmark'} testID="person-bookmark" onPress={onToggleBookmark}>
        {bookmarked ? 'Saved to remember' : 'Save to remember'}
      </Button>
    </>}>
    <PersonCard person={person} compact caption={metBefore} />
    <View style={{ gap: 8 }}>
      <Text style={type.label}>Why {first}</Text>
      {suggestion.professional.map(line => <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="briefcase" size={15} color={colors.muted} /><Text style={[type.body, { flex: 1 }]}>{line}</Text></View>)}
      {suggestion.personal.map(line => <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="heart" size={15} color={colors.muted} /><Text style={[type.body, { flex: 1 }]}>{line}</Text></View>)}
      {suggestion.shared.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>{suggestion.shared.map(i => <Chip key={i} selected>{i}</Chip>)}</View>}
    </View>
    <View style={{ gap: 8 }}>
      <Text style={type.label}>Something to say</Text>
      {suggestion.starters.map(line => <View key={line} style={{ backgroundColor: colors.paper, borderRadius: radius.md, padding: 14 }}>
        <Text style={type.quote}>{line}</Text>
      </View>)}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Tag tone="neutral">{person.glanceEnabled ? 'Glance on' : 'Glance off'}</Tag>
      <Text style={[type.small, { flex: 1 }]}>{person.glanceEnabled ? 'Can recognize you and be recognized at this event.' : 'Not recognizable here; you can still say hello.'}</Text>
    </View>
  </Sheet>;
}

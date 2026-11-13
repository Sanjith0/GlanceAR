import React from 'react';
import { Pressable, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { Icon, Portrait } from './components';
import { colors, fonts, s } from './theme';
import type { Profile } from './domain';
import { highlight, matchLabel, matchTone, type MatchTone } from './peopleCards';
import { commonTraits, talkingPoints } from './talkingPoints';

const firstName = (name: string) => name.split(' ')[0] ?? name;

/** Text with the things you have in common marked in light blue. */
export function Highlighted({ text, phrases, style }: { text: string; phrases: string[]; style?: StyleProp<TextStyle> }) {
  return <Text style={style}>
    {highlight(text, phrases).map((part, i) => part.hit
      ? <Text key={i} style={{ backgroundColor: colors.highlight, color: colors.ink, fontFamily: fonts.semibold }}>{part.text}</Text>
      : part.text)}
  </Text>;
}

/**
 * A small card for someone the glasses recognized: portrait, name, a few lines on
 * what to talk about with what you share highlighted, and an arrow to start the
 * conversation when they are not wearing glasses that look back at you.
 */
export function PersonCardView({ person, me, eventTitle, inView, remaining, canStart, starting, onStart }: {
  person: Profile;
  me: Pick<Profile, 'role'> | undefined;
  eventTitle?: string;
  /** Their face is in view right now. */
  inView: boolean;
  /** 1 while in view, draining to 0 as the card is about to go. */
  remaining: number;
  /** They have Glance on and nothing else is in progress. */
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  const traits = commonTraits(me, person);
  const lines = talkingPoints(me, person, eventTitle);
  const name = firstName(person.name);
  const enabled = inView && canStart && !starting;
  return <View testID={`person-card-${person.id}`} style={[s.card, { padding: 14, gap: 10, borderRadius: 16 }]}>
    <View style={[s.row, { alignItems: 'flex-start', gap: 12 }]}>
      <Portrait person={person} size={44} />
      <View style={[s.grow, { gap: 6 }]}>
        <View style={[s.row, { gap: 8 }]}>
          <Text style={[s.label, s.grow]} numberOfLines={1}>{person.name}</Text>
          {!inView && <Text style={s.small}>Out of view</Text>}
        </View>
        {lines.map(line => <View key={line} style={[s.row, { alignItems: 'flex-start', gap: 6 }]}>
          <Text style={[s.small, { color: colors.blue }]}>•</Text>
          <Highlighted text={line} phrases={traits} style={[s.body, s.grow, { fontSize: 13, lineHeight: 20 }]} />
        </View>)}
      </View>
      <Pressable testID={`start-conversation-${person.id}`} accessibilityRole="button"
        accessibilityLabel={`Start a conversation with ${name}`}
        accessibilityHint={enabled ? undefined : inView ? undefined : `Look at ${name} to start`}
        accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onStart}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
          backgroundColor: enabled ? colors.blue : colors.line }}>
        <Icon name="arrow-right" size={20} color={enabled ? colors.paper : colors.muted} />
      </Pressable>
    </View>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.line }}>
      <View style={{ height: 3, backgroundColor: inView ? colors.blue : colors.muted, width: `${Math.round(remaining * 100)}%` }} />
    </View>
  </View>;
}

const toneStyle: Record<MatchTone, { fg: string; bg: string }> = {
  strong: { fg: colors.green, bg: colors.greenLight },
  some: { fg: colors.orange, bg: colors.orangeLight },
  none: { fg: colors.danger, bg: colors.dangerLight },
};

/**
 * An attendee's name on the list, marked green (lots in common), orange (a few
 * things) or red (probably nothing), with the count in words so colour is never
 * the only signal. Plain when nobody has judged the two of you yet.
 */
export function MatchName({ person }: { person: Profile }) {
  const tone = matchTone(person);
  if (!tone) return <Text style={s.label}>{person.name}</Text>;
  const { fg, bg } = toneStyle[tone];
  return <View testID={`match-name-${person.id}`} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}
    accessibilityLabel={`${person.name}, ${matchLabel(person)}`}>
    <Text style={[s.label, { color: fg, backgroundColor: bg, paddingHorizontal: 8, borderRadius: 6, overflow: 'hidden' }]}>{person.name}</Text>
    <Text style={[s.small, { color: fg, fontFamily: fonts.semibold }]}>{matchLabel(person)}</Text>
  </View>;
}

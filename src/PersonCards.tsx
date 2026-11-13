import React, { useState } from 'react';
import { Pressable, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { Icon, Portrait } from './components';
import { colors, fonts, s } from './theme';
import type { Profile } from './domain';
import { highlight, matchLabel, matchTone, secondsLeft, type MatchTone } from './peopleCards';
import { CardOutline } from './CardOutline';
import { commonTraits, talkingPoints } from './talkingPoints';

const CARD_RADIUS = 20;

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
 * The card for someone the glasses recognized: portrait, name, a few lines on what to
 * talk about with what you share highlighted, and an arrow to start the conversation
 * when they are not wearing glasses that look back at you. A violet line runs around
 * the card while they are in view, then drains away over their last ten seconds.
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  const traits = commonTraits(me, person);
  const lines = talkingPoints(me, person, eventTitle);
  const name = firstName(person.name);
  const enabled = inView && canStart && !starting;
  const left = secondsLeft(remaining);
  return <View testID={`person-card-${person.id}`}
    onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    style={{ borderRadius: CARD_RADIUS, padding: 16, gap: 12, backgroundColor: inView ? colors.violetLight : colors.paper }}>
    <CardOutline width={size.width} height={size.height} radius={CARD_RADIUS} progress={inView ? 1 : remaining} active={inView} />
    <View style={[s.row, { alignItems: 'center', gap: 12 }]}>
      <View style={{ borderRadius: 18, borderWidth: 2, borderColor: inView ? colors.violet : colors.violetSoft, padding: 2 }}>
        <Portrait person={person} size={48} />
      </View>
      <View style={[s.grow, { gap: 3 }]}>
        <Text style={[s.heading, { fontSize: 18, lineHeight: 24 }]} numberOfLines={1}>{person.name}</Text>
        <View style={[s.row, { gap: 6 }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: inView ? colors.violet : colors.line }} />
          <Text testID={`person-card-status-${person.id}`} accessibilityLiveRegion="polite"
            style={{ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.9, color: inView ? colors.violetInk : colors.muted }}>
            {inView ? 'IN VIEW' : `OUT OF VIEW · ${left}s`}</Text>
        </View>
      </View>
      <Pressable testID={`start-conversation-${person.id}`} accessibilityRole="button"
        accessibilityLabel={`Start a conversation with ${name}`}
        accessibilityHint={enabled || !canStart ? undefined : `Look at ${name} to start`}
        accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onStart}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
          backgroundColor: enabled ? colors.violet : colors.line }}>
        <Icon name="arrow-right" size={20} color={enabled ? colors.paper : colors.muted} />
      </Pressable>
    </View>
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.9, color: colors.muted }}>TALK ABOUT</Text>
      {lines.map(line => <View key={line} style={[s.row, { alignItems: 'flex-start', gap: 8 }]}>
        <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: colors.violet }} />
        <Highlighted text={line} phrases={traits} style={[s.body, s.grow, { fontSize: 14, lineHeight: 21 }]} />
      </View>)}
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

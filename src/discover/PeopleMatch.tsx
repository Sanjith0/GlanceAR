import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon } from '../components';
import { colors, fonts, s } from '../theme';
import type { PeopleMatching, Profile } from '../domain';
import { matchPeople } from './api';
import { setUi } from './store';

/**
 * People matching on the Glance event page: for each person in the room who also
 * turned it on, the interests the two of you share and a question to open with.
 * Only phrases from your own list are ever shown; see src/discover/people.ts.
 */

const ASK_EVERY_MS = 20_000;
const asking = new Set<string>();
const asked = new Map<string, { at: number; failures: number }>();

/**
 * While the event page is in front and the server says Muse has not seen the
 * current interest lists, asks it to look. One request at a time per event, at
 * most every twenty seconds, backing off when the backend cannot be reached. The
 * answer arrives through the snapshot, so nothing is returned here.
 */
export function useAutoMatch(deploymentURL: string, token: string, eventId: string, wanted: boolean): void {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!wanted || !deploymentURL || !token || !eventId) return;
    const key = `${token}:${eventId}`;
    const last = asked.get(key);
    const wait = last ? Math.max(0, last.at + ASK_EVERY_MS * 2 ** Math.min(last.failures, 4) - Date.now()) : 0;
    const timer = setTimeout(() => {
      // Another request for this event is still out: look again once it has had time to land.
      if (asking.has(key)) { setRound(value => value + 1); return; }
      asking.add(key);
      matchPeople(deploymentURL, token, eventId).then(
        () => asked.set(key, { at: Date.now(), failures: 0 }),
        () => asked.set(key, { at: Date.now(), failures: (asked.get(key)?.failures ?? 0) + 1 }),
      ).finally(() => { asking.delete(key); setRound(value => value + 1); });
    }, asking.has(key) ? 5_000 : wait);
    return () => clearTimeout(timer);
  }, [wanted, deploymentURL, token, eventId, round]);
}

/** Most in common first; people with the same amount keep their order. */
export const byShared = <T extends Pick<Profile, 'shared'>>(people: T[]): T[] =>
  [...people].sort((a, b) => (b.shared?.length ?? 0) - (a.shared?.length ?? 0));

const openSignals = () => { setUi('events'); router.push('/profile'); };

function SourceTag({ matching, sample }: { matching: PeopleMatching; sample: boolean }) {
  const muse = matching.source === 'muse';
  return <View style={[s.badge, !muse && { backgroundColor: colors.canvas }]}>
    <Text testID="match-source" style={[s.badgeText, !muse && { color: colors.muted }]}>{muse ? 'MATCHED BY MUSE SPARK' : sample ? 'SAMPLE MATCH' : 'BASIC MATCH'}</Text></View>;
}

/** Sits under "People in the room": how the matches were found, or what is needed to see any. */
export function MatchStatus({ mine, matching, others, sample, refreshing, onRefresh }: {
  /** Your saved interests; undefined while people matching is off. */
  mine: string[] | undefined;
  matching: PeopleMatching | undefined;
  /** Other people in the room, as the snapshot returned them. */
  others: Profile[];
  sample: boolean;
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  if (mine === undefined) return <View testID="match-prompt" style={[s.soft, { gap: 10 }]}>
    <View style={s.row}><Icon name="zap" color={colors.blue} size={18} /><Text style={[s.label, s.grow]}>See what you have in common</Text></View>
    <Text style={s.small}>Turn on people matching in your signals and Glance shows the interests you share with people here who did the same, with a question to open on. Your full list is never shown to anyone.</Text>
    <Button tone="secondary" icon="sliders" testID="open-signals" onPress={openSignals}>Set up people matching</Button>
  </View>;
  const opted = others.filter(person => person.shared !== undefined);
  const hint = !mine.length ? 'People matching is on, but your list is empty. Add a few interests in your signals so there is something to match.'
    : !others.length ? ''
      : !opted.length ? 'Nobody else here has turned on people matching yet. What you share appears as soon as they do.'
        : !opted.some(person => person.shared?.length) ? 'Nothing on your list overlaps with anyone here yet.' : '';
  return <View testID="match-status" style={{ gap: 8 }}>
    <View style={s.between}>
      <View style={[s.row, { gap: 8, flexShrink: 1, flexWrap: 'wrap' }]}>
        {matching && <SourceTag matching={matching} sample={sample} />}
        <Pressable accessibilityRole="button" accessibilityLabel="Edit your signals" onPress={openSignals} hitSlop={8} style={{ minHeight: 28, justifyContent: 'center' }}>
          <Text style={[s.small, { color: colors.blue, fontFamily: fonts.semibold }]}>{mine.length} interest{mine.length === 1 ? '' : 's'} · Edit</Text></Pressable>
      </View>
      {onRefresh && <Pressable accessibilityRole="button" accessibilityLabel="Ask Muse Spark again" testID="refresh-matches" disabled={refreshing} onPress={onRefresh}
        style={{ width: 44, height: 44, marginRight: -12, marginVertical: -8, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="refresh-cw" size={18} color={refreshing ? colors.line : colors.muted} /></Pressable>}
    </View>
    {matching?.stale && !sample ? <Text testID="match-working" style={s.small}>Muse Spark is looking for what you share…</Text> : null}
    {matching?.notice ? <View style={[s.row, { alignItems: 'flex-start', gap: 8 }]}><View style={{ paddingTop: 2 }}><Icon name="info" size={14} color={colors.muted} /></View>
      <Text testID="match-notice" style={[s.small, s.grow]}>{matching.notice}</Text></View> : null}
    {sample ? <Text style={s.small}>Sample attendees with fictional interests, matched on wording on this device. With the backend, Muse Spark finds the overlap and writes the openers.</Text> : null}
    {hint ? <Text testID="match-hint" style={s.small}>{hint}</Text> : null}
  </View>;
}

/** Inside one person's card: what the two of you share, in your own words, and a way in. */
export function SharedWith({ person }: { person: Profile }) {
  // Undefined: one of you has matching off, so there is nothing to say. Empty: you both do, with no overlap.
  if (!person.shared) return null;
  if (!person.shared.length) return <Text testID={`shared-${person.id}`} style={s.small}>Nothing in common on your lists yet.</Text>;
  return <View testID={`shared-${person.id}`} accessibilityLabel={`You and ${person.name.split(' ')[0]} are both into ${person.shared.join(', ')}`} style={{ gap: 9 }}>
    <Text style={[s.eyebrow, { color: colors.blue, letterSpacing: 0.7, lineHeight: 16 }]}>YOU’RE BOTH INTO</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {person.shared.map(phrase => <View key={phrase} style={{ borderRadius: 999, backgroundColor: colors.blueLight, paddingHorizontal: 11, paddingVertical: 5 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink }}>{phrase}</Text></View>)}
    </View>
    {person.opener ? <View style={[s.row, { alignItems: 'flex-start', gap: 8 }]}>
      <View style={{ paddingTop: 3 }}><Icon name="message-circle" size={15} color={colors.blue} /></View>
      <Text testID={`opener-${person.id}`} style={[s.body, s.grow, { fontSize: 14, lineHeight: 21 }]}>{person.opener}</Text></View> : null}
  </View>;
}

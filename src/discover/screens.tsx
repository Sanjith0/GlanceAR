import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button, Empty, Icon, Page, Portrait } from '../components';
import { colors, fonts, s } from '../theme';
import { deploymentURL, useGlance } from '../state';
import { GlobalStatus, useOperation, useScreenFocused } from '../screens';
import {
  DISCOVER_AREA, DISCOVER_CATEGORIES, SAMPLE_SIGNALS, discoverEvent, eventWhen, splitInterests, upcoming,
  type DiscoverCategory, type DiscoverEvent, type DiscoverPick,
} from './catalog';
import { rankForSession, rankKey, readScreenshot, type DiscoverSession } from './api';
import { ModeSwitch, eventsBlue, eventsBlueLight } from './ModeSwitch';
import { addInterests, clearSignals, getDiscover, removeInterest, setDiscover, toggleRsvp, useDiscover } from './store';

/**
 * The Events face of the app: a Luma/Partiful-style Discover page whose picks are
 * ranked by Meta's Muse Spark from signals the person chooses to share. The
 * catalog is sample data and every non-Muse ranking is labelled as a basic match.
 */

function useSession(): DiscoverSession {
  const { mode, snapshot, token } = useGlance();
  const registered = Boolean(snapshot), intro = snapshot?.me.role ?? '';
  return useMemo(() => ({
    muse: mode === 'demo' ? 'sample' : registered ? 'ready' : 'no-profile', deploymentURL, token, intro,
  }), [mode, registered, token, intro]);
}
const gradient = (event: DiscoverEvent) => ({
  backgroundColor: event.cover.from,
  backgroundImage: `linear-gradient(135deg, ${event.cover.from} 0%, ${event.cover.to} 100%)`,
});
const eyebrow = [s.eyebrow, { color: eventsBlue, letterSpacing: 0.6, lineHeight: 17 }];

function Tag({ children, tone = 'blue' }: { children: string; tone?: 'blue' | 'gray' | 'green' }) {
  const [background, color] = tone === 'gray' ? [colors.canvas, colors.muted] : tone === 'green' ? [colors.greenLight, colors.green] : [eventsBlueLight, eventsBlue];
  return <View style={[s.badge, { backgroundColor: background }]}><Text style={[s.badgeText, { color }]}>{children}</Text></View>;
}
function Cover({ event, height, radius = 0, children }: { event: DiscoverEvent; height: number; radius?: number; children?: React.ReactNode }) {
  return <View style={[gradient(event), { height, borderRadius: radius, overflow: 'hidden', padding: 12 }]}>
    <View style={{ position: 'absolute', right: -height * 0.3, bottom: -height * 0.45, width: height * 1.2, height: height * 1.2, borderRadius: height, backgroundColor: 'rgba(255,255,255,0.14)' }} />
    <View style={{ position: 'absolute', right: 16, bottom: 14 }}><Icon name={event.cover.icon} size={Math.round(height * 0.34)} color="rgba(255,255,255,0.94)" /></View>
    {children}
  </View>;
}
function Thumb({ event }: { event: DiscoverEvent }) {
  return <View style={[gradient(event), { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]}>
    <Icon name={event.cover.icon} size={28} color="rgba(255,255,255,0.94)" /></View>;
}
function EventsHeader() {
  const app = useGlance();
  return <View style={s.between}>
    <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, color: eventsBlue, fontSize: 25, letterSpacing: -1.1 }}>events</Text>
    <ModeSwitch />
    <Pressable accessibilityRole="button" accessibilityLabel="Open your signals" onPress={() => router.push('/profile')}>
      {app.snapshot ? <Portrait person={app.snapshot.me} size={40} /> : <Icon name="user" />}</Pressable>
  </View>;
}
function EventRow({ event, picked = false }: { event: DiscoverEvent; picked?: boolean }) {
  const rsvp = useDiscover().rsvps[event.id];
  return <Pressable testID={`event-${event.id}`} accessibilityRole="button"
    accessibilityLabel={`${event.title}. ${eventWhen(event)}, ${event.venue}`}
    onPress={() => router.push(`/discover/${event.id}`)} style={({ pressed }) => [s.row, { gap: 14 }, pressed && s.pressed]}>
    <Thumb event={event} />
    <View style={[s.grow, { gap: 2 }]}>
      <Text style={eyebrow}>{eventWhen(event).toUpperCase()}</Text>
      <Text numberOfLines={2} style={[s.label, { fontSize: 15 }]}>{event.title}</Text>
      <Text numberOfLines={1} style={s.small}>{event.venue} · {event.going + (rsvp === 'going' ? 1 : 0)} going · {event.price}</Text>
    </View>
    {rsvp ? <Tag tone={rsvp === 'going' ? 'green' : 'gray'}>{rsvp === 'going' ? 'GOING' : 'SAVED'}</Tag>
      : picked ? <Tag>FOR YOU</Tag> : <Icon name="chevron-right" color={colors.muted} size={18} />}
  </Pressable>;
}
function PickCard({ event, pick }: { event: DiscoverEvent; pick: DiscoverPick }) {
  return <Pressable testID={`pick-${event.id}`} accessibilityRole="button"
    accessibilityLabel={`${event.title}. ${pick.score} percent match. ${pick.reason}`}
    onPress={() => router.push(`/discover/${event.id}`)}
    style={({ pressed }) => [{ width: 268, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, overflow: 'hidden' }, pressed && s.pressed]}>
    <Cover event={event} height={128}>
      <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.ink }}>{pick.score}% match</Text></View>
    </Cover>
    <View style={{ padding: 16, gap: 6 }}>
      <Text style={eyebrow}>{eventWhen(event).toUpperCase()}</Text>
      <Text numberOfLines={2} style={[s.label, { fontSize: 16, lineHeight: 22, minHeight: 44 }]}>{event.title}</Text>
      <Text numberOfLines={1} style={s.small}>{event.venue} · {event.area}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: eventsBlueLight, minHeight: 74 }}>
        <View style={{ paddingTop: 2 }}><Icon name="zap" size={14} color={eventsBlue} /></View>
        <Text numberOfLines={3} style={[s.small, s.grow, { color: colors.ink }]}>{pick.reason}</Text>
      </View>
    </View>
  </Pressable>;
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={`Show ${label} events`} aria-checked={selected}
    onPress={onPress} hitSlop={4} style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 15, borderRadius: 999, justifyContent: 'center',
      borderWidth: 1, borderColor: selected ? eventsBlue : colors.line, backgroundColor: selected ? eventsBlue : colors.paper }, pressed && s.pressed]}>
    <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: selected ? colors.paper : colors.ink }}>{label}</Text>
  </Pressable>;
}
const searchable = (event: DiscoverEvent) =>
  `${event.title} ${event.venue} ${event.area} ${event.host} ${event.category} ${event.tags.join(' ')}`.toLowerCase();

export function DiscoverScreen() {
  const d = useDiscover(), session = useSession(), focused = useScreenFocused();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<DiscoverCategory | 'All'>('All');
  const all = useMemo(() => upcoming(), []);
  const key = rankKey(session, d);
  const hasSignals = d.interests.length > 0 || (d.useIntro && session.intro.trim().length > 0);
  const { ranking, recsKey } = d;
  // Rank when this screen is in front and the signals changed, never while they are being edited elsewhere.
  useEffect(() => {
    if (focused && hasSignals && !ranking && recsKey !== key) void rankForSession(session);
  }, [focused, hasSignals, ranking, recsKey, key, session]);

  const needle = query.trim().toLowerCase();
  const visible = all.filter(event => (category === 'All' || event.category === category) && (!needle || searchable(event).includes(needle)));
  const current = hasSignals && recsKey === key ? d.recs : null;
  const picks = (current?.picks ?? []).flatMap(pick => {
    const event = visible.find(e => e.id === pick.eventId);
    return event ? [{ pick, event }] : [];
  });
  const picked = new Set((current?.picks ?? []).map(pick => pick.eventId));
  const waiting = hasSignals && !current;
  return <Page>
    <EventsHeader />
    <View style={{ gap: 10, paddingTop: 12 }}>
      <Text style={[s.title, { fontSize: 34, lineHeight: 40, letterSpacing: -1.3 }]}>Find your people{'\n'}this week.</Text>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}><Tag tone="gray">SAMPLE EVENTS</Tag><Text style={s.small}>{DISCOVER_AREA} · concept demo</Text></View>
    </View>
    <GlobalStatus />
    <View style={[s.row, s.input, { paddingVertical: 0, gap: 10 }]}>
      <Icon name="search" size={18} color={colors.muted} />
      <TextInput accessibilityLabel="Search events" value={query} onChangeText={setQuery} placeholder="Search events, places or interests"
        placeholderTextColor={colors.muted} autoCorrect={false} style={[s.grow, { minHeight: 50, color: colors.ink, fontFamily: fonts.body, fontSize: 15 }]} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={10}><Icon name="x" size={18} color={colors.muted} /></Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 24 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Filter by category" style={{ flexDirection: 'row', gap: 8 }}>
        {(['All', ...DISCOVER_CATEGORIES] as const).map(name => <Chip key={name} label={name} selected={category === name} onPress={() => setCategory(name)} />)}
      </View>
    </ScrollView>

    {!hasSignals && <View style={[s.soft, { backgroundColor: eventsBlueLight, gap: 12, padding: 18 }]}>
      <View style={s.row}><Icon name="zap" color={eventsBlue} /><Text style={[s.heading, s.grow, { fontSize: 18, lineHeight: 24 }]}>Get picks that fit you.</Text></View>
      <Text style={s.muted}>Share what you’re into, or a screenshot of the topics Facebook shows you in Feed and Reels. Muse Spark ranks these events and tells you why.</Text>
      <Button accent={eventsBlue} icon="sliders" testID="add-signals" onPress={() => router.push('/profile')}>Add your signals</Button>
    </View>}

    {hasSignals && <View style={{ gap: 14 }}>
      <View style={s.between}>
        <View style={[s.row, { gap: 9, flexShrink: 1, flexWrap: 'wrap' }]}><Text style={s.heading}>For you</Text>
          {current && <Tag tone={current.source === 'muse' ? 'blue' : 'gray'}>{current.source === 'muse' ? 'RANKED BY MUSE SPARK' : 'BASIC MATCH'}</Tag>}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh your picks" testID="refresh-picks" disabled={ranking}
          onPress={() => void rankForSession(session)} style={{ width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="refresh-cw" size={18} color={ranking ? colors.line : colors.muted} /></Pressable>
      </View>
      {waiting && <View accessibilityRole="progressbar" accessibilityLabel="Ranking events for you" style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 12, overflow: 'hidden', marginRight: -24 }}>
          {[0, 1].map(i => <View key={i} style={{ width: 268, height: 318, borderRadius: 22, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line }} />)}
        </View>
        <Text style={s.small}>{session.muse === 'ready' ? 'Muse Spark is ranking events against your signals…' : 'Matching events to your signals…'}</Text>
      </View>}
      {current && picks.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="for-you"
        style={{ marginHorizontal: -24, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
        {picks.map(({ pick, event }) => <PickCard key={event.id} event={event} pick={pick} />)}
      </ScrollView>}
      {current && !picks.length && <Text style={s.muted}>{current.picks.length
        ? 'None of your picks match this filter.' : 'Nothing in this catalog matches those signals yet. Add a few more interests.'}</Text>}
      {current?.notice ? <View style={[s.row, { alignItems: 'flex-start', gap: 8 }]}><View style={{ paddingTop: 2 }}><Icon name="info" size={14} color={colors.muted} /></View>
        <Text testID="picks-notice" style={[s.small, s.grow]}>{current.notice}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your signals" onPress={() => router.push('/profile')} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
        <Text style={[s.small, { color: eventsBlue, fontFamily: fonts.semibold }]}>
          {d.interests.length ? `Based on ${d.interests.length} shared interest${d.interests.length === 1 ? '' : 's'}${d.useIntro && session.intro.trim() ? ' and your intro' : ''}` : 'Based on your Glance intro'} · Edit</Text>
      </Pressable>
    </View>}

    <View style={{ gap: 18 }}>
      <View style={s.between}><Text style={s.heading}>{category === 'All' ? 'Coming up' : category}</Text><Text style={s.small}>{visible.length} event{visible.length === 1 ? '' : 's'}</Text></View>
      {visible.map(event => <EventRow key={event.id} event={event} picked={picked.has(event.id)} />)}
      {!visible.length && <Empty icon="search" title="No events match." text="Try another category or a broader search." />}
    </View>
    <Text style={s.small}>These are sample events for a concept demo, not real listings. Not affiliated with or endorsed by Meta.</Text>
  </Page>;
}

export function DiscoverEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), d = useDiscover(), session = useSession(), { busy, perform } = useOperation();
  const event = discoverEvent(id);
  if (!event) return <Page back title="Event"><Empty icon="calendar" title="That event isn’t here." text="It is not part of the sample catalog." />
    <Button accent={eventsBlue} icon="compass" onPress={() => router.replace('/events')}>Back to Discover</Button></Page>;
  // Only picks computed for the signals as they are now.
  const recs = d.recsKey === rankKey(session, d) ? d.recs : null;
  const pick = recs?.picks.find(p => p.eventId === event.id);
  const rsvp = d.rsvps[event.id];
  const room = d.rooms[event.id] && app.snapshot?.events.some(e => e.id === d.rooms[event.id]) ? d.rooms[event.id] : undefined;
  const openRoom = () => perform(async () => {
    const roomId = room ?? await app.createEvent(event.title, `${event.venue}, ${event.area}`);
    setDiscover({ rooms: { ...getDiscover().rooms, [event.id]: roomId }, ui: 'glance' });
    app.selectEvent(roomId);
    router.push(`/event/${roomId}`);
  });
  return <Page back title="Event" footer={<View style={s.row}>
    <View style={s.grow}><Button accent={eventsBlue} testID="rsvp-going" tone={rsvp === 'going' ? 'secondary' : 'primary'} icon={rsvp === 'going' ? 'check' : 'plus'}
      onPress={() => toggleRsvp(event.id, 'going')}>{rsvp === 'going' ? 'Going' : 'I’m going'}</Button></View>
    <View style={s.grow}><Button testID="rsvp-interested" tone="ghost" icon="bookmark"
      onPress={() => toggleRsvp(event.id, 'interested')}>{rsvp === 'interested' ? 'Saved' : 'Interested'}</Button></View>
  </View>}>
    <Cover event={event} height={188} radius={22}><View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.ink }}>{event.category}</Text></View></Cover>
    <GlobalStatus />
    <View style={{ gap: 8 }}>
      <Text style={eyebrow}>{eventWhen(event).toUpperCase()}</Text>
      <Text accessibilityRole="header" style={[s.title, { fontSize: 28, lineHeight: 34 }]}>{event.title}</Text>
      <Text style={s.muted}>Hosted by {event.host}</Text>
    </View>
    <View style={{ gap: 12 }}>
      {([['map-pin', `${event.venue} · ${event.area}`], ['users', `${event.going + (rsvp === 'going' ? 1 : 0)} going${rsvp === 'going' ? ', including you' : ''}`], ['tag', event.price]] as const)
        .map(([icon, text]) => <View key={icon} style={s.row}><Icon name={icon} size={17} color={colors.muted} /><Text style={[s.body, s.grow]}>{text}</Text></View>)}
    </View>
    {pick ? <View testID="why-fit" style={[s.soft, { backgroundColor: eventsBlueLight, gap: 10, padding: 18 }]}>
      <View style={s.between}><View style={[s.row, { gap: 8 }]}><Icon name="zap" size={17} color={eventsBlue} /><Text style={s.label}>Why this fits you</Text></View>
        <Text style={[s.label, { color: eventsBlue }]}>{pick.score}% match</Text></View>
      <Text style={s.body}>{pick.reason}</Text>
      <Text style={s.small}>{recs?.source === 'muse' ? `Ranked by Muse Spark (${recs.model ?? 'Meta'}) from the signals you shared.` : 'Basic keyword match, not a Muse ranking.'}</Text>
    </View> : <Pressable accessibilityRole="button" accessibilityLabel="Add your signals to see how well this fits" onPress={() => router.push('/profile')}
      style={({ pressed }) => [s.row, { gap: 8, minHeight: 44 }, pressed && s.pressed]}><Icon name="zap" size={16} color={eventsBlue} />
      <Text style={[s.small, s.grow, { color: eventsBlue, fontFamily: fonts.semibold }]}>Add your signals to see how well this fits you</Text></Pressable>}
    <View style={{ gap: 8 }}><Text style={s.heading}>About</Text><Text style={s.body}>{event.blurb}</Text></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{event.tags.map(tag => <View key={tag}
      style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.canvas }}><Text style={[s.small, { color: colors.ink }]}>{tag}</Text></View>)}</View>
    <View style={s.card}>
      <View style={{ gap: 6 }}><Text style={s.label}>Meeting people there?</Text>
        <Text style={s.small}>Open a private Glance room for this event and share its invite code. Glance helps you remember who you met and what you talked about.</Text></View>
      <Button tone="ghost" icon="arrow-up-right" busy={busy} testID="open-glance-room" onPress={() => void openRoom()}>{room ? 'Open your Glance room' : 'Open a Glance room'}</Button>
    </View>
    <Text style={s.small}>Sample event. RSVPs stay in memory on this device and are not sent to a host.</Text>
  </Page>;
}

export function GoingScreen() {
  const { rsvps } = useDiscover();
  const all = useMemo(() => upcoming(), []);
  const going = all.filter(event => rsvps[event.id] === 'going'), saved = all.filter(event => rsvps[event.id] === 'interested');
  return <Page>
    <View style={{ gap: 9 }}><Text style={s.title}>Your plans.</Text><Text style={s.muted}>Events you’re going to, and ones you saved for later.</Text></View>
    {going.length > 0 && <View style={{ gap: 18 }}><Text style={s.heading}>Going</Text>{going.map(event => <EventRow key={event.id} event={event} />)}</View>}
    {saved.length > 0 && <View style={{ gap: 18 }}><Text style={s.heading}>Interested</Text>{saved.map(event => <EventRow key={event.id} event={event} />)}</View>}
    {!going.length && !saved.length && <><Empty icon="calendar" title="Nothing planned yet." text="RSVP to an event in Discover and it shows up here." />
      <Button accent={eventsBlue} icon="compass" onPress={() => router.push('/events')}>Browse events</Button></>}
    <Text style={s.small}>RSVPs stay in memory for this session. Sample events; nothing is sent to a host.</Text>
  </Page>;
}

const MAX_UPLOAD = 1_900_000;
export function SignalsScreen() {
  const d = useDiscover(), session = useSession(), { busy, perform } = useOperation();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const intro = session.intro.trim();
  const hasSignals = d.interests.length > 0 || (d.useIntro && intro.length > 0);
  const upload = () => perform(async () => {
    setNote('');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    const prepared = await ImageManipulator.manipulateAsync(asset.uri, asset.width > 1000 ? [{ resize: { width: 1000 } }] : [],
      { format: ImageManipulator.SaveFormat.JPEG, compress: 0.72, base64: true });
    if (!prepared.base64) throw new Error('Could not prepare that screenshot. Try another image.');
    const image = `data:image/jpeg;base64,${prepared.base64}`;
    if (image.length > MAX_UPLOAD) throw new Error('That screenshot is too large. Crop it to the list of topics, then try again.');
    const read = await readScreenshot(session, image);
    addInterests(read.interests, { shared: 'screenshot', summary: read.summary });
    setNote(`Muse Spark read ${read.interests.length} interest${read.interests.length === 1 ? '' : 's'} from your screenshot. Review them below.`);
  });
  const addTyped = () => {
    const values = splitInterests(draft);
    if (!values.length) return;
    addInterests(values); setDraft(''); setNote('');
  };
  return <Page>
    <View style={{ gap: 9 }}><Text style={s.title}>Your signals.</Text>
      <Text style={s.muted}>Muse Spark ranks events from what you choose to share here. You see and edit everything before it is used.</Text></View>
    <GlobalStatus />

    <View style={s.card}>
      <View style={[s.row, { alignItems: 'flex-start' }]}><View style={{ padding: 10, backgroundColor: eventsBlueLight, borderRadius: 12 }}><Icon name="user" color={eventsBlue} /></View>
        <View style={[s.grow, { gap: 4 }]}><Text style={s.label}>Your Glance intro</Text>
          <Text style={s.small}>{intro ? `“${intro}”` : 'No introduction yet. Add one to your Glance profile to use it here.'}</Text></View></View>
      <Pressable accessibilityRole="checkbox" aria-checked={d.useIntro} accessibilityLabel="Use my Glance intro for picks" testID="use-intro"
        onPress={() => setDiscover({ useIntro: !d.useIntro })} style={[s.row, { minHeight: 44 }]}>
        <Icon name={d.useIntro ? 'check-square' : 'square'} color={eventsBlue} /><Text style={[s.small, s.grow, { color: colors.ink }]}>Use my intro for picks</Text></Pressable>
    </View>

    <View style={s.card}>
      <View style={[s.row, { alignItems: 'flex-start' }]}><View style={{ padding: 10, backgroundColor: eventsBlueLight, borderRadius: 12 }}><Icon name="film" color={eventsBlue} /></View>
        <View style={[s.grow, { gap: 4 }]}><Text style={s.label}>What Facebook shows you</Text>
          <Text style={s.small}>Facebook does not let apps read your Reels or watch history. Its “Your algorithm” page, in the three-dot menu on a post, is where you manage the topics you want in Feed and Reels. Share a screenshot of it and Muse Spark reads the topics.</Text></View></View>
      {session.muse === 'ready'
        ? <Button accent={eventsBlue} icon="upload" busy={busy} testID="upload-screenshot" onPress={() => void upload()}>Upload a screenshot</Button>
        : <Text style={s.small}>{session.muse === 'sample'
          ? 'Reading a screenshot runs on Muse Spark, which needs the backend. This sample walkthrough has none, so try the sample signals.'
          : 'Create your Glance profile first; reading a screenshot is tied to your device.'}</Text>}
      <Button tone="ghost" icon="layers" testID="use-sample-signals"
        onPress={() => { addInterests(SAMPLE_SIGNALS.interests, { shared: 'sample', summary: SAMPLE_SIGNALS.summary }); setNote('Added sample signals. They are fictional and labelled below.'); }}>Use sample signals</Button>
    </View>

    <View style={s.card}>
      <Text style={s.label}>Add your own</Text>
      <View style={[s.row, { gap: 10 }]}>
        <TextInput accessibilityLabel="Interests to add" value={draft} onChangeText={setDraft} onSubmitEditing={addTyped} returnKeyType="done"
          placeholder="climbing, espresso, live jazz" placeholderTextColor={colors.muted} maxLength={200} autoCorrect={false} style={[s.input, s.grow]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add interests" testID="add-interests" onPress={addTyped} disabled={!draft.trim()}
          style={({ pressed }) => [{ width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
            backgroundColor: draft.trim() ? eventsBlue : colors.canvas, borderWidth: draft.trim() ? 0 : 1, borderColor: colors.line }, pressed && s.pressed]}>
          <Icon name="plus" color={draft.trim() ? colors.paper : colors.muted} /></Pressable>
      </View>
      <Text style={s.small}>Separate interests with commas.</Text>
    </View>

    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <View style={[s.row, { gap: 9, flexShrink: 1, flexWrap: 'wrap' }]}><Text style={s.heading}>Shared interests</Text>
          {d.shared === 'sample' && <Tag tone="gray">SAMPLE</Tag>}{d.shared === 'screenshot' && <Tag>FROM SCREENSHOT</Tag>}</View>
        {d.interests.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear all interests" testID="clear-signals" onPress={() => { clearSignals(); setNote(''); }}
          style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[s.small, { color: colors.danger, fontFamily: fonts.semibold }]}>Clear</Text></Pressable>}
      </View>
      {note ? <Text testID="signals-note" style={[s.small, { color: colors.green }]}>{note}</Text> : null}
      {d.summary ? <Text style={s.small}>{d.summary}</Text> : null}
      {d.interests.length ? <View testID="interest-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {d.interests.map(interest => <View key={interest} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: eventsBlueLight, paddingLeft: 13 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink }}>{interest}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${interest}`} onPress={() => removeInterest(interest)}
            style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={14} color={colors.muted} /></Pressable>
        </View>)}
      </View> : <Text style={s.muted}>Nothing shared yet.</Text>}
    </View>

    <Button accent={eventsBlue} icon="zap" disabled={!hasSignals} testID="see-picks" onPress={() => router.push('/events')}>See my picks</Button>
    <Text style={s.small}>A screenshot is sent to Meta’s Muse Spark model to read its topics, and Glance does not store it. Interests stay in memory on this device and are sent only to rank events. Sensitive topics such as health, religion and politics are left out. Concept demo; not affiliated with or endorsed by Meta.</Text>
  </Page>;
}

import React, { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Empty, Icon, Notice, Page, Portrait, PortraitStack, Tag, Wordmark, useIsDesktop } from '../components';
import { colors, radius, s, type } from '../theme';
import { EventCover } from '../ui/EventCover';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { formatEventDate, useEventViews, useMe } from '../services/views';
import type { EventView } from '../services/contracts';

export function rsvpLabel(view: EventView): string {
  if (view.past) return 'Happened';
  if (view.isHost) return 'You’re hosting';
  if (view.rsvp === 'going') return 'You’re going';
  if (view.rsvp === 'maybe') return 'Maybe';
  if (view.rsvp === 'cant') return 'Can’t make it';
  return view.joined ? 'RSVP' : 'Invited';
}

function Skeleton({ height, width = '100%' }: { height: number; width?: number | `${number}%` }) {
  return <View accessibilityElementsHidden style={{ height, width, borderRadius: radius.md, backgroundColor: colors.creamDeep }} />;
}

/** Hero card for the next event: the cover is the invitation. */
function NextEvent({ view, onOpen }: { view: EventView; onOpen: () => void }) {
  const desktop = useIsDesktop();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${view.title}`} onPress={onOpen} testID={`event-card-${view.id}`}
    style={({ pressed }) => [{ backgroundColor: colors.paper, borderRadius: 26, overflow: 'hidden' }, pressed && s.pressed]}>
    <View style={desktop ? { flexDirection: 'row' } : undefined}>
      <View style={desktop ? { width: '52%' } : undefined}>
        <EventCover title={view.title} theme={view.cover} dateLabel={formatEventDate(view.startsAt)} guests={view.guests} height={desktop ? 300 : 232} style={{ borderRadius: 0 }} />
      </View>
      <View style={{ padding: 20, gap: 14, flex: 1, justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Tag tone={view.rsvp === 'going' || view.isHost ? 'blue' : 'neutral'}>{rsvpLabel(view)}</Tag>
          <Text style={type.small}>{view.location}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Portrait person={view.host} size={36} />
          <Text style={[type.secondary, { flex: 1 }]}>Hosted by <Text style={type.bodyStrong}>{view.isHost ? 'you' : view.host.name}</Text></Text>
        </View>
        {view.guests.length > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <PortraitStack people={view.guests} size={32} />
          <Text style={[type.small, { flex: 1 }]}>{view.guests.length === 1 ? `${view.guests[0].name.split(' ')[0]} is coming` : `${view.guests.length} people you could meet`}</Text>
        </View>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <Text style={type.bodyStrong}>Open invitation</Text><Icon name="arrow-right" size={18} />
        </View>
      </View>
    </View>
  </Pressable>;
}

function EventRow({ view, onOpen, invitation = false }: { view: EventView; onOpen: () => void; invitation?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${view.title}`} onPress={onOpen} testID={`event-row-${view.id}`}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.paper, borderRadius: radius.lg, padding: 12, paddingRight: 16 }, pressed && s.pressed]}>
    <View style={{ width: 84, borderRadius: 14, overflow: 'hidden' }}>
      <EventCover title={view.title} theme={view.cover} height={84} scale={0.36} style={{ borderRadius: 14 }} />
    </View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text numberOfLines={2} style={type.subheading}>{view.title}</Text>
      <Text numberOfLines={1} style={type.small}>{view.past ? `${formatEventDate(view.startsAt)} · ${view.location}` : `${formatEventDate(view.startsAt)} · ${view.location}`}</Text>
      <Text style={[type.smallStrong, { color: invitation ? colors.ink : colors.muted }]}>{invitation ? `Invited by ${view.host.name.split(' ')[0]}` : rsvpLabel(view)}</Text>
    </View>
    <Icon name="chevron-right" size={18} color={colors.faint} />
  </Pressable>;
}

export function EventsHome() {
  const app = useGlance();
  const me = useMe();
  const { state, dispatch } = useAppStore();
  const { status, events, invitations } = useEventViews();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(undefined); }, [selectEvent]));
  const open = (id: string) => { app.selectEvent(id); router.push(`/event/${id}`); };
  const upcoming = events.filter(e => !e.past);
  const past = events.filter(e => e.past);
  const [next, ...others] = upcoming;
  const active = app.snapshot?.conversations.find(c => !c.connectedAt && ['consent', 'recording'].includes(c.status));
  const retry = () => { dispatch({ type: 'dev', patch: { events: 'ready' } }); void app.refresh(); };
  const desktop = useIsDesktop();

  return <Page testID="events-home">
    {!desktop && <View style={s.between}>
      <Wordmark size={28} />
      {me && <Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => router.push('/profile')}><Portrait person={me} size={40} /></Pressable>}
    </View>}
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={type.display}>{next ? 'Who will you meet?' : 'Where to next?'}</Text>
      <Text style={type.secondary}>{next ? `${next.title}, ${formatEventDate(next.startsAt)}.` : 'Join an invitation or host something small.'}</Text>
    </View>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1 }}><Button tone="ghost" size="sm" icon="log-in" testID="home-join" onPress={() => router.push('/join')}>Join with code</Button></View>
      <View style={{ flex: 1 }}><Button tone="ghost" size="sm" icon="plus" testID="home-create" onPress={() => router.push('/create')}>Create event</Button></View>
    </View>
    {app.error ? <Notice error icon="alert-circle">{app.error}</Notice> : null}
    {active && <Pressable accessibilityRole="button" accessibilityLabel="Return to your conversation" onPress={() => router.push(`/conversation/${active.id}`)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.powder, borderRadius: radius.lg, padding: 16 }, pressed && s.pressed]}>
      <Icon name="mic" size={18} /><Text style={[type.bodyStrong, { flex: 1 }]}>A conversation is still open. Return to it.</Text><Icon name="arrow-right" size={18} />
    </Pressable>}

    {status === 'loading' && <View style={{ gap: 14 }} testID="events-loading"><Skeleton height={232} /><Skeleton height={84} /><Skeleton height={84} width="80%" /></View>}
    {status === 'error' && <Empty icon="wifi-off" title="Couldn’t load your events." text="Check your connection and try again. Nothing you did was lost."
      action={<Button tone="secondary" icon="rotate-ccw" onPress={retry}>Try again</Button>} />}
    {status === 'empty' && <Empty icon="calendar" title="No events yet." text="Your next good conversation starts with an invitation. Join one with a code, or host something small."
      action={<Button icon="plus" onPress={() => router.push('/create')}>Create an event</Button>} />}

    {status === 'ready' && <>
      {next && <NextEvent view={next} onOpen={() => open(next.id)} />}
      {invitations.length > 0 && <View style={{ gap: 10 }}>
        <Text style={type.heading}>You’re invited</Text>
        {invitations.map(view => <EventRow key={view.id} view={view} invitation onOpen={() => open(view.id)} />)}
      </View>}
      {others.length > 0 && <View style={{ gap: 10 }}>
        <Text style={type.heading}>Coming up</Text>
        {others.map(view => <EventRow key={view.id} view={view} onOpen={() => open(view.id)} />)}
      </View>}
      {past.length > 0 && <View style={{ gap: 10 }}>
        <Text style={type.heading}>Earlier</Text>
        {past.map(view => <EventRow key={view.id} view={view} onOpen={() => open(view.id)} />)}
      </View>}
    </>}
    {state.auth === 'signed-in' && status === 'ready' && <Text style={type.small}>Your portrait helps people remember you. Recognition only uses a separate scan, and only at events where you turn Glance on.</Text>}
  </Page>;
}

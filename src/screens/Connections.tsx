import React, { useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Empty, Icon, Page, Portrait } from '../components';
import { colors, radius, s, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { formatEventDate, useConnections, useEventViews, usePeopleIndex } from '../services/views';
import type { ConnectionView } from '../services/views';

function Row({ connection }: { connection: ConnectionView }) {
  const lastMessage = connection.messages[connection.messages.length - 1];
  const summary = connection.note || lastMessage?.text || connection.recap?.topics.join(', ') || 'Open to add a note';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${connection.person.name}`} testID={`connection-${connection.id}`}
    onPress={() => router.push(`/connection/${connection.id}`)}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, pressed && s.pressed]}>
    <Portrait person={connection.person} size={52} />
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={[type.subheading, { flexShrink: 1 }]}>{connection.person.name}</Text>
        {connection.bookmarked && <Icon name="bookmark" size={14} color={colors.ink} />}
      </View>
      <Text numberOfLines={1} style={type.small}>{connection.person.occupation}</Text>
      <Text numberOfLines={1} style={[type.small, connection.note ? { fontFamily: 'Inter_500Medium', color: colors.text } : null]}>{summary}</Text>
    </View>
    <Icon name="chevron-right" size={18} color={colors.faint} />
  </Pressable>;
}

/** Remembered people, grouped by the event where you met, with saved-but-not-yet-met people on top. */
export function Connections() {
  const app = useGlance();
  const { state, dispatch } = useAppStore();
  const { status, connections } = useConnections();
  const { events } = useEventViews();
  const people = usePeopleIndex();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(undefined); }, [selectEvent]));
  const groups = useMemo(() => {
    const byEvent = new Map<string, ConnectionView[]>();
    for (const c of connections) byEvent.set(c.eventId, [...(byEvent.get(c.eventId) ?? []), c]);
    return [...byEvent.entries()].map(([eventId, items]) => ({ eventId, event: items[0].event, items }));
  }, [connections]);
  const saved = useMemo(() => state.bookmarks.flatMap(key => {
    const [eventId, personId] = key.split(':');
    const person = people.get(personId);
    const event = events.find(e => e.id === eventId);
    return person && event && !connections.some(c => c.personId === personId) ? [{ key, person, event }] : [];
  }), [state.bookmarks, people, events, connections]);

  return <Page testID="connections">
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={type.display}>People you met.</Text>
      <Text style={type.secondary}>By event, with the context that made the conversation worth keeping.</Text>
    </View>
    {status === 'loading' && <View style={{ gap: 12 }}>{[0, 1, 2].map(i => <View key={i} style={{ height: 76, borderRadius: radius.lg, backgroundColor: colors.creamDeep }} />)}</View>}
    {status === 'error' && <Empty icon="wifi-off" title="Couldn’t load your connections." text="Try again in a moment." action={<Button tone="secondary" icon="rotate-ccw" onPress={() => dispatch({ type: 'dev', patch: { connections: 'ready' } })}>Try again</Button>} />}
    {saved.length > 0 && <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 16, gap: 4 }}>
      <View style={{ gap: 2, paddingBottom: 6 }}><Text style={type.heading}>Saved to remember</Text><Text style={type.small}>People you marked before meeting them.</Text></View>
      {saved.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`Open ${item.event.title}`} onPress={() => router.push(`/event/${item.event.id}/people`)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }, pressed && s.pressed]}>
        <Portrait person={item.person} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={type.subheading}>{item.person.name}</Text><Text numberOfLines={1} style={type.small}>{item.event.title} · {formatEventDate(item.event.startsAt)}</Text></View>
        <Icon name="chevron-right" size={18} color={colors.faint} />
      </Pressable>)}
    </View>}
    {status === 'empty' && saved.length === 0 && <Empty icon="users" title="No one yet, and that’s fine." text="Go to an event, have one good conversation, and finish it with the three-finger sign or the Finish button. The person lands here with a recap."
      action={<Button icon="calendar" onPress={() => router.push('/events')}>Find an event</Button>} />}
    {status === 'ready' && groups.map(group => <View key={group.eventId} style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 16, gap: 2 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${group.event?.title ?? 'event'}`} disabled={!group.event} onPress={() => group.event && router.push(`/event/${group.event.id}`)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.heading}>{group.event?.title ?? 'An event'}</Text>
          <Text style={type.small}>{group.event ? `${formatEventDate(group.event.startsAt)} · ${group.event.location}` : ''}</Text>
        </View>
        {group.event && <Icon name="arrow-up-right" size={18} color={colors.muted} />}
      </Pressable>
      {group.items.map(connection => <Row key={connection.id} connection={connection} />)}
    </View>)}
  </Page>;
}

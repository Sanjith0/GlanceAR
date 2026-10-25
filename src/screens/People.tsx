import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Chip, Empty, Icon, Page, Portrait, Tag } from '../components';
import { colors, radius, s, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { useConnections, useEventView, useMe } from '../services/views';
import { suggestPeople } from '../services/suggestions';
import { PersonSheet } from '../ui/PersonSheet';
import type { Suggestion } from '../services/contracts';

/** "People to meet": portraits, overlap in plain words, and one thing to say. */
export function People() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance();
  const me = useMe();
  const view = useEventView(id);
  const { state, dispatch } = useAppStore();
  const { connections } = useConnections();
  const [open, setOpen] = useState<Suggestion | null>(null);
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(id); }, [id, selectEvent]));
  const suggestions = useMemo(() => view ? suggestPeople(me, view.guests, { eventTitle: view.title, prompt: view.prompt }) : [], [me, view]);
  const bookmarked = (personId: string) => state.bookmarks.includes(`${id}:${personId}`);
  const enabled = Boolean(app.snapshot?.event?.id === id && app.snapshot.eventPermission?.enabled);

  if (!view) return <Page back title="People"><Empty icon="users" title="Event unavailable" text="Open an event from Events first." /></Page>;
  return <Page back title={view.title} testID="event-people">
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={type.display}>People to meet.</Text>
      <Text style={type.secondary}>{suggestions.length ? 'Ranked by how much you have to talk about, with the reasons spelled out.' : 'Guests appear here as they join.'}</Text>
    </View>
    {!suggestions.length && <Empty icon="users" title="Nobody has joined yet." text={view.isHost ? 'Share the invitation code and your guests will show up here.' : 'Check back closer to the event.'}
      action={view.isHost ? <Button tone="secondary" icon="share" onPress={() => router.push(`/event/${id}`)}>Share invitation</Button> : undefined} />}
    {suggestions.map(item => {
      const met = connections.find(c => c.personId === item.person.id);
      return <Pressable key={item.person.id} accessibilityRole="button" accessibilityLabel={`About ${item.person.name}`} testID={`person-${item.person.id}`}
        onPress={() => setOpen(item)} style={({ pressed }) => [{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 16, gap: 12 }, pressed && s.pressed]}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Portrait person={item.person} size={60} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={[type.subheading, { flexShrink: 1 }]}>{item.person.name}</Text>
              {bookmarked(item.person.id) && <Icon name="bookmark" size={14} color={colors.ink} />}
            </View>
            <Text numberOfLines={2} style={type.small}>{item.person.occupation}</Text>
            {met && <Text style={[type.micro, { color: colors.ink }]}>You’ve connected before</Text>}
          </View>
          <Icon name="chevron-right" size={18} color={colors.faint} />
        </View>
        <View style={{ gap: 4 }}>
          {[...item.professional.slice(0, 1), ...item.personal.slice(0, 1)].map(line => <Text key={line} style={type.body}>{line}</Text>)}
        </View>
        {item.shared.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{item.shared.map(i => <Chip key={i} selected>{i}</Chip>)}</View>}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="message-circle" size={15} color={colors.muted} /><Text style={[type.quote, { flex: 1, fontSize: 17, lineHeight: 24 }]}>{item.starters[0]}</Text>
        </View>
        {!item.person.glanceEnabled && <Tag tone="neutral">Glance off</Tag>}
      </Pressable>;
    })}
    {suggestions.length > 0 && !view.past && <Button icon="aperture" tone={enabled ? 'primary' : 'secondary'} testID="people-open-live" onPress={() => router.push(`/event/${id}/live`)}>
      {enabled ? 'Open live view' : 'Open live view (Glance is off)'}
    </Button>}
    <PersonSheet suggestion={open} open={open !== null} onClose={() => setOpen(null)}
      bookmarked={open ? bookmarked(open.person.id) : false}
      onToggleBookmark={() => open && dispatch({ type: 'bookmark', key: `${id}:${open.person.id}`, present: !bookmarked(open.person.id) })}
      metBefore={open && connections.find(c => c.personId === open.person.id) ? `You connected at ${connections.find(c => c.personId === open.person.id)?.event?.title ?? 'an earlier event'}` : undefined} />
  </Page>;
}

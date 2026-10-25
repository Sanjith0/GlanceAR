import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Chip, Empty, Icon, IconButton, Notice, Page, Portrait, PortraitStack, SampleTag, Tag, useIsDesktop } from '../components';
import { colors, radius, s, type } from '../theme';
import { EventCover } from '../ui/EventCover';
import { Sheet } from '../ui/Sheet';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { formatEventDate, useEventView, useMe, useNow } from '../services/views';
import { suggestPeople } from '../services/suggestions';
import { useDemoMode } from '../services/demoMode';
import { useOperation } from '../ui/shared';
import type { EventView, Rsvp } from '../services/contracts';

const RSVPS: { key: Rsvp; label: string; icon: 'check' | 'help-circle' | 'x' }[] = [
  { key: 'going', label: 'Going', icon: 'check' }, { key: 'maybe', label: 'Maybe', icon: 'help-circle' }, { key: 'cant', label: 'Can’t go', icon: 'x' },
];

export function RsvpControl({ value, onChange, disabled }: { value: Rsvp; onChange: (next: Rsvp) => void; disabled?: boolean }) {
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
    {RSVPS.map(option => {
      const selected = value === option.key;
      return <Pressable key={option.key} accessibilityRole="radio" accessibilityState={{ selected, disabled }} disabled={disabled} testID={`rsvp-${option.key}`}
        onPress={() => onChange(selected ? 'none' : option.key)}
        style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
          backgroundColor: selected ? colors.ink : colors.paper, borderWidth: 1.5, borderColor: selected ? colors.ink : colors.line }, pressed && s.pressed]}>
        <Icon name={option.icon} size={15} color={selected ? colors.cream : colors.ink} />
        <Text style={[type.smallStrong, { color: selected ? colors.cream : colors.ink }]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** The invitation page: cover, host, details, RSVP, who's coming, and the way into the live experience. */
export function InvitationBody({ view, children }: { view: EventView; children?: React.ReactNode }) {
  const me = useMe();
  const desktop = useIsDesktop();
  const now = useNow();
  const suggestions = useMemo(() => suggestPeople(me, view.guests, { eventTitle: view.title, prompt: view.prompt }).slice(0, 4), [me, view]);
  const details = <View style={{ gap: 22 }}>
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Portrait person={view.host} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={type.small}>Hosted by</Text>
          <Text style={type.subheading}>{view.isHost ? `${view.host.name} (you)` : view.host.name}</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <View style={s.row}><Icon name="calendar" size={16} color={colors.muted} /><Text style={type.body}>{formatEventDate(view.startsAt, now, 'long')}</Text></View>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="map-pin" size={16} color={colors.muted} />
          <View style={{ flex: 1 }}><Text style={type.body}>{view.location || 'Location shared by the host'}</Text>{view.address ? <Text style={type.small}>{view.address}</Text> : null}</View></View>
        <View style={s.row}><Icon name={view.visibility === 'open' ? 'globe' : 'lock'} size={16} color={colors.muted} /><Text style={type.secondary}>{view.visibility === 'open' ? 'Anyone with the link can join' : 'Invite only'}</Text></View>
      </View>
    </View>
    {children}
    {view.purpose ? <Text style={type.quote}>{view.purpose}</Text> : null}
    {view.description ? <Text style={type.body}>{view.description}</Text> : null}
    {view.prompt ? <View style={{ backgroundColor: colors.powderLight, borderRadius: radius.lg, padding: 16, gap: 4 }}>
      <Text style={type.small}>A prompt from your host</Text><Text style={type.bodyStrong}>{view.prompt}</Text>
    </View> : null}
    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={type.heading}>{view.past ? 'Who was there' : 'Who’s coming'}</Text>
        {view.guests.length > 0 && <Text style={type.small}>{view.guests.length} {view.guests.length === 1 ? 'guest' : 'guests'}</Text>}
      </View>
      {view.guests.length ? <>
        <PortraitStack people={view.guests} size={40} max={6} />
        {suggestions.map(item => <View key={item.person.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Portrait person={item.person} size={40} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={type.subheading}>{item.person.name} <Text style={type.small}>{item.person.occupation}</Text></Text>
            {item.person.interests.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{item.person.interests.slice(0, 3).map(i => <Chip key={i} selected={item.shared.includes(i)}>{i}</Chip>)}</View>}
          </View>
        </View>)}
      </> : <Text style={type.secondary}>{view.isHost ? 'Share the invitation and your guests appear here with their interests.' : 'Be the first to arrive. Guests appear here as they join.'}</Text>}
    </View>
  </View>;
  if (desktop) return <View style={{ flexDirection: 'row', gap: 40, alignItems: 'flex-start' }}>
    <View style={{ width: '46%' }}><EventCover title={view.title} theme={view.cover} dateLabel={formatEventDate(view.startsAt)} guests={view.guests} height={520} scale={1.2} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>{details}</View>
  </View>;
  return <View style={{ gap: 22 }}>
    <EventCover title={view.title} theme={view.cover} dateLabel={formatEventDate(view.startsAt)} guests={view.guests} height={320} />
    {details}
  </View>;
}

export function EventDetail() {
  const { id, published } = useLocalSearchParams<{ id: string; published?: string }>();
  const app = useGlance();
  const demo = useDemoMode();
  const { dispatch } = useAppStore();
  const { busy, perform } = useOperation();
  const view = useEventView(id);
  const [share, setShare] = useState(false);
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(id); }, [id, selectEvent]));
  const setRsvp = (rsvp: Rsvp) => void perform(async () => {
    if (view && !view.joined && rsvp !== 'none') {
      await app.joinEvent(view.inviteCode);
      dispatch({ type: 'invitation', id: view.id, present: false });
    }
    if (view) dispatch({ type: 'rsvp', eventId: view.id, rsvp });
  });
  const enabled = Boolean(app.snapshot?.event?.id === id && app.snapshot.eventPermission?.enabled);
  const enabledGuests = view?.guests.filter(g => g.glanceEnabled).length ?? 0;

  if (!view) return <Page back title="Invitation">
    {!app.loading && <Empty icon="calendar" title="This invitation isn’t available." text="It may have been removed, or you may need the host’s code." action={<Button tone="secondary" onPress={() => router.replace('/join')}>Join with a code</Button>} />}
  </Page>;

  const live = !view.past && view.joined;
  return <Page testID={`event-${view.id}`} wide
    headerRight={<View style={{ flexDirection: 'row', gap: 4 }}>
      {view.isHost && !view.past && <IconButton name="edit-2" label="Edit event" onPress={() => { dispatch({ type: 'eventDraft', draft: { title: view.title, location: view.location, startsAt: view.startsAt, endsAt: view.endsAt, address: view.address, description: view.description, purpose: view.purpose, visibility: view.visibility, prompt: view.prompt, cover: view.cover } }); router.push({ pathname: '/create', params: { edit: view.id } }); }} />}
      <IconButton name="share" label="Share invitation" onPress={() => setShare(true)} testID="event-share" />
    </View>} back title={view.past ? 'Earlier' : view.joined ? 'Your invitation' : 'Invitation'}>
    {published === '1' && <Notice icon="check-circle">Published as a sample. Nothing was sent; share the code when you’re ready.</Notice>}
    <InvitationBody view={view}>
      <View style={{ gap: 10 }}>
        {view.past ? <Tag tone="neutral">This event has happened</Tag> : view.isHost ? <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}><Tag tone="blue">You’re hosting</Tag><Button size="sm" tone="ghost" icon="share" onPress={() => setShare(true)}>Share invitation</Button></View>
          : <>
            {!view.joined && <Text style={type.small}>{`${view.host.name.split(' ')[0]} invited you. Reply to join the guest list.`}</Text>}
            <RsvpControl value={view.rsvp} onChange={setRsvp} disabled={busy} />
          </>}
        {app.error ? <Notice error icon="alert-circle">{app.error}</Notice> : null}
      </View>
    </InvitationBody>
    {live && <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, padding: 20, gap: 14 }} testID="event-live-card">
      <View style={s.between}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.heading}>At the event</Text>
          <Text style={type.small}>{enabled ? `Glance is on. ${enabledGuests} ${enabledGuests === 1 ? 'guest has' : 'guests have'} it on too.` : 'Glance is off for this event.'}</Text>
        </View>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: enabled ? colors.green : colors.lineStrong }} />
      </View>
      <Text style={type.secondary}>{enabled
        ? 'People who turned Glance on can recognize each other here. Starting a conversation with someone records it under both of your event permissions; either of you can stop without sharing.'
        : 'Turning Glance on lets attendees who also have it on recognize you, and lets a conversation between you be recorded and recapped for both of you. Audio goes to Meta’s model API for the recap. You can pause at any time.'}</Text>
      <View style={{ gap: 10 }}>
        <Button icon="users" tone="secondary" testID="event-people" onPress={() => router.push(`/event/${view.id}/people`)}>People to meet</Button>
        {enabled ? <>
          <Button icon="aperture" testID="event-open-live" onPress={() => router.push(`/event/${view.id}/live`)}>Open live view</Button>
          <Button tone="ghost" icon="pause" busy={busy} testID="event-pause" onPress={() => void perform(() => app.setEventPermission(view.id, false))}>Pause Glance for this event</Button>
        </> : <Button icon="check" busy={busy} testID="event-enable" onPress={() => void perform(async () => {
          if (app.mode === 'live' && Platform.OS !== 'web' && app.captureSource === 'phone') await app.preparePhoneCapture();
          await app.setEventPermission(view.id, true);
        })}>Turn on Glance for this event</Button>}
      </View>
      {demo && <SampleTag>Sample event · nothing is recorded here</SampleTag>}
    </View>}
    <Sheet open={share} onClose={() => setShare(false)} title="Share the invitation" testID="share-sheet"
      footer={<Button onPress={() => setShare(false)}>Done</Button>}>
      <View style={{ gap: 14 }}>
        <Text style={type.secondary}>Anyone with this code can open the invitation. {view.visibility === 'invite' ? 'Only share it with people you want there.' : ''}</Text>
        <View style={{ backgroundColor: colors.paper, borderRadius: radius.lg, padding: 18, gap: 6, alignItems: 'center' }}>
          <Text style={type.small}>Invitation code</Text>
          <Text selectable testID="invite-code" style={[type.title, { letterSpacing: 4 }]}>{view.inviteCode}</Text>
          <Text selectable style={type.small}>glance.app/invite/{view.inviteCode}</Text>
        </View>
        {demo && <Text style={type.small}>Sharing stays on this device in the preview. Nothing is sent.</Text>}
      </View>
    </Sheet>
  </Page>;
}

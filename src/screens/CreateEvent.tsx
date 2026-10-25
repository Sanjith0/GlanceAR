import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Icon, Notice, Page, SampleTag, Tag } from '../components';
import { colors, radius, s, type } from '../theme';
import { COVER_THEMES, EventCover, type CoverTheme } from '../ui/EventCover';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { formatDateOnly, formatEventDate, formatTimeOnly, useEventView, useMe } from '../services/views';
import { atLocal } from '../fixtures/events';
import { useDemoMode } from '../services/demoMode';
import { InvitationBody } from './EventDetail';
import type { EventDraft, EventView, Visibility } from '../services/contracts';

const emptyDraft = (): EventDraft => ({ title: '', location: '', address: '', description: '', purpose: '', visibility: 'invite', prompt: '', cover: 'arches', startsAt: 0 });
const TIMES = [[10, 0], [12, 0], [14, 0], [16, 0], [18, 0], [18, 30], [19, 0], [19, 30], [20, 0]];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: colors.paper, borderRadius: radius.pill, padding: 4, gap: 4 }}>
    {options.map(option => {
      const selected = option.key === value;
      return <Pressable key={option.key} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onChange(option.key)}
        style={({ pressed }) => [{ flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.ink : 'transparent' }, pressed && s.pressed]}>
        <Text style={[type.smallStrong, { color: selected ? colors.cream : colors.ink }]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** Host flow: cover and title first, then a few fields, a review of the invitation, and a simulated publish. */
export function CreateEvent() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const app = useGlance();
  const me = useMe();
  const demo = useDemoMode();
  const { state, dispatch } = useAppStore();
  const existing = useEventView(edit);
  const draft = state.eventDraft ?? emptyDraft();
  const set = (patch: Partial<EventDraft>) => dispatch({ type: 'eventDraft', draft: { ...draft, ...patch } });
  const [stage, setStage] = useState<'edit' | 'review'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => atLocal(i, 0, 0)), []);
  const selectedDay = draft.startsAt ? new Date(draft.startsAt) : null;
  const sameDay = (day: number) => selectedDay !== null && new Date(day).toDateString() === selectedDay.toDateString();
  const pickDay = (day: number) => {
    const date = new Date(day);
    const hour = selectedDay ? selectedDay.getHours() : 19, minute = selectedDay ? selectedDay.getMinutes() : 0;
    const startsAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).getTime();
    set({ startsAt, endsAt: startsAt + 2.5 * 3_600_000 });
  };
  const pickTime = (hour: number, minute: number) => {
    const base = selectedDay ?? new Date(days[0]);
    const startsAt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute).getTime();
    set({ startsAt, endsAt: startsAt + 2.5 * 3_600_000 });
  };
  const problems = { title: !draft.title.trim() ? 'Give your event a name.' : '', when: !draft.startsAt ? 'Pick a day and time.' : '', location: !draft.location.trim() ? 'Say where to meet.' : '' };
  const valid = !problems.title && !problems.when && !problems.location;
  const preview: EventView | null = me ? {
    id: existing?.id ?? 'draft', title: draft.title, location: draft.location, inviteCode: existing?.inviteCode ?? 'SHARED AFTER PUBLISHING', hostId: me.id,
    startsAt: draft.startsAt, endsAt: draft.endsAt, address: draft.address, description: draft.description, purpose: draft.purpose, visibility: draft.visibility, prompt: draft.prompt, cover: draft.cover,
    host: me, guests: existing?.guests ?? [], rsvp: 'going', joined: true, isHost: true, past: false,
  } : null;

  const publish = async () => {
    setBusy(true); setError('');
    try {
      const details = { startsAt: draft.startsAt, endsAt: draft.endsAt, address: draft.address.trim(), description: draft.description.trim(), purpose: draft.purpose.trim(), visibility: draft.visibility, prompt: draft.prompt.trim(), cover: draft.cover };
      if (existing) {
        dispatch({ type: 'eventDetails', id: existing.id, details });
        dispatch({ type: 'eventDraft', draft: null });
        router.replace(`/event/${existing.id}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, demo ? 700 : 0));
      const id = await app.createEvent(draft.title, draft.location);
      dispatch({ type: 'eventDetails', id, details });
      dispatch({ type: 'rsvp', eventId: id, rsvp: 'going' });
      dispatch({ type: 'eventDraft', draft: null });
      app.selectEvent(id);
      router.replace({ pathname: '/event/[id]', params: { id, published: '1' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish. Your draft is still here.');
    } finally { setBusy(false); }
  };

  if (stage === 'review' && preview) return <Page back title="Review invitation" wide fallback="/events" testID="create-review"
    footer={<>
      {error ? <Notice error icon="alert-circle">{error}</Notice> : null}
      <Button busy={busy} icon="send" testID="create-publish" onPress={() => void publish()}>{existing ? 'Save changes' : demo ? 'Publish sample invitation' : 'Publish invitation'}</Button>
      <Button tone="quiet" size="sm" onPress={() => setStage('edit')}>Keep editing</Button>
    </>}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <Tag tone="neutral">Draft</Tag>
      <Text style={type.small}>This is what guests will see. {demo ? 'Publishing here is a sample; no invitation is sent.' : 'Publishing creates the event and its invitation code.'}</Text>
    </View>
    <InvitationBody view={preview} />
  </Page>;

  return <Page back title={existing ? 'Edit event' : 'Create event'} fallback="/events" testID="create-event"
    footer={<>
      {submitted && !valid && <Notice error icon="alert-circle">{problems.title || problems.when || problems.location}</Notice>}
      <Button icon="eye" testID="create-review-button" onPress={() => { setSubmitted(true); if (valid) setStage('review'); }}>Review invitation</Button>
    </>}>
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={type.display}>{existing ? 'Change the details.' : 'Bring people together.'}</Text>
      <Text style={type.secondary}>A cover, a name and a time are enough to start. Everything else can come later.</Text>
    </View>
    <EventCover title={draft.title} theme={draft.cover} dateLabel={draft.startsAt ? formatEventDate(draft.startsAt) : 'Pick a day'} height={220} />
    <View style={{ gap: 10 }}>
      <Text style={type.label}>Cover</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
        {COVER_THEMES.map(theme => {
          const selected = theme.key === draft.cover;
          return <Pressable key={theme.key} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${theme.label} cover, ${theme.note}`}
            onPress={() => set({ cover: theme.key as CoverTheme })} testID={`cover-${theme.key}`}
            style={({ pressed }) => [{ alignItems: 'center', gap: 6 }, pressed && s.pressed]}>
            <View style={{ borderRadius: 16, padding: 3, borderWidth: 2, borderColor: selected ? colors.ink : 'transparent' }}>
              <EventCover title={draft.title || 'Aa'} theme={theme.key} height={64} scale={0.3} style={{ width: 84, borderRadius: 12 }} />
            </View>
            <Text style={[type.micro, selected && { color: colors.ink }]}>{theme.label}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </View>
    <Field label="Name" testID="create-title" value={draft.title} onChangeText={title => set({ title })} maxLength={80} placeholder="Builders, after hours"
      error={submitted ? problems.title : undefined} editable={!existing} hint={existing ? 'Names and locations are fixed once published.' : undefined} />
    <View style={{ gap: 10 }}>
      <View style={s.between}><Text style={type.label}>When</Text><Text style={type.small}>{draft.startsAt ? `${formatDateOnly(draft.startsAt)} at ${formatTimeOnly(draft.startsAt)}` : 'Day and time'}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((day, index) => {
          const selected = sameDay(day);
          return <Pressable key={day} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => pickDay(day)} testID={`day-${index}`}
            style={({ pressed }) => [{ minWidth: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, alignItems: 'center', backgroundColor: selected ? colors.ink : colors.paper, borderWidth: 1.5, borderColor: selected ? colors.ink : colors.line }, pressed && s.pressed]}>
            <Text style={[type.micro, { color: selected ? colors.cream : colors.muted }]}>{index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : new Date(day).toLocaleDateString([], { weekday: 'short' })}</Text>
            <Text style={[type.subheading, { color: selected ? colors.cream : colors.ink }]}>{new Date(day).getDate()}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TIMES.map(([hour, minute]) => {
          const selected = selectedDay !== null && selectedDay.getHours() === hour && selectedDay.getMinutes() === minute;
          const label = new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          return <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => pickTime(hour, minute)}
            style={({ pressed }) => [{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: selected ? colors.powder : colors.paper, borderWidth: 1.5, borderColor: selected ? colors.powder : colors.line }, pressed && s.pressed]}>
            <Text style={type.smallStrong}>{label}</Text>
          </Pressable>;
        })}
      </View>
      {submitted && problems.when ? <Text style={[type.small, { color: colors.danger }]}>{problems.when}</Text> : null}
    </View>
    <Field label="Where" testID="create-location" value={draft.location} onChangeText={location => set({ location })} maxLength={120} placeholder="The Studio, 18th Street" error={submitted ? problems.location : undefined} editable={!existing} />
    <Field label="Address" optional value={draft.address} onChangeText={address => set({ address })} maxLength={160} placeholder="Shown to guests who are going" />
    <Field label="What’s it for?" optional value={draft.purpose} onChangeText={purpose => set({ purpose })} maxLength={140} placeholder="Meet two or three people worth a second conversation." />
    <Field label="Description" optional multiline value={draft.description} onChangeText={description => set({ description })} maxLength={600} placeholder="Who should come, what to bring, what to expect." />
    <View style={{ gap: 8 }}>
      <Text style={type.label}>Who can find it</Text>
      <Segmented<Visibility> label="Visibility" value={draft.visibility} onChange={visibility => set({ visibility })} options={[{ key: 'invite', label: 'Invite only' }, { key: 'open', label: 'Anyone with the link' }]} />
    </View>
    <Field label="A prompt for guests" optional value={draft.prompt} onChangeText={prompt => set({ prompt })} maxLength={140} placeholder="What did you build this month that surprised you?"
      hint="Glance offers it as a conversation starter at the event." />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="info" size={14} color={colors.muted} /><Text style={[type.small, { flex: 1 }]}>New events start with Glance off for everyone. Guests turn it on themselves when they arrive.</Text>
    </View>
    {demo && <SampleTag>Sample · publishing stays on this device</SampleTag>}
  </Page>;
}

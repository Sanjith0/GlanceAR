import React, { useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon, Notice, Page, SampleTag, Tag, Wordmark } from '../components';
import { colors, radius, s, type } from '../theme';
import { Sheet } from '../ui/Sheet';
import { PersonCard } from '../ui/PersonCard';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { useEventViews, useMe } from '../services/views';
import { useAuth } from '../services/session';
import { useDemoMode } from '../services/demoMode';
import { useOperation } from '../ui/shared';

function Row({ icon, title, text, right, onPress, testID }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; text?: string; right?: React.ReactNode; onPress?: () => void; testID?: string }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} testID={testID}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, pressed && onPress && s.pressed]}>
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.powderLight, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={16} /></View>
    <View style={{ flex: 1, minWidth: 0, gap: 1 }}><Text style={type.subheading}>{title}</Text>{text ? <Text style={type.small}>{text}</Text> : null}</View>
    {right ?? (onPress ? <Icon name="chevron-right" size={18} color={colors.faint} /> : null)}
  </Pressable>;
}

/** Profile, face enrollment, recognition preferences and the lightweight device entry. */
export function You() {
  const app = useGlance();
  const me = useMe();
  const demo = useDemoMode();
  const { state, dispatch } = useAppStore();
  const { signOut } = useAuth();
  const { events } = useEventViews();
  const { busy, perform } = useOperation();
  const [removing, setRemoving] = useState(false);
  const enrollment = state.enrollment;
  const onEvents = events.filter(e => !e.past && e.joined && (app.demoState ? app.demoState.eventPermissions[e.id]?.includes(me?.id ?? '') : false));
  if (!me) return <Page><Wordmark /></Page>;
  return <Page testID="you">
    <View style={s.between}><Text accessibilityRole="header" style={type.display}>You</Text><Wordmark size={22} /></View>
    <PersonCard person={me} caption="How attendees see you" footer={<Button tone="secondary" size="sm" icon="edit-2" testID="you-edit" onPress={() => router.push('/edit-profile')}>Edit profile</Button>} />
    {app.error ? <Notice error icon="alert-circle">{app.error}</Notice> : null}

    <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 8 }}>
      <Row icon="aperture" title="Face scan" testID="you-face"
        text={enrollment.status === 'enrolled' ? `Saved ${enrollment.enrolledAt ? new Date(enrollment.enrolledAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}. Lets people recognize you only at events where Glance is on.` : 'Not set up. Without it, people can’t recognize you at events.'}
        right={<Tag tone={enrollment.status === 'enrolled' ? 'green' : 'neutral'}>{enrollment.status === 'enrolled' ? (enrollment.sample ? 'Sample' : 'Saved') : 'Off'}</Tag>} />
      <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
        <View style={{ flex: 1 }}><Button tone="ghost" size="sm" icon="refresh-cw" testID="you-rescan" onPress={() => router.push('/face')}>{enrollment.status === 'enrolled' ? 'Scan again' : 'Set up'}</Button></View>
        {enrollment.status === 'enrolled' && <View style={{ flex: 1 }}><Button tone="ghost" size="sm" icon="trash-2" testID="you-remove-scan" onPress={() => setRemoving(true)}>Remove</Button></View>}
      </View>
    </View>

    <View style={{ gap: 10 }}>
      <Text style={type.heading}>Recognition</Text>
      <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 4 }}>
        <Row icon="users" title="Recognize me by default" text="Turn Glance on automatically when I RSVP to an event."
          right={<Switch accessibilityLabel="Recognize me by default" value={state.preferences.recognizeByDefault} onValueChange={value => dispatch({ type: 'preferences', patch: { recognizeByDefault: value } })}
            trackColor={{ true: colors.ink, false: colors.lineStrong }} thumbColor={colors.cream} />} />
        <Row icon="message-circle" title="Show conversation starters" text="Suggest something to say when someone is recognized."
          right={<Switch accessibilityLabel="Show conversation starters" value={state.preferences.showStarters} onValueChange={value => dispatch({ type: 'preferences', patch: { showStarters: value } })}
            trackColor={{ true: colors.ink, false: colors.lineStrong }} thumbColor={colors.cream} />} />
        {onEvents.length > 0 && <View style={{ paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Text style={type.small}>Glance is on for</Text>
          {onEvents.map(event => <View key={event.id} style={[s.between, { gap: 10 }]}>
            <Text numberOfLines={1} style={[type.body, { flex: 1 }]}>{event.title}</Text>
            <Button tone="ghost" size="sm" icon="pause" busy={busy} onPress={() => void perform(async () => { app.selectEvent(event.id); await app.setEventPermission(event.id, false); })}>Pause</Button>
          </View>)}
        </View>}
      </View>
      <Text style={type.small}>Your face scan is account-level. Being recognizable at a particular event is a separate choice you make at each event, and you can pause it any time.</Text>
    </View>

    <View style={{ gap: 10 }}>
      <Text style={type.heading}>Devices</Text>
      <View style={{ backgroundColor: colors.paper, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 4 }}>
        <Row icon="smartphone" title="This phone" text="Recognition and the three-finger finish run here." right={<Tag tone="green">Ready</Tag>} />
        <Row icon="eye" title="Meta glasses" text={app.mode === 'live' && Platform.OS === 'ios' ? 'Choose the glasses harness at an event before pairing.' : 'Optional. Glance works fully on your phone without them.'}
          right={<Tag tone="neutral">{app.mode === 'live' && Platform.OS === 'ios' && app.captureSource === 'glasses' ? 'Selected' : 'Not connected'}</Tag>} />
      </View>
    </View>

    <View style={{ gap: 8 }}>
      {[
        'Your portrait is a profile picture. It is never used for matching.',
        'Only a separate face scan can be recognized, and only by attendees of events where you turn Glance on.',
        'Conversations are recorded only after you start one with another attendee who has Glance on. Either of you can stop without sharing.',
      ].map(line => <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}><Icon name="shield" size={14} color={colors.muted} /><Text style={[type.small, { flex: 1 }]}>{line}</Text></View>)}
    </View>
    {demo && <SampleTag>Sample account · changes reset on reload</SampleTag>}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button tone="quiet" size="sm" icon="log-out" testID="you-logout" onPress={() => void signOut()}>Log out</Button>
      <Button tone="quiet" size="sm" icon="tool" testID="you-dev" onPress={() => router.push('/dev')}>Developer</Button>
    </View>

    <Sheet open={removing} onClose={() => setRemoving(false)} title="Remove your face scan?"
      footer={<>
        <Button tone="danger" icon="trash-2" testID="confirm-remove-scan" busy={busy} onPress={() => void perform(async () => {
          await app.deleteFaceScan(me.id);
          dispatch({ type: 'enrollment', enrollment: { status: 'none', sample: false } });
          setRemoving(false);
        })}>Remove scan</Button>
        <Button tone="ghost" onPress={() => setRemoving(false)}>Keep it</Button>
      </>}>
      <Text style={type.body}>People won’t be able to recognize you at any event until you scan again. Your portrait, profile and connections stay as they are.</Text>
    </Sheet>
  </Page>;
}

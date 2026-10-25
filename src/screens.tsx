import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation, usePreventRemove } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait, Wordmark } from './components';
import { colors, fonts, s } from './theme';
import { deploymentURL, useGlance } from './state';
import { isAudioCaptureAvailable } from './capture/audio';
const firstName = (name: string) => name.split(' ')[0];
import { samplePeople } from './demo';
import type { Conversation, Profile } from './domain';
import { useConversationCapture } from './useConversationCapture';
import GestureCapture, { copyPrivateSetupJSON } from './capture/GestureCapture';
import { cancelLiveCameraHandoff } from './capture/liveCameraStream';
import { glassesShellAvailable, setCameraDevice, useCameraDevice, type CameraDevice } from './capture/glassesBridge';
import { ConversationChat } from './ConversationChat';
import {
  beginConnectionFinish, completeConnectionAcknowledgment, CONNECTION_ACKNOWLEDGMENT_MS,
  reconcileConnectionFeedback, settleConnectionFinish, type ConnectionFeedback,
} from './connectionFeedback';

export function useScreenFocused() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}
export function useOperation() {
  const { run } = useGlance();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const perform = useCallback(async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await run(fn); } catch { /* The shared status region shows the failure. */ }
    finally { running.current = false; setBusy(false); }
  }, [run]);
  return { busy, perform };
}
export function GlobalStatus() {
  const app = useGlance();
  return <>
    {app.error ? <View style={[s.status, s.error, s.row]}>
      <Text accessibilityRole="alert" style={[s.small, s.grow, { color: colors.danger }]}>{app.error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={app.clearError}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" color={colors.danger} size={18} /></Pressable>
    </View> : null}
    {app.loading && !app.snapshot ? <ActivityIndicator color={colors.blue} /> : null}
    {app.needsEnrollment && <View style={s.soft}><Text style={s.heading}>Make your introduction.</Text>
      <Text style={s.muted}>Add a portrait and your name before you join an event.</Text>
      <Button onPress={() => router.push('/enroll')} icon="user-plus">Create your profile</Button></View>}
  </>;
}
export function DemoBanner({ actors = false }: { actors?: boolean }) {
  const { mode, snapshot, switchActor, demoSummaries } = useGlance();
  if (mode !== 'demo') return null;
  return <View style={{ gap: 10 }}>
    <View style={[s.row, { flexWrap: 'wrap' }]}><Badge>INTERACTIVE PREVIEW</Badge><Text style={s.small}>{demoSummaries ? 'Records conversations for real summaries' : 'No audio recorded'}</Text></View>
    {actors && <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 12, gap: 9 }}>
      <Text style={s.small}>Preview the same chat from either person’s side.</Text>
      <View style={s.row}>{samplePeople.map(p => <Pressable key={p.id} accessibilityRole="button"
        accessibilityLabel={`Switch to ${p.name}`} onPress={() => switchActor(p.id)}
        style={({ pressed }) => [{ flex: 1, padding: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: snapshot?.me.id === p.id ? colors.paper : 'transparent',
          borderWidth: 1, borderColor: snapshot?.me.id === p.id ? colors.blue : colors.line }, pressed && s.pressed]}>
        <Portrait person={p} size={28} /><Text style={[s.small, { color: colors.ink, fontFamily: fonts.medium }]}>{p.name.split(' ')[0]}</Text>
        {snapshot?.me.id === p.id && <Icon name="check" size={13} color={colors.blue} />}
      </Pressable>)}</View>
    </View>}
  </View>;
}
function PersonRow({ person, approved, label }: { person: Profile; approved?: boolean; label?: string }) {
  return <View style={s.row}><Portrait person={person} /><View style={s.grow}>
    <Text style={s.label}>{person.name}</Text><Text style={s.small}>{label ?? person.role}</Text>
  </View>{approved !== undefined && <Icon name={approved ? 'check-circle' : 'circle'} size={21} color={approved ? colors.green : colors.line} />}</View>;
}
function ConversationLink({ conversation }: { conversation: Conversation }) {
  const { snapshot } = useGlance();
  const other = conversation.participants.find(p => p.id !== snapshot?.me.id);
  if (!other) return null;
  const shared = Boolean(conversation.connectedAt) || conversation.status === 'shared';
  const status = conversation.status === 'shared' ? 'Your shared recap and chat' : ({
    consent: 'Getting ready to capture', recording: 'Conversation in progress',
    ended: shared ? 'Connected · preparing your recap' : 'Stopped without connecting', processing: 'Connected · preparing your recap',
    failed: 'Needs your attention', cancelled: 'Conversation cancelled', shared: 'Your shared recap is ready',
  })[conversation.status];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${shared ? 'Open chat with' : 'Open conversation with'} ${other.name}`}
    onPress={() => router.push(shared ? `/recap/${conversation.id}` : `/conversation/${conversation.id}`)}
    style={({ pressed }) => [s.card, s.row, pressed && s.pressed]}>
    <Portrait person={other} /><View style={s.grow}><Text style={s.label}>{other.name}</Text><Text style={s.small}>{status}</Text></View>
    <Icon name={shared ? 'arrow-up-right' : 'chevron-right'} color={colors.blue} size={20} />
  </Pressable>;
}

export function EventsScreen() {
  const app = useGlance();
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [title, setTitle] = useState(''), [location, setLocation] = useState(''), [code, setCode] = useState('');
  const { busy, perform } = useOperation();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(undefined); }, [selectEvent]));
  const openEvent = (id: string) => { app.selectEvent(id); router.push(`/event/${id}`); };
  const active = app.snapshot?.conversations.filter(c => !c.connectedAt && ['consent', 'recording'].includes(c.status)) ?? [];
  return <Page>
    <View style={s.between}><Wordmark /><Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => router.push('/profile')}>
      {app.snapshot ? <Portrait person={app.snapshot.me} size={40} /> : <Icon name="user" />}</Pressable></View>
    <View style={{ gap: 10, paddingTop: 12, paddingBottom: 4 }}>
      <Text style={[s.title, { fontSize: 36, lineHeight: 43, letterSpacing: -1.4 }]}>Be here.{'\n'}Remember later.</Text>
      <Text style={s.muted}>Good conversations deserve more than{'\n'}a name you almost remember.</Text>
    </View>
    <DemoBanner />
    <GlobalStatus />
    {active.map(c => <ConversationLink key={c.id} conversation={c} />)}
    <View style={s.between}><Text style={s.heading}>Your events</Text><Text style={s.small}>{app.snapshot?.events.length ?? 0} joined</Text></View>
    {app.snapshot?.events.map(event => <View key={event.id} style={[s.card, { padding: 0, overflow: 'hidden' }]}>
      <View style={{ backgroundColor: colors.blueLight, padding: 22, minHeight: 146, justifyContent: 'space-between', gap: 18 }}>
        <View style={s.between}><Text style={[s.eyebrow, { color: colors.blue }]}>{app.mode === 'demo' ? 'A LITTLE LESS SMALL TALK' : 'MEET IN PERSON'}</Text>
          <Icon name="arrow-up-right" color={colors.blue} size={25} /></View>
        <Text style={[s.title, { fontSize: 27, lineHeight: 33, maxWidth: 280 }]}>{event.title}</Text>
      </View>
      <View style={{ padding: 20, gap: 19 }}>
        <View style={s.row}><Icon name="map-pin" color={colors.muted} size={16} /><Text style={s.muted}>{event.location || 'Location shared by your host'}</Text></View>
        {app.mode === 'demo' && event.id === 'builders' && <View style={s.row}>
          <View style={{ flexDirection: 'row' }}><Portrait person={samplePeople[0]} size={34} /><View style={{ marginLeft: -7, borderWidth: 2, borderColor: colors.paper, borderRadius: 13 }}><Portrait person={samplePeople[1]} size={30} /></View></View>
          <Text style={s.small}>Two sample people. One good conversation.</Text>
        </View>}
        <Button onPress={() => openEvent(event.id)} icon="arrow-right">Enter event</Button>
      </View>
    </View>)}
    {app.snapshot && !app.snapshot.events.length && <Empty icon="calendar" title="Your room is waiting." text="Create an event or enter an invitation code to find your people." />}
    {!app.needsEnrollment && <View style={s.row}>
      <View style={s.grow}><Button tone="ghost" icon="log-in" onPress={() => setForm(form === 'join' ? null : 'join')}>Join with code</Button></View>
      <View style={s.grow}><Button tone="ghost" icon="plus" onPress={() => setForm(form === 'create' ? null : 'create')}>Create event</Button></View>
    </View>}
    {form && <View style={s.card}>
      <View style={s.between}><Text style={s.heading}>{form === 'create' ? 'Bring people together.' : 'You’re invited.'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close event form" onPress={() => setForm(null)} style={{ padding: 8 }}><Icon name="x" /></Pressable></View>
      {form === 'create' ? <>
        <Field label="Event name" value={title} onChangeText={setTitle} maxLength={100} placeholder="An evening with builders" />
        <Field label="Location" value={location} onChangeText={setLocation} maxLength={160} placeholder="Where are you meeting?" />
        <Button busy={busy} onPress={() => void perform(async () => openEvent(await app.createEvent(title, location)))}>Create your event</Button>
      </> : <>
        <Field label="Invitation code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={24} placeholder={app.mode === 'demo' ? 'Try GL26' : 'Enter the host’s code'} />
        <Button busy={busy} onPress={() => void perform(async () => openEvent(await app.joinEvent(code)))}>Join event</Button>
      </>}
    </View>}
    <View style={[s.row, { paddingVertical: 2, alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
      <Text style={[s.small, s.grow]}>Your portrait helps people remember you. It isn’t used for face recognition.</Text></View>
  </Page>;
}

export function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const focused = useScreenFocused();
  const navigating = useRef(false);
  const visited = useRef(new Set<string>());
  const setupAttempted = useRef(false);
  const entryGeneration = useRef(0);
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => {
    entryGeneration.current++;
    selectEvent(id);
    navigating.current = false;
    return () => { entryGeneration.current++; };
  }, [id, selectEvent]));
  const event = app.snapshot?.events.find(e => e.id === id);
  const selected = app.snapshot?.event?.id === id;
  const eventMembers = app.snapshot?.members;
  const meId = app.snapshot?.me.id;
  const members = useMemo(() => selected ? eventMembers?.filter(p => p.id !== meId) ?? [] : [], [selected, eventMembers, meId]);
  const enabled = selected && Boolean(app.snapshot?.eventPermission?.enabled);
  const active = app.snapshot?.conversations.find(c => c.eventId === id && c.consentMode === 'event' && ['consent', 'recording'].includes(c.status));
  const source = active && active.recorderId === meId ? active.captureSource ?? 'phone' : app.captureSource;
  // Phones and browsers both record with their own microphone in live mode.
  const nativePhone = app.mode === 'live' && source === 'phone' && (Platform.OS !== 'web' || isAudioCaptureAvailable());
  const captureReady = !nativePhone || app.phoneCaptureReady;
  const { phoneCaptureReady, preparePhoneCapture, run } = app;
  const pairAttendee = app.pair;
  const { client, token, mode, demo } = app;
  const pair = useCallback(async (personId: string) => {
    if (navigating.current) return;
    navigating.current = true;
    const generation = entryGeneration.current;
    try {
      const next = await pairAttendee(id, personId);
      if (generation !== entryGeneration.current) {
        if (mode === 'demo') demo({ type: 'cancel', id: next });
        else await client!.cancel(token, next);
        return;
      }
      visited.current.add(next);
      router.push(`/conversation/${next}`);
    }
    catch (error) { navigating.current = false; throw error; }
  }, [pairAttendee, id, mode, demo, client, token]);
  useEffect(() => {
    if (!focused || !enabled || !nativePhone || phoneCaptureReady || setupAttempted.current) return;
    setupAttempted.current = true;
    void run(preparePhoneCapture).catch(() => {});
  }, [focused, enabled, nativePhone, phoneCaptureReady, run, preparePhoneCapture]);
  useEffect(() => {
    if (!focused || !enabled || !captureReady || navigating.current) return;
    if (active && !visited.current.has(active.id)) {
      visited.current.add(active.id);
      navigating.current = true;
      router.push(`/conversation/${active.id}`);
      return;
    }
    // Encounters start only from LIVE Camera (or an explicit pair button), never on entry.
  }, [focused, enabled, captureReady, active]);
  const enable = async () => {
    const generation = entryGeneration.current;
    if (nativePhone) await app.preparePhoneCapture();
    if (generation !== entryGeneration.current) return;
    await app.setEventPermission(id, true);
  };
  return <Page back title="Your event">
    <DemoBanner /><GlobalStatus />
    {event ? <>
      <View style={{ gap: 12 }}><Badge>YOU’RE IN</Badge><Text style={s.title}>{event.title}</Text>
        <View style={s.row}><Icon name="map-pin" color={colors.muted} size={17} /><Text style={s.muted}>{event.location || 'Location shared by the host'}</Text></View></View>
      <View style={[s.soft, { gap: 14 }]}>
        <View style={s.between}><Text style={s.heading}>{enabled ? 'Glance is on.' : 'Be present. We’ll keep the details.'}</Text><Icon name={enabled ? 'radio' : 'mic'} color={colors.blue} /></View>
        <Text style={s.muted}>{enabled ? 'Ready for your next conversation. No Start button, and no extra confirmation at the end.' : 'Enable Glance once for this event, then let the conversations happen.'}</Text>
        <Text style={s.small}>Enabling Glance permits recording your paired conversations with other enabled attendees. Either participant’s finish gesture or Finish &amp; connect button creates the connection and shares both portraits, a chat, and the same recap. Audio is sent to Meta’s model API to prepare the recap. You can pause Glance or stop without sharing at any time.</Text>
        {app.mode === 'demo' && <Text style={[s.small, { color: colors.blue }]}>{app.demoSummaries
          ? 'Sample attendees, real devices: LIVE Camera and hand gestures use your camera on this device, and each conversation records your microphone until you finish. Finishing sends that audio to Meta, through your local backend, for a speaker-separated summary; nothing is stored.'
          : 'Encounters and recaps here are samples, with no microphone active. LIVE Camera and hand-gesture detection use your real camera, on this device only.'}</Text>}
        {enabled && <Button icon="camera" onPress={() => router.push(`/register/${id}`)}>LIVE Camera</Button>}
        {enabled
          ? <Button tone="secondary" icon="pause" busy={busy} onPress={() => void perform(() => app.setEventPermission(id, false))}>Pause Glance for this event</Button>
          : <Button icon="check" busy={busy} onPress={() => void perform(enable)}>Enable Glance for this event</Button>}
        {enabled && nativePhone && !app.phoneCaptureReady && <Button tone="ghost" busy={busy} onPress={() => void perform(app.preparePhoneCapture)}>{Platform.OS === 'web' ? 'Prepare this device' : 'Prepare this iPhone'}</Button>}
      </View>
      {app.mode === 'live' && Platform.OS === 'ios' && !active && <View style={s.card}>
        <Text style={s.label}>Your capture setup</Text>
        <Text style={s.small}>Choose before pairing. The separate glasses harness and this app must never record the same conversation together.</Text>
        <View style={s.row}>
          <View style={s.grow}><Button disabled={busy || app.captureChoiceLocked} tone={app.captureSource === 'phone' ? 'primary' : 'secondary'} onPress={() => app.setCaptureSource('phone')}>iPhone camera</Button></View>
          <View style={s.grow}><Button disabled={busy || app.captureChoiceLocked} tone={app.captureSource === 'glasses' ? 'primary' : 'secondary'} onPress={() => app.setCaptureSource('glasses')}>Glasses harness</Button></View>
        </View>
      </View>}
      <View style={[s.soft, s.between]}><View style={{ gap: 4 }}><Text style={s.small}>INVITE A FRIEND</Text><Text selectable style={[s.heading, { letterSpacing: 2 }]}>{event.inviteCode}</Text></View><Icon name="key" color={colors.blue} /></View>
      <View style={s.divider} />
      <Text style={s.heading}>People in the room</Text>
      <Text style={s.muted}>{app.mode === 'demo' ? 'Nothing starts on its own. Open LIVE Camera and hold two registered faces in view for the 3-2-1, or use Simulate next encounter below.' : 'Open LIVE Camera to recognize attendees who added a face scan. Selecting a profile below remains the fallback.'}</Text>
      {members.map(person => <View key={person.id} style={s.card}><PersonRow person={person} label={person.glanceEnabled ? 'Glance enabled for this event' : 'Glance is paused'} />
        <Button busy={busy} disabled={!enabled || !person.glanceEnabled || !captureReady || (app.mode === 'live' && Platform.OS === 'web')}
          tone="secondary" icon="message-circle" onPress={() => void perform(() => pair(person.id))}>{app.mode === 'demo' ? 'Simulate next encounter' : `Pair with ${person.name.split(' ')[0]}`}</Button>
      </View>)}
      {!members.length && <Empty icon="users" title="Be the first hello." text="Share the invitation code. Other people appear here after they join with their own profile." />}
      {app.snapshot?.conversations.filter(c => c.eventId === id && c.status !== 'cancelled').map(c => <ConversationLink key={c.id} conversation={c} />)}
      {app.mode === 'live' && Platform.OS === 'web' && <Notice>The browser can participate and receive chats, but cannot record. Pair from the recording iPhone and keep this participant’s conversation open.</Notice>}
    </> : !app.loading && <Empty icon="calendar" title="Event unavailable" text="Go back to your events, or join with an invitation code." />}
  </Page>;
}

export function ConnectionsScreen() {
  const app = useGlance();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(undefined); }, [selectEvent]));
  const conversations = app.snapshot?.conversations.filter(c => c.status !== 'cancelled' && (c.connectedAt || c.status === 'shared')) ?? [];
  return <Page><View style={{ gap: 9 }}><Text style={s.title}>More than a hello.</Text><Text style={s.muted}>The people, ideas, and next steps you want to keep.</Text></View>
    <DemoBanner /><GlobalStatus />
    {conversations.map(c => <ConversationLink key={c.id} conversation={c} />)}
    {!conversations.length && <><Empty icon="message-circle" title="Your next connection starts in person." text="Enter an event, have a conversation, and finish with the three-finger gesture. Your shared chat will be right here." />
      <Button onPress={() => router.push('/events')} icon="arrow-right">Find your event</Button></>}
  </Page>;
}

export function ProfileScreen() {
  const app = useGlance();
  return <Page><View style={s.between}><Text style={s.title}>Your introduction.</Text><Icon name="user" color={colors.blue} /></View>
    <DemoBanner actors /><GlobalStatus />
    {app.snapshot && <View style={[s.card, { alignItems: 'center', paddingVertical: 26 }]}>
      <Portrait person={app.snapshot.me} size={94} /><Text style={s.heading}>{app.snapshot.me.name}</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{app.snapshot.me.role}</Text>
      <Button tone="secondary" icon="edit-2" onPress={() => router.push('/enroll')}>Edit your profile</Button>
    </View>}
    <Text style={s.heading}>Presence, with permission.</Text>
    {[
      { icon: 'image' as const, title: 'Your portrait, plus an optional face scan', text: 'Your portrait is never used for matching. If you add a face scan in LIVE Camera, attendees of events where you turn Glance on can recognize you. You can delete it any time; faces without a scan are never identified.' },
      { icon: 'mic' as const, title: 'Permission once, at event entry', text: 'Each attendee enables recording and automatic connection sharing for that event. Either person’s finish signal connects you under those standing permissions, without another approval screen.' },
      { icon: 'stop-circle' as const, title: 'Finish and connect, or just stop', text: 'The finish gesture or Finish & connect button opens your chat. Stop without sharing does not create a connection. Remote stopping depends on connectivity; a short native consent lease is the fallback.' },
    ].map(item => <View key={item.title} style={[s.row, { alignItems: 'flex-start' }]}><View style={{ padding: 10, backgroundColor: colors.blueLight, borderRadius: 12 }}><Icon name={item.icon} color={colors.blue} /></View>
      <View style={[s.grow, { gap: 5 }]}><Text style={s.label}>{item.title}</Text><Text style={s.small}>{item.text}</Text></View></View>)}
    <View style={s.divider} />
    <View style={{ gap: 9 }}><Text style={s.label}>Build status</Text>
      <Text style={s.small}>Browser hand detection uses your real camera. {app.demoSummaries ? 'The preview also records conversations through your browser microphone for summaries via your local backend.' : 'The sample walkthrough never records audio.'} In live mode, the recording device uses its own microphone, in Safari, Chrome or the iPhone development build (not Expo Go). The separate Meta DAT harness and updated iPhone gesture overlays still need physical-device testing.</Text>
      <Button tone="ghost" onPress={() => app.setMode(app.mode === 'demo' ? 'live' : 'demo')}>
        {app.mode === 'demo' ? 'Switch to configured backend' : 'Explore sample walkthrough'}
      </Button>
    </View>
    {app.mode === 'demo' && <Text style={s.small}>Sample identities and AI-generated portraits are fictional. The sample recap is scripted. Nothing in this preview is recorded, transcribed, or sent to another person. Preview changes reset when you reload.</Text>}
  </Page>;
}

export function EnrollmentScreen() {
  const app = useGlance(), { busy, perform } = useOperation();
  const [name, setName] = useState(app.snapshot?.me.name ?? '');
  const [role, setRole] = useState(app.snapshot?.me.role ?? '');
  const [photo, setPhoto] = useState(app.snapshot?.me.photoUrl ?? '');
  const [accepted, setAccepted] = useState(Boolean(app.snapshot));
  const takePhoto = () => perform(async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Camera permission is off. Enable it in Settings to take your attendee portrait.');
    }
    const result = Platform.OS === 'web' ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }) :
      await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const image = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 384 } }],
      { format: ImageManipulator.SaveFormat.JPEG, compress: 0.65, base64: true });
    if (!image.base64) throw new Error('Could not prepare that portrait. Please try again.');
    const value = `data:image/jpeg;base64,${image.base64}`;
    if (value.length > 350000) throw new Error('That portrait is too large. Try a simpler background.');
    setPhoto(value);
  });
  return <Page back title="Your profile"><Text style={s.title}>A face to remember.</Text><Text style={s.muted}>Let the people you meet put a face to your name. Your portrait stays separate from the recording.</Text>
    <GlobalStatus />
    <View style={[s.card, { alignItems: 'center', paddingVertical: 25 }]}>
      {photo ? <Portrait person={{ id: 'preview', name: name || 'Your', role, photoUrl: photo }} size={104} /> :
        <View style={{ width: 104, height: 104, backgroundColor: colors.blueLight, borderRadius: 32, alignItems: 'center', justifyContent: 'center' }}><Icon name="camera" size={34} color={colors.blue} /></View>}
      <Button tone="secondary" busy={busy} onPress={() => void takePhoto()} icon="camera">{photo ? 'Replace portrait' : Platform.OS === 'web' ? 'Choose your portrait' : 'Take your portrait'}</Button>
      <Text style={s.small}>Required to join. Never used for face matching.</Text>
    </View>
    <Field label="Your name" value={name} onChangeText={setName} maxLength={80} placeholder="How should people remember you?" autoComplete="name" />
    <Field label="One-line introduction" value={role} onChangeText={setRole} maxLength={120} placeholder="What are you curious about?" />
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} accessibilityLabel="Allow event members to see your profile portrait"
      onPress={() => setAccepted(!accepted)} style={[s.row, { alignItems: 'flex-start', paddingVertical: 7 }]}>
      <Icon name={accepted ? 'check-square' : 'square'} color={colors.blue} />
      <Text style={[s.small, s.grow]}>Members of events I join can see this name and portrait. Recording and automatic recap sharing are enabled separately, once at event entry.</Text>
    </Pressable>
    <Button busy={busy} disabled={!accepted || !photo || !name.trim()} onPress={() => void perform(async () => {
      await app.saveProfile({ name: name.trim(), role: role.trim(), photoUrl: photo }); router.replace('/events');
    })}>Save your introduction</Button>
  </Page>;
}

/** Shown only inside the Glance Glasses Live iPhone shell. Recognition stays on the iPhone camera. */
function CameraPicker({ value, onChange }: { value: CameraDevice; onChange: (device: CameraDevice) => void }) {
  const options: { device: CameraDevice; label: string }[] = [{ device: 'phone', label: 'iPhone camera' }, { device: 'glasses', label: 'Ray-Ban Meta' }];
  return <View style={{ gap: 6 }}>
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.line }}>
      {options.map(option => {
        const selected = option.device === value;
        return <Pressable key={option.device} testID={`camera-${option.device}`} accessibilityRole="radio" accessibilityState={{ selected }}
          onPress={() => onChange(option.device)}
          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: selected ? colors.paper : 'transparent' }}>
          <Text style={{ fontFamily: selected ? fonts.bold : fonts.medium, fontSize: 14, color: selected ? colors.ink : colors.muted }}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    {value === 'glasses' && <Text style={s.small}>The glasses camera is used only for the finish gesture. Face recognition always uses the iPhone camera.</Text>}
  </View>;
}

function GlassesHandoff({ conversation }: { conversation: Conversation }) {
  const app = useGlance();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { setRevealed(false); setCopyNotice(''); }
    });
    return () => listener.remove();
  }, []);
  if (Platform.OS !== 'ios' || app.mode !== 'live' || app.snapshot?.me.id !== conversation.recorderId || conversation.status !== 'consent') return null;
  return <View style={{ gap: 10 }}>
    <Button tone="ghost" icon="external-link" onPress={() => { setOpen(!open); setRevealed(false); setCopyNotice(''); }}>Use the separate glasses harness</Button>
    {open && <View style={s.card}><Text style={s.label}>Private device handoff</Text>
      <Text style={s.small}>This setup contains your device credential. Copy it only into your own Glance DAT Harness. Never share it, include it in screenshots, or paste it into a website. This app’s recorder is disabled for this handoff.</Text>
      {!revealed ? <Button tone="secondary" onPress={() => setRevealed(true)}>Reveal private setup secret</Button> : <>
        <Text selectable style={[s.small, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : undefined, color: colors.ink }]}>{JSON.stringify({
          deploymentURL, token: app.token, eventId: conversation.eventId, conversationId: conversation.id,
        })}</Text>
        <Button tone="secondary" icon="copy" busy={copying} onPress={() => {
          setCopying(true);
          void copyPrivateSetupJSON(JSON.stringify({ deploymentURL, token: app.token, eventId: conversation.eventId, conversationId: conversation.id }))
            .then(copied => setCopyNotice(copied
              ? 'Copied for 60 seconds on this iPhone only. Paste into your own harness now.'
              : 'Automatic copy is unavailable. Select and copy the complete JSON above.'))
            .catch(() => setCopyNotice('Could not copy. Select and copy the complete JSON above.'))
            .finally(() => setCopying(false));
        }}>Copy setup JSON</Button>
        {copyNotice ? <Text style={s.small}>{copyNotice}</Text> : null}
      </>}
      <Text style={s.small}>Keep the harness foregrounded and the other participant’s Glance conversation open. Authorize the harness microphone and connect the glasses there; capture then starts automatically when both accounts are ready. Adventurer camera capability still needs hardware verification.</Text>
    </View>}
  </View>;
}

export function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const focused = useScreenFocused();
  const navigation = useNavigation();
  const conversation = app.snapshot?.conversations.find(c => c.id === id);
  const isRecorder = conversation?.recorderId === app.snapshot?.me.id;
  const harness = app.mode === 'live' && isRecorder && conversation?.captureSource === 'glasses';
  const capture = useConversationCapture(conversation, { enabled: !harness });
  const start = useRef(capture.start);
  useLayoutEffect(() => { start.current = capture.start; }, [capture.start]);
  const attempted = useRef(new Set<string>());
  const [clock, setClock] = useState(() => Date.now()), [cameraStatus, setCameraStatus] = useState('');
  const cameraDevice = useCameraDevice();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [feedbackState, setFeedbackState] = useState<ConnectionFeedback>({ id, phase: 'idle' });
  const finishInFlight = useRef<string | null>(null);
  const connected = Boolean(conversation && conversation.status !== 'cancelled'
    && (conversation.connectedAt || conversation.status === 'shared'));
  const feedback = useMemo(() => reconcileConnectionFeedback(feedbackState, {
    id, connected, recording: conversation?.status === 'recording', visible: focused && foreground,
    cancelled: conversation?.status === 'cancelled',
  }), [feedbackState, id, connected, conversation?.status, focused, foreground]);
  // Guarded render-time reconciliation avoids painting chat before its green
  // acknowledgment, without an effect-triggered render cascade.
  if (feedback !== feedbackState) setFeedbackState(feedback);
  useEffect(() => {
    if (feedback.phase !== 'confirmed' || !connected || !focused || !foreground) return;
    const timer = setTimeout(() => setFeedbackState(state => state.id === id
      ? completeConnectionAcknowledgment(state) : state), CONNECTION_ACKNOWLEDGMENT_MS);
    return () => clearTimeout(timer);
  }, [feedback.phase, connected, focused, foreground, id]);
  useEffect(() => () => { cancelLiveCameraHandoff(`conversation:${id}`); }, [id]);
  const finish = async (method: 'gesture' | 'finish_button') => {
    if (harness || !focused || !foreground || connected || capture.busy || finishInFlight.current === id
      || (conversation?.status !== 'recording' && !capture.hasUpload)) return;
    finishInFlight.current = id; // Synchronous latch; a second detector callback cannot submit.
    setFeedbackState(state => state.id === id ? beginConnectionFinish(state) : state);
    try {
      if (feedback.phase === 'retry' && capture.hasUpload) await capture.retryUpload();
      else await capture.stop(method);
    } finally {
      if (finishInFlight.current === id) finishInFlight.current = null;
      setFeedbackState(state => state.id === id ? settleConnectionFinish(state) : state);
    }
  };
  // Live: each camera sees only the other person, so each phone reports the hand it
  // saw. The connection finishes once both cameras saw a hand within a few seconds.
  const liveHands = app.mode === 'live' && !harness;
  const meId = app.snapshot?.me.id, otherId = conversation?.participants.find(p => p.id !== meId)?.id;
  const [handRearm, setHandRearm] = useState(0);
  const signalHand = async () => {
    if (!app.client || connected || conversation?.status !== 'recording') return;
    try {
      const { both } = await app.client.signalHand(app.token, id);
      if (both) { void finish('gesture'); return; }
    } catch { /* keep watching; the button still works */ }
    setTimeout(() => setHandRearm(n => n + 1), 1_200);
  };
  const myHandAt = meId ? conversation?.handSignals?.[meId] : undefined;
  const theirHandAt = otherId ? conversation?.handSignals?.[otherId] : undefined;
  useEffect(() => {
    if (liveHands && myHandAt && theirHandAt && Math.abs(myHandAt - theirHandAt) <= 4_000) void finish('gesture');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveHands, myHandAt, theirHandAt]);
  const [leaveNotice, setLeaveNotice] = useState(false);
  const [releasedConversation, setReleasedConversation] = useState<string | null>(null);
  const blockedNavigation = useRef<(() => void) | null>(null);
  const unsafeLocalWork = app.mode === 'live' && !harness && !capture.navigationSafe;
  const preventRemoval = unsafeLocalWork && releasedConversation !== id;
  const disableRemovalPrevention = usePreventRemove(preventRemoval, ({ repeat }) => {
    blockedNavigation.current = repeat;
    askBeforeLeaving();
  });
  useLayoutEffect(() => { navigation.setOptions({ gestureEnabled: !preventRemoval }); }, [navigation, preventRemoval]);
  async function discardAndLeave() {
    await capture.discardLocal();
    setReleasedConversation(id);
    disableRemovalPrevention();
    const repeat = blockedNavigation.current;
    blockedNavigation.current = null;
    if (repeat) repeat(); else router.dismissTo('/connections');
  }
  function keepConversationOpen() { setLeaveNotice(false); blockedNavigation.current = null; }
  function askBeforeLeaving() {
    setLeaveNotice(true);
    if (Platform.OS !== 'web') Alert.alert('Leave this conversation?',
      conversation?.connectedAt
        ? 'Your connection is saved. Any pending local recording will be discarded; your chat remains available.'
        : 'Leaving stops capture and discards pending local audio. An unfinished connection will not be shared.',
      [{ text: 'Stay', style: 'cancel', onPress: keepConversationOpen },
        { text: 'Discard audio and leave', style: 'destructive', onPress: () => { void perform(discardAndLeave); } }]);
  }
  const { selectEvent, demo, mode } = app;
  const eventId = conversation?.eventId;
  useFocusEffect(useCallback(() => { if (eventId) selectEvent(eventId); }, [eventId, selectEvent]));
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  useFocusEffect(useCallback(() => () => {
    if (mode === 'demo') demo({ type: 'stop', id });
  }, [mode, demo, id]));
  useEffect(() => {
    if (app.mode !== 'live' || harness || !focused || !foreground || !isRecorder || !app.phoneCaptureReady
      || !capture.available || capture.busy || capture.capturing || conversation?.consentMode !== 'event'
      || conversation.status !== 'consent' || !conversation.readyToRecord) return;
    if (!attempted.current.has(id)) {
      attempted.current.add(id);
      void start.current();
      return;
    }
    if (!capture.autoStartRetryable) return;
    const timer = setTimeout(() => { void start.current(); }, 1000);
    return () => clearTimeout(timer);
  }, [app.mode, app.phoneCaptureReady, harness, focused, foreground, isRecorder, capture.available,
    capture.busy, capture.capturing, capture.autoStartRetryable, conversation?.consentMode,
    conversation?.status, conversation?.readyToRecord, id]);
  if (!conversation || !app.snapshot) return <Page back title="Conversation"><GlobalStatus /><Empty icon="message-circle" title="Conversation unavailable" text="Open the conversation from your event or connections." /></Page>;
  const me = app.snapshot.me, other = conversation.participants.find(p => p.id !== me.id)!;
  const elapsed = Math.max(0, Math.floor((clock - (conversation.startedAt ?? clock)) / 1000));
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const backToEvent = () => router.dismissTo(`/event/${conversation.eventId}`);
  const stop = async (reason: string) => {
    if (harness) await app.client!.stop(app.token, id);
    else await capture.stop(reason);
  };
  if (connected && feedback.phase === 'complete') return <ConversationChat conversation={conversation} me={me} demo={app.mode === 'demo'}
    eventTitle={app.snapshot.events.find(event => event.id === conversation.eventId)?.title}
    previewControls={<DemoBanner actors />} error={app.error}
    onSend={text => app.run(() => app.sendMessage(id, text))}
    onBack={() => {
      if (app.mode === 'demo' || harness || capture.navigationSafe) router.dismissTo('/connections');
      else askBeforeLeaving();
    }}
    onDelete={async () => {
      if (app.mode === 'demo') app.demo({ type: 'delete', id });
      else {
        await app.client!.deleteConversation(app.token, id);
        await capture.discardLocal();
      }
      setReleasedConversation(id);
      disableRemovalPrevention();
      router.dismissTo('/connections');
    }}
    notice={<>
      {capture.notice ? <Notice>{capture.notice}</Notice> : null}
      {app.mode === 'live' && !harness && !capture.navigationSafe && <Notice>Keep this screen open while your recording finishes uploading. Your connection is already saved.</Notice>}
      {capture.hasUpload && <Button tone="secondary" busy={capture.busy} onPress={() => void capture.retryUpload()}>Retry audio upload</Button>}
      {leaveNotice && !capture.navigationSafe && <View style={s.card}>
        <Text style={s.label}>Keep the connection, skip the recap?</Text>
        <Text style={s.small}>Leaving now discards any pending local audio. Your chat stays available to both of you.</Text>
        <Button tone="secondary" busy={busy} onPress={() => void perform(discardAndLeave)}>Discard local audio and leave</Button>
        <Button tone="ghost" onPress={keepConversationOpen}>Stay for the recap</Button>
      </View>}
    </>}
  />;
  if (conversation.consentMode !== 'event' && conversation.status !== 'cancelled') return <Page back title="Earlier conversation">
    <Notice>This conversation uses the earlier prototype flow. Return to the event to enable Glance and try the new gesture-to-chat experience.</Notice>
    <Button onPress={backToEvent}>Back to your event</Button>
    <Button tone="ghost" busy={busy} onPress={() => void perform(capture.cancel)}>Close earlier conversation</Button>
  </Page>;
  const confirming = connected && feedback.phase === 'confirmed';
  const finishing = feedback.phase === 'finishing';
  const retrying = feedback.phase === 'retry';
  const showCamera = !harness && conversation.status !== 'cancelled' && (['consent', 'recording'].includes(conversation.status)
    || confirming || finishing || retrying && capture.hasUpload);
  const armed = focused && foreground && !connected && conversation.status === 'recording'
    && feedback.phase === 'watching' && !capture.busy && !busy;
  return <View style={{ flex: 1 }}><Page back title={`You + ${other.name.split(' ')[0]}`} footer={!connected && (conversation.status === 'recording' || retrying && capture.hasUpload) ? <>
    {!harness && <Button icon="link" tone="secondary" busy={capture.busy || finishing}
      disabled={!focused || !foreground} onPress={() => void finish('finish_button')}>
      {retrying ? 'Retry finish & connect' : 'Finish & connect'}
    </Button>}
    {!retrying && <Button tone="ghost" icon="stop-circle" busy={busy} disabled={capture.busy || finishing}
      onPress={() => void perform(() => stop('ordinary_stop'))}>Stop without sharing</Button>}
  </> : undefined}>
    <DemoBanner /><GlobalStatus />
    {leaveNotice && unsafeLocalWork && <View style={s.card}>
      <Text style={s.label}>Leave this conversation?</Text>
      <Text style={s.small}>Leaving stops this capture and discards pending local audio. A connection already saved by a finish signal will remain available.</Text>
      <Button tone="secondary" busy={busy} onPress={() => void perform(discardAndLeave)}>Discard local audio and leave</Button>
      <Button tone="ghost" onPress={keepConversationOpen}>Stay here</Button>
    </View>}
    {capture.notice ? <Notice>{capture.notice}</Notice> : null}
    {conversation.status === 'consent' && <>
      <View style={{ gap: 10 }}><Badge>GLANCE IS READY</Badge><Text style={s.title}>Just be here.</Text>
        <Text style={s.muted}>You and {other.name.split(' ')[0]} enabled Glance at event entry. Capture starts automatically when both phones are ready.</Text></View>
      <View style={s.card}><PersonRow person={other} /><Text style={s.small}>Keep both conversation screens open. There is no new approval to complete.</Text></View>
      {harness ? <GlassesHandoff conversation={conversation} /> : <>
        {isRecorder && !capture.available && <Notice>{Platform.OS === 'web' ? 'This browser cannot record audio. Open Glance in Safari or Chrome over HTTPS on this device.' : 'Live capture needs the iPhone development build with the native audio module. Expo Go cannot record.'}</Notice>}
        {isRecorder && capture.available && !app.phoneCaptureReady && <Button tone="secondary" onPress={backToEvent}>Set up capture at event entry</Button>}
        {(!isRecorder || capture.available && app.phoneCaptureReady) && <View style={s.row}><ActivityIndicator color={colors.blue} /><Text style={[s.muted, s.grow]}>{capture.busy ? 'Preparing your recording device…' : 'Waiting for both devices to be ready…'}</Text></View>}
      </>}
      <Button tone="ghost" busy={busy} onPress={() => void perform(async () => {
        if (harness) await app.client!.cancel(app.token, id); else await capture.cancel();
        backToEvent();
      })}>Leave without recording</Button>
    </>}
    {(conversation.status === 'recording' || confirming || finishing) && <>
      <View style={s.between}>
        <View style={{ gap: 6 }}><Badge green={confirming}>{confirming ? 'CONNECTION SAVED' : app.mode === 'demo' ? capture.demoRecording ? 'RECORDING AUDIO' : 'SAMPLE ENCOUNTER'
          : capture.capturing ? 'MICROPHONE RECORDING' : finishing ? 'FINISHING SAFELY' : 'PAIRED DEVICE'}</Badge>
          <Text style={{ fontFamily: fonts.medium, fontSize: 28, letterSpacing: -1, color: colors.ink, fontVariant: ['tabular-nums'] }}>{timer}</Text></View>
        <View style={[s.row, { gap: 7 }]}><Portrait person={me} size={36} /><Icon name="link" color={colors.muted} size={14} /><Portrait person={other} size={36} /></View>
      </View>
    </>}
    {capture.demoRecording && conversation.status === 'recording' && <View testID="demo-recording" accessibilityLiveRegion="polite"
      style={[s.row, { padding: 12, borderRadius: 12, backgroundColor: colors.dangerLight }]}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />
      <Text style={[s.small, s.grow, { color: colors.danger }]}>Recording this conversation for your summary. Finishing sends it; Stop without sharing deletes it.</Text>
    </View>}
    {capture.demoAudioError ? <Notice>{capture.demoAudioError}</Notice> : null}
    {showCamera && <View style={{ gap: 12 }}>
      <View style={s.between}><Text style={s.heading}>Three fingers.{'\n'}You’re connected.</Text>
        <Text style={{ color: colors.blue, fontSize: 42, fontFamily: fonts.bold }}>3</Text></View>
      {glassesShellAvailable() && <CameraPicker value={cameraDevice} onChange={setCameraDevice} />}
      <GestureCapture active={focused && foreground} armed={armed} sessionId={id} source="phone" device={cameraDevice}
        handsRequired={liveHands ? 1 : 2} partnerName={`${firstName(other.name)}’s`} rearmKey={handRearm}
        style={{ height: 256, borderRadius: 18, overflow: 'hidden' }}
        onStatus={setCameraStatus} onSignal={signal => {
          if (!armed || !signal.stable || signal.source !== 'phone') return;
          if (liveHands && signal.hands >= 1) void signalHand();
          else if (signal.hands === 2) void finish('gesture');
        }} />
      <Text style={s.muted}>{liveHands
        ? myHandAt && !theirHandAt
          ? `You saw ${firstName(other.name)}’s hand. Now show yours to ${firstName(other.name)}’s camera: thumb, pointer and middle up.`
          : theirHandAt && !myHandAt
            ? `${firstName(other.name)}’s camera saw your hand. Point yours at ${firstName(other.name)}’s hand to finish.`
            : `Both show one hand to the other’s camera: thumb, pointer and middle up, ring and little folded. Each phone sees the other person’s hand.`
        : 'One hand each: thumb, pointer and middle up. Fold your ring and little fingers, then hold both hands in view for about a second.'}</Text>
      <Text style={s.small}>{finishing ? 'Gesture received. Safely closing the recording and confirming your connection…'
        : retrying ? 'Waiting for a confirmed connection. Detection is paused; use Retry finish if needed.'
          : conversation.status === 'consent' ? 'Your live view stays on while the recording devices get ready. Hand detection cannot finish a conversation before it starts.'
            : 'Hold both poses to finish and open chat.'}</Text>
      {Platform.OS !== 'web' && cameraStatus ? <Text style={s.small}>{cameraStatus}</Text> : null}
    </View>}
    {conversation.status === 'recording' && <Text style={s.small}>{app.mode === 'demo'
      ? capture.demoRecording ? 'The camera, hand detection and microphone are real. Your summary separates Speaker 1 from Speaker 2; the audio is deleted once it is summarized.'
        : 'The camera and hand detection are real. This walkthrough records no audio and opens a clearly labeled sample recap.'
      : harness ? 'Live video and gesture capture stay in your separate glasses harness. Finish there, then return here for your shared chat.'
        : 'The live video is not saved. Either participant can use Finish & connect under your event permissions; the camera detects two hands, not who owns them.'}</Text>}
    {!connected && !finishing && ['ended', 'failed'].includes(conversation.status) && <>
      <View style={{ gap: 10 }}><Badge>CAPTURE ENDED</Badge><Text style={s.title}>{retrying ? 'Connection not confirmed yet.' : 'Stopped without sharing.'}</Text>
        <Text style={s.muted}>{retrying ? 'Capture will not restart. The latest confirmed connection state will open your chat; keep this screen open if audio still needs to be uploaded.'
          : 'No connection or recap was shared. Glance will not restart this conversation.'}</Text></View>
      {conversation.error ? <Notice error>{conversation.error}</Notice> : null}
      {!retrying && capture.hasUpload && <Button tone="secondary" busy={capture.busy} onPress={() => void capture.retryUpload()}>Retry audio upload</Button>}
      <Button tone="secondary" onPress={backToEvent}>Back to your event</Button>
    </>}
    {!connected && conversation.status === 'processing' && <View style={[s.card, { paddingVertical: 40, alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.blue} /><Text style={s.heading}>Keeping the good parts.</Text><Text style={[s.muted, { textAlign: 'center' }]}>Preparing one transcript-grounded recap for both of you. It will appear in Connections.</Text>
      <Button tone="ghost" onPress={backToEvent}>Back to your event</Button>
    </View>}
    {conversation.status === 'cancelled' && <><Empty icon="shield" title="No connection shared." text="This conversation was cancelled or event permission was withdrawn. Return to the event when you’re ready." />
      <Button onPress={() => router.replace('/events')}>Back to your events</Button></>}
  </Page>
    {confirming && <View testID="connection-green-confirmation" accessibilityRole="alert"
      style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(20,107,85,0.91)',
        alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <Icon name="check-circle" size={60} color="#FFFFFF" />
      <Text style={[s.title, { color: '#FFFFFF', textAlign: 'center' }]}>You’re connected.</Text>
      <Text style={[s.body, { color: '#E8F5EF', textAlign: 'center' }]}>Opening your shared chat.</Text>
    </View>}
  </View>;
}

export function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance();
  const conversation = app.snapshot?.conversations.find(c => c.id === id);
  const other = conversation?.participants.find(p => p.id !== app.snapshot?.me.id);
  if (!conversation || !other || !app.snapshot || conversation.status === 'cancelled'
    || !(conversation.connectedAt || conversation.status === 'shared')) return <Page back title="Your conversation"><GlobalStatus />
    <Empty icon="file-text" title="This conversation isn’t available." text="Finish an event conversation with the gesture to open a shared chat. Deleted conversations are no longer available." /></Page>;
  return <ConversationChat conversation={conversation} me={app.snapshot.me} demo={app.mode === 'demo'}
    eventTitle={app.snapshot.events.find(event => event.id === conversation.eventId)?.title}
    previewControls={<DemoBanner actors />} error={app.error}
    onBack={() => router.dismissTo('/connections')}
    onSend={text => app.run(() => app.sendMessage(id, text))}
    onDelete={async () => {
      if (app.mode === 'demo') app.demo({ type: 'delete', id }); else await app.client!.deleteConversation(app.token, id);
      router.dismissTo('/connections');
    }} />;
}

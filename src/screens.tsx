import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait, Wordmark } from './components';
import { colors, fonts, s } from './theme';
import { deploymentURL, useGlance } from './state';
import { samplePeople } from './demo';
import type { Conversation, Profile } from './domain';
import { useConversationCapture } from './useConversationCapture';
import GestureCapture from './capture/GestureCapture';

function useOperation() {
  const { run } = useGlance();
  const [busy, setBusy] = useState(false);
  const perform = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await run(fn); } catch { /* The shared status region shows the failure. */ }
    finally { setBusy(false); }
  };
  return { busy, perform };
}
function GlobalStatus() {
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
function DemoBanner({ actors = false }: { actors?: boolean }) {
  const { mode, snapshot, switchActor } = useGlance();
  if (mode !== 'demo') return null;
  return <View style={{ gap: 10 }}>
    <View style={s.row}><Badge>INTERACTIVE PREVIEW</Badge><Text style={s.small}>No audio recorded</Text></View>
    {actors && <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 12, gap: 9 }}>
      <Text style={s.small}>Demo controls: act as either person to try both sides.</Text>
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
  const shared = conversation.status === 'shared';
  const status = shared ? 'Your shared recap is ready' : ({
    consent: 'Waiting for recording consent', recording: 'Conversation in progress',
    ended: 'Confirm your connection', processing: 'Preparing your shared recap',
    failed: 'Needs your attention', cancelled: 'Conversation cancelled', shared: 'Your shared recap is ready',
  })[conversation.status];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${shared ? 'Read recap with' : 'Open conversation with'} ${other.name}`}
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
  useEffect(() => { selectEvent(undefined); }, [selectEvent]); // Home shows conversations across events.
  const openEvent = (id: string) => { app.selectEvent(id); router.push(`/event/${id}`); };
  const active = app.snapshot?.conversations.filter(c => !['shared', 'cancelled'].includes(c.status)) ?? [];
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
        <Field label="Invitation code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={24} placeholder={app.mode === 'demo' ? 'Try GLANCE2026' : 'Enter the host’s code'} />
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
  const { selectEvent } = app;
  useEffect(() => { selectEvent(id); }, [id, selectEvent]);
  const event = app.snapshot?.events.find(e => e.id === id);
  const members = app.snapshot?.members.filter(p => p.id !== app.snapshot?.me.id) ?? [];
  return <Page back title="Your event">
    <DemoBanner /><GlobalStatus />
    {event ? <>
      <View style={{ gap: 12 }}><Badge>YOU’RE IN</Badge><Text style={s.title}>{event.title}</Text>
        <View style={s.row}><Icon name="map-pin" color={colors.muted} size={17} /><Text style={s.muted}>{event.location || 'Location shared by the host'}</Text></View></View>
      <View style={[s.soft, s.between]}><View style={{ gap: 4 }}><Text style={s.small}>INVITE A FRIEND</Text><Text selectable style={[s.heading, { letterSpacing: 2 }]}>{event.inviteCode}</Text></View><Icon name="key" color={colors.blue} /></View>
      <View style={s.divider} />
      <Text style={s.heading}>People in the room</Text>
      <Text style={s.muted}>Find the person you’re talking to. You’ll both approve recording before anything starts.</Text>
      {members.map(person => <View key={person.id} style={s.card}><PersonRow person={person} />
        <Button busy={busy} tone="secondary" icon="message-circle" onPress={() => void perform(async () => router.push(`/conversation/${await app.pair(id, person.id)}`))}>Start conversation</Button>
      </View>)}
      {!members.length && <Empty icon="users" title="Be the first hello." text="Share the invitation code. Other people appear here after they join with their own profile." />}
      {app.snapshot?.conversations.filter(c => c.eventId === id && c.status !== 'cancelled').map(c => <ConversationLink key={c.id} conversation={c} />)}
      <Notice>Check the name and portrait together before you pair. Selecting an attendee is not consent to record them.</Notice>
    </> : !app.loading && <Empty icon="calendar" title="Event unavailable" text="Go back to your events, or join with an invitation code." />}
  </Page>;
}

export function ConnectionsScreen() {
  const app = useGlance();
  const { selectEvent } = app;
  useEffect(() => { selectEvent(undefined); }, [selectEvent]);
  const conversations = app.snapshot?.conversations.filter(c => c.status !== 'cancelled') ?? [];
  return <Page><View style={{ gap: 9 }}><Text style={s.title}>More than a hello.</Text><Text style={s.muted}>The people, ideas, and next steps you want to keep.</Text></View>
    <DemoBanner /><GlobalStatus />
    {conversations.map(c => <ConversationLink key={c.id} conversation={c} />)}
    {!conversations.length && <><Empty icon="message-circle" title="Your next connection starts in person." text="Join an event, meet someone, and keep a shared recap after you both agree." />
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
      { icon: 'image' as const, title: 'A portrait, not a biometric ID', text: 'Your event profile shows your photo. Glance does not match faces or identify people from a camera feed.' },
      { icon: 'mic' as const, title: 'Two people. Two approvals.', text: 'Both people agree before recording. Both confirm again before an AI recap is shared.' },
      { icon: 'stop-circle' as const, title: 'An easy way to stop', text: 'Stop capture with the gesture or button. A remote stop depends on connectivity; the recorder’s short consent lease is the fallback.' },
    ].map(item => <View key={item.title} style={[s.row, { alignItems: 'flex-start' }]}><View style={{ padding: 10, backgroundColor: colors.blueLight, borderRadius: 12 }}><Icon name={item.icon} color={colors.blue} /></View>
      <View style={[s.grow, { gap: 5 }]}><Text style={s.label}>{item.title}</Text><Text style={s.small}>{item.text}</Text></View></View>)}
    <View style={s.divider} />
    <View style={{ gap: 9 }}><Text style={s.label}>Build status</Text>
      <Text style={s.small}>Phone capture and gesture detection need the iPhone development build, not Expo Go. The Meta DAT capture harness is separate and still needs testing on your Adventurer glasses.</Text>
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
      <Text style={[s.small, s.grow]}>I agree that members of events I join can see this name and portrait. This does not give anyone permission to record me.</Text>
    </Pressable>
    <Button busy={busy} disabled={!accepted || !photo || !name.trim()} onPress={() => void perform(async () => {
      await app.saveProfile({ name: name.trim(), role: role.trim(), photoUrl: photo }); router.replace('/events');
    })}>Save your introduction</Button>
  </Page>;
}

function ApprovalList({ conversation, exchange = false }: { conversation: Conversation; exchange?: boolean }) {
  const { snapshot } = useGlance();
  const approvals = exchange ? conversation.exchangeConsent : conversation.recordingConsent;
  return <View style={s.card}>{conversation.participants.map((p, i) => <React.Fragment key={p.id}>
    {i > 0 && <View style={s.divider} />}<PersonRow person={p} approved={approvals.includes(p.id)}
      label={approvals.includes(p.id) ? exchange ? 'Connection confirmed' : 'Recording approved' : p.id === snapshot?.me.id ? 'Your approval is needed' : 'Waiting for their approval'} />
  </React.Fragment>)}</View>;
}
function GlassesHandoff({ conversation }: { conversation: Conversation }) {
  const app = useGlance();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') setRevealed(false); });
    return () => listener.remove();
  }, []);
  if (Platform.OS !== 'ios' || app.mode !== 'live' || app.snapshot?.me.id !== conversation.recorderId || conversation.status !== 'consent') return null;
  return <View style={{ gap: 10 }}>
    <Button tone="ghost" icon="external-link" onPress={() => { setOpen(!open); setRevealed(false); }}>Use the separate glasses harness</Button>
    {open && <View style={s.card}><Text style={s.label}>Private device handoff</Text>
      <Text style={s.small}>This setup contains your device credential. Copy it only into your own Glance DAT Harness. Never share it, include it in screenshots, or paste it into a website. Do not start this app’s recorder as well.</Text>
      {!revealed ? <Button tone="secondary" onPress={() => setRevealed(true)}>Reveal private setup secret</Button> : <Text selectable style={[s.small, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : undefined, color: colors.ink }]}>{JSON.stringify({
        deploymentURL, token: app.token, eventId: conversation.eventId, conversationId: conversation.id,
      })}</Text>}
      <Text style={s.small}>The other participant keeps their Glance conversation screen open. Confirm the actual glasses camera capability in the harness; Adventurer hardware support has not been verified here.</Text>
    </View>}
  </View>;
}

export function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const conversation = app.snapshot?.conversations.find(c => c.id === id);
  const capture = useConversationCapture(conversation);
  const [clock, setClock] = useState(() => Date.now()), [cameraStatus, setCameraStatus] = useState('');
  const [discard, setDiscard] = useState(false);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (conversation?.status === 'shared') router.replace(`/recap/${id}`); }, [conversation?.status, id]);
  if (!conversation || !app.snapshot) return <Page back title="Conversation"><GlobalStatus /><Empty icon="message-circle" title="Conversation unavailable" text="Open the conversation from your event or connections." /></Page>;
  const me = app.snapshot.me, other = conversation.participants.find(p => p.id !== me.id)!;
  const isRecorder = me.id === conversation.recorderId;
  const bothReady = conversation.participants.every(p => conversation.recordingConsent.includes(p.id));
  const agreed = conversation.recordingConsent.includes(me.id);
  const confirmed = conversation.exchangeConsent.includes(me.id);
  const elapsed = Math.max(0, Math.floor((clock - (conversation.startedAt ?? clock)) / 1000));
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const consent = () => app.mode === 'demo' ? Promise.resolve(app.demo({ type: 'consent', id })) : app.client!.consentRecording(app.token, id);
  const exchange = () => app.mode === 'demo' ? Promise.resolve(app.demo({ type: 'exchange', id })) : app.client!.confirmExchange(app.token, id);
  return <Page back title={`You + ${other.name.split(' ')[0]}`} footer={conversation.status === 'recording' ? <>
    {app.mode === 'demo' && <Button icon="camera" tone="secondary" onPress={() => void capture.stop('Demo gesture')}>Simulate mutual three-finger gesture</Button>}
    <Button tone="danger" icon="stop-circle" onPress={() => void capture.stop('You pressed Stop')}>{app.mode === 'demo' ? 'End demo conversation' : 'Stop recording'}</Button>
  </> : undefined}>
    <DemoBanner actors /><GlobalStatus />
    {capture.notice ? <Notice>{capture.notice}</Notice> : null}
    {conversation.status === 'consent' && <>
      <View style={{ gap: 10 }}><Text style={s.title}>Start with consent.</Text><Text style={s.muted}>Put the phone between you. Stay present with each other.</Text></View>
      <ApprovalList conversation={conversation} />
      <Text style={s.body}>Both of you must agree before recording starts. If you later both confirm the connection, your audio is sent to Meta’s model API to create a shared recap.</Text>
      <Notice>Keep both conversation screens open. Either person can stop. The three-finger gesture ends capture; it cannot identify who consented.</Notice>
      {!agreed && <Button busy={busy} icon="check" onPress={() => void perform(consent)}>I agree to recording</Button>}
      {agreed && !bothReady && <Button disabled tone="secondary" onPress={() => {}}>Waiting for the other person</Button>}
      {bothReady && isRecorder && <Button busy={capture.busy} icon="mic" onPress={() => void capture.start()}>
        {app.mode === 'demo' ? 'Start demo conversation' : 'Start recording'}
      </Button>}
      {bothReady && !isRecorder && <Notice>Both approvals are in. {conversation.participants.find(p => p.id === conversation.recorderId)?.name} can start on their recording device.</Notice>}
      <GlassesHandoff conversation={conversation} />
      <Button tone="ghost" onPress={() => void perform(capture.cancel)}>Cancel pairing</Button>
    </>}
    {conversation.status === 'recording' && <>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Badge>{app.mode === 'demo' ? 'SIMULATED CONVERSATION' : capture.capturing ? 'MICROPHONE RECORDING' : 'RECORDING ON PAIRED DEVICE'}</Badge>
        <Text style={{ fontFamily: fonts.body, fontSize: 58, letterSpacing: -2, color: colors.ink, fontVariant: ['tabular-nums'] }}>{timer}</Text>
        <View style={s.row}><Portrait person={me} size={44} /><Icon name="link" color={colors.muted} size={16} /><Portrait person={other} size={44} /></View>
      </View>
      <View style={[s.soft, { padding: 22, gap: 13 }]}>
        <View style={s.between}><Text style={s.heading}>Three fingers.{'\n'}A shared finish.</Text><Text style={{ color: colors.blue, fontSize: 50, fontFamily: fonts.bold }}>3</Text></View>
        <Text style={s.muted}>When you’re done, both hold up your index, middle, and ring fingers in the camera’s view. Fold your thumb and little finger.</Text>
        <Text style={s.small}>The camera checks for two stable hand signals, not two verified identities. You’ll each confirm the connection afterward.</Text>
      </View>
      {app.mode === 'live' && capture.capturing && <GestureCapture active source="phone" style={{ height: 260, borderRadius: 18, overflow: 'hidden' }}
        onStatus={setCameraStatus} onSignal={signal => { if (signal.hands >= 2 && signal.stable) void capture.stop('Three-finger signal detected'); }} />}
      {cameraStatus ? <Text style={s.small}>{cameraStatus}</Text> : null}
      <Text style={[s.small, { textAlign: 'center' }]}>{app.mode === 'demo' ? 'A walkthrough only. No microphone, camera, or AI call is active.' : 'Local Stop closes this recorder immediately. Remote Stop needs a connection; the short consent lease is the fallback. Leaving this screen discards this device’s recording.'}</Text>
    </>}
    {['ended', 'failed'].includes(conversation.status) && <>
      <View style={{ gap: 10 }}><Badge green>RECORDING ENDED</Badge><Text style={s.title}>Make it mutual.</Text><Text style={s.muted}>A good conversation is only the beginning.</Text></View>
      <ApprovalList conversation={conversation} exchange />
      <Text style={s.body}>Confirm to save this connection and receive the same AI recap. The recap is shared only after both of you confirm; your event portrait is already visible to event members.</Text>
      {conversation.error ? <Notice error>{conversation.error}</Notice> : null}
      {capture.hasUpload && <Button tone="secondary" busy={capture.busy} onPress={() => void capture.retryUpload()}>Retry audio upload</Button>}
      {!confirmed ? <Button busy={busy} icon="check" onPress={() => void perform(exchange)}>Confirm connection</Button> :
        <Notice>Your confirmation is in. Waiting for the other participant and the recorder’s upload.</Notice>}
      {conversation.status === 'failed' && app.mode === 'live' && <Button tone="secondary" busy={busy} onPress={() => void perform(() => app.client!.retryProcessing(app.token, id))}>Retry recap processing</Button>}
      {!discard ? <Button tone="ghost" onPress={() => setDiscard(true)}>Discard and don’t connect</Button> :
        <View style={s.card}><Text style={s.label}>Discard this conversation?</Text><Text style={s.small}>This cancels the exchange for both of you and deletes any retained audio. You can start a new conversation later.</Text>
          <Button tone="danger" busy={busy} onPress={() => void perform(capture.cancel)}>Delete recording and cancel</Button>
          <Button tone="ghost" onPress={() => setDiscard(false)}>Keep this conversation</Button></View>}
    </>}
    {conversation.status === 'processing' && <View style={[s.card, { paddingVertical: 40, alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.blue} /><Text style={s.heading}>Keeping the good parts.</Text><Text style={[s.muted, { textAlign: 'center' }]}>Preparing one transcript-grounded recap for both of you. It will appear in Connections.</Text>
      <Button tone="ghost" onPress={() => void perform(capture.cancel)}>Cancel the exchange</Button>
    </View>}
    {conversation.status === 'cancelled' && <><Empty icon="shield" title="No connection shared." text="The exchange was cancelled. You can always start a fresh conversation when you both want to." />
      <Button onPress={() => router.replace('/events')}>Back to your events</Button></>}
  </Page>;
}

export function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const [deleting, setDeleting] = useState(false);
  const conversation = app.snapshot?.conversations.find(c => c.id === id);
  const other = conversation?.participants.find(p => p.id !== app.snapshot?.me.id);
  if (!conversation?.recap || !other) return <Page back title="Your recap"><GlobalStatus /><Empty icon="file-text" title="This recap isn’t available." text="Both participants must confirm. Deleted conversations no longer have a shared recap." /></Page>;
  const recap = conversation.recap;
  return <Page back title="A connection worth keeping">
    <DemoBanner actors /><GlobalStatus />
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}><Portrait person={other} size={100} />
      <Text style={s.title}>{other.name}</Text><Text style={s.muted}>{other.role}</Text><Badge green>MUTUALLY CONNECTED</Badge></View>
    <View style={s.card}>
      <View style={s.between}><Text style={s.heading}>What you connected over</Text><Icon name="message-circle" color={colors.blue} size={19} /></View>
      {recap.source === 'sample' && <Badge>SAMPLE RECAP · NOT TRANSCRIBED</Badge>}
      <Text style={s.body}>{recap.summary}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{recap.topics.map(topic =>
        <View key={topic} style={{ paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.canvas, borderRadius: 8 }}><Text style={s.small}>{topic}</Text></View>)}</View>
    </View>
    <View style={{ gap: 16 }}><Text style={s.heading}>Keep the conversation going</Text>
      {recap.nextSteps.length ? recap.nextSteps.map((step, i) => <View key={`${i}-${step}`} style={[s.row, { alignItems: 'flex-start' }]}>
        <View style={{ width: 27, height: 27, borderRadius: 9, backgroundColor: colors.blueLight, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-up-right" size={15} color={colors.blue} /></View>
        <Text style={[s.body, s.grow]}>{step}</Text>
      </View>) : <Text style={s.muted}>No explicit follow-up was captured. Reach out when you have something meaningful to share.</Text>}
    </View>
    <View style={s.divider} />
    <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="check-circle" color={colors.green} size={18} /><Text style={[s.small, s.grow]}>You both receive this same recap, each with the other person’s portrait. AI can miss details; check anything important together.</Text></View>
    <Button onPress={() => router.replace('/connections')} icon="arrow-right">Back to connections</Button>
    {!deleting ? <Button tone="ghost" onPress={() => setDeleting(true)}>Delete this shared recap</Button> :
      <View style={s.card}><Text style={s.label}>Delete for both participants?</Text><Text style={s.small}>The shared recap will disappear for you and {other.name}. This cannot be undone.</Text>
        <Button tone="danger" busy={busy} onPress={() => void perform(async () => {
          if (app.mode === 'demo') app.demo({ type: 'delete', id }); else await app.client!.deleteConversation(app.token, id);
          router.replace('/connections');
        })}>Delete for both of us</Button><Button tone="ghost" onPress={() => setDeleting(false)}>Keep the recap</Button></View>}
  </Page>;
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation, usePreventRemove } from 'expo-router';
import { Button, Empty, Icon, Notice, Page, Portrait, Tag } from './components';
import { colors, fonts, s, type } from './theme';
import { deploymentURL, useGlance } from './state';
import type { Conversation } from './domain';
import { useConversationCapture } from './useConversationCapture';
import GestureCapture, { copyPrivateSetupJSON } from './capture/GestureCapture';
import { cancelLiveCameraHandoff } from './capture/liveCameraStream';
import { ConversationChat } from './ConversationChat';
import {
  beginConnectionFinish, completeConnectionAcknowledgment, CONNECTION_ACKNOWLEDGMENT_MS,
  reconcileConnectionFeedback, settleConnectionFinish, type ConnectionFeedback,
} from './connectionFeedback';
import { GestureHint } from './ui/GestureHint';
import { ConnectionContext } from './screens/ConnectionDetail';
import { PersonSheet } from './ui/PersonSheet';
import { useConnection, useMe } from './services/views';
import { buildSuggestion } from './services/suggestions';
import { useAppStore } from './services/store';
import { DemoActors, GlobalStatus, useOperation, useScreenFocused } from './ui/shared';

// Shared hooks and status views
export { DemoActors, DemoBanner, GlobalStatus, useOperation, useScreenFocused } from './ui/shared';
// Screens
export { EventsHome as EventsScreen } from './screens/EventsHome';
export { EventDetail as EventScreen } from './screens/EventDetail';
export { Connections as ConnectionsScreen } from './screens/Connections';
export { You as ProfileScreen } from './screens/You';
export { EditProfile as EnrollmentScreen } from './screens/EditProfile';
export { ConnectionDetail as RecapScreen } from './screens/ConnectionDetail';

function PersonRow({ person, label }: { person: Conversation['participants'][number]; label?: string }) {
  return <View style={s.row}><Portrait person={person} /><View style={s.grow}>
    <Text style={type.subheading}>{person.name}</Text><Text style={type.small}>{label ?? person.role}</Text>
  </View></View>;
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
    {open && <View style={s.card}><Text style={type.label}>Private device handoff</Text>
      <Text style={type.small}>This setup contains your device credential. Copy it only into your own Glance DAT Harness. Never share it, include it in screenshots, or paste it into a website. This app’s recorder is disabled for this handoff.</Text>
      {!revealed ? <Button tone="secondary" onPress={() => setRevealed(true)}>Reveal private setup secret</Button> : <>
        <Text selectable style={[type.small, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : undefined, color: colors.ink }]}>{JSON.stringify({
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
        {copyNotice ? <Text style={type.small}>{copyNotice}</Text> : null}
      </>}
      <Text style={type.small}>Keep the harness foregrounded and the other participant’s Glance conversation open. Authorize the harness microphone and connect the glasses there; capture then starts automatically when both accounts are ready. Adventurer camera capability still needs hardware verification.</Text>
    </View>}
  </View>;
}

/**
 * The live conversation: capture ownership, the two-hand finish, the green
 * acknowledgment and the shared chat all keep their existing contracts. Only
 * the presentation changed; see docs/FRONTEND-HANDOFF.md.
 */
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
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [feedbackState, setFeedbackState] = useState<ConnectionFeedback>({ id, phase: 'idle' });
  const finishInFlight = useRef<string | null>(null);
  const [personSheet, setPersonSheet] = useState(false);
  const me = useMe();
  const connectionView = useConnection(id);
  const { dispatch } = useAppStore();
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
  const meProfile = app.snapshot.me, other = conversation.participants.find(p => p.id !== meProfile.id)!;
  const elapsed = Math.max(0, Math.floor((clock - (conversation.startedAt ?? clock)) / 1000));
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const backToEvent = () => router.dismissTo(`/event/${conversation.eventId}`);
  const stop = async (reason: string) => {
    if (harness) await app.client!.stop(app.token, id);
    else await capture.stop(reason);
  };
  const suggestion = me && connectionView ? buildSuggestion(me, connectionView.person, { eventTitle: connectionView.event?.title, prompt: connectionView.event?.prompt }) : null;
  if (connected && feedback.phase === 'complete') return <View style={{ flex: 1 }}><ConversationChat conversation={conversation} me={meProfile} demo={app.mode === 'demo'}
    eventTitle={app.snapshot.events.find(event => event.id === conversation.eventId)?.title}
    previewControls={<DemoActors participantIds={conversation.participants.map(p => p.id)} />} error={app.error}
    context={me && connectionView ? <ConnectionContext connection={connectionView} me={me} onOpenPerson={() => setPersonSheet(true)} /> : undefined}
    onOpenPerson={suggestion ? () => setPersonSheet(true) : undefined}
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
        <Text style={type.label}>Keep the connection, skip the recap?</Text>
        <Text style={type.small}>Leaving now discards any pending local audio. Your chat stays available to both of you.</Text>
        <Button tone="secondary" busy={busy} onPress={() => void perform(discardAndLeave)}>Discard local audio and leave</Button>
        <Button tone="ghost" onPress={keepConversationOpen}>Stay for the recap</Button>
      </View>}
    </>}
  />
    <PersonSheet suggestion={suggestion} open={personSheet} onClose={() => setPersonSheet(false)} bookmarked={connectionView?.bookmarked ?? false}
      onToggleBookmark={() => connectionView && dispatch({ type: 'connectionPatch', id: connectionView.id, patch: { bookmarked: !connectionView.bookmarked } })} />
  </View>;
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
    {!harness && <Button icon="link" busy={capture.busy || finishing} testID="finish-connect"
      disabled={!focused || !foreground} onPress={() => void finish('finish_button')}>
      {retrying ? 'Retry finish & connect' : 'Finish & connect'}
    </Button>}
    {!retrying && <Button tone="ghost" icon="stop-circle" busy={busy} disabled={capture.busy || finishing} testID="stop-without-sharing"
      onPress={() => void perform(() => stop('ordinary_stop'))}>Stop without sharing</Button>}
  </> : undefined}>
    <GlobalStatus />
    {leaveNotice && unsafeLocalWork && <View style={s.card}>
      <Text style={type.label}>Leave this conversation?</Text>
      <Text style={type.small}>Leaving stops this capture and discards pending local audio. A connection already saved by a finish signal will remain available.</Text>
      <Button tone="secondary" busy={busy} onPress={() => void perform(discardAndLeave)}>Discard local audio and leave</Button>
      <Button tone="ghost" onPress={keepConversationOpen}>Stay here</Button>
    </View>}
    {capture.notice ? <Notice>{capture.notice}</Notice> : null}
    {conversation.status === 'consent' && <>
      <View style={{ gap: 10 }}><Tag tone="blue">Glance is ready</Tag><Text style={type.display}>Just be here.</Text>
        <Text style={type.secondary}>You and {other.name.split(' ')[0]} enabled Glance at event entry. Capture starts automatically when both phones are ready.</Text></View>
      <View style={s.card}><PersonRow person={other} /><Text style={type.small}>Keep both conversation screens open. There is no new approval to complete.</Text></View>
      {harness ? <GlassesHandoff conversation={conversation} /> : <>
        {isRecorder && !capture.available && <Notice>Live capture needs the iPhone development build with the native audio module. This browser or Expo Go cannot record.</Notice>}
        {isRecorder && capture.available && !app.phoneCaptureReady && <Button tone="secondary" onPress={backToEvent}>Set up capture at event entry</Button>}
        {(!isRecorder || capture.available && app.phoneCaptureReady) && <View style={s.row}><ActivityIndicator color={colors.ink} /><Text style={[type.secondary, s.grow]}>{capture.busy ? 'Preparing your recording device…' : 'Waiting for both devices to be ready…'}</Text></View>}
      </>}
      <Button tone="ghost" busy={busy} onPress={() => void perform(async () => {
        if (harness) await app.client!.cancel(app.token, id); else await capture.cancel();
        backToEvent();
      })}>Leave without recording</Button>
    </>}
    {(conversation.status === 'recording' || confirming || finishing) && <View style={s.between}>
      <View style={{ gap: 6 }}><Tag tone={confirming ? 'green' : app.mode === 'demo' ? capture.demoRecording ? 'danger' : 'sample' : 'blue'}>{confirming ? 'Connection saved' : app.mode === 'demo' ? capture.demoRecording ? 'Recording audio' : 'Sample encounter'
        : capture.capturing ? 'Microphone recording' : finishing ? 'Finishing safely' : 'Paired device'}</Tag>
        <Text style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -1, color: colors.ink, fontVariant: ['tabular-nums'] }}>{timer}</Text></View>
      <View style={[s.row, { gap: 7 }]}><Portrait person={meProfile} size={40} /><Icon name="link" color={colors.muted} size={14} /><Portrait person={other} size={40} /></View>
    </View>}
    {capture.demoRecording && conversation.status === 'recording' && <View testID="demo-recording" accessibilityLiveRegion="polite"
      style={[s.row, { padding: 12, borderRadius: 14, backgroundColor: colors.dangerLight }]}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />
      <Text style={[type.small, s.grow, { color: colors.danger }]}>Recording this conversation for your summary. Finishing sends it; Stop without sharing deletes it.</Text>
    </View>}
    {capture.demoAudioError ? <Notice>{capture.demoAudioError}</Notice> : null}
    {showCamera && <View style={{ gap: 12 }}>
      <Text style={type.heading}>Three fingers.{'\n'}You’re connected.</Text>
      <GestureCapture active={focused && foreground} armed={armed} sessionId={id} source="phone"
        style={{ height: 256, borderRadius: 22, overflow: 'hidden' }}
        onStatus={setCameraStatus} onSignal={signal => {
          if (armed && signal.hands === 2 && signal.stable && signal.source === 'phone') void finish('gesture');
        }} />
      <GestureHint compact />
      <Text style={type.small}>{finishing ? 'Gesture received. Safely closing the recording and confirming your connection…'
        : retrying ? 'Waiting for a confirmed connection. Detection is paused; use Retry finish if needed.'
          : conversation.status === 'consent' ? 'Your live view stays on while the recording devices get ready. Hand detection cannot finish a conversation before it starts.'
            : 'Hold both poses to finish and open your shared chat.'}</Text>
      {Platform.OS !== 'web' && cameraStatus ? <Text style={type.small}>{cameraStatus}</Text> : null}
    </View>}
    {conversation.status === 'recording' && <Text style={type.small}>{app.mode === 'demo'
      ? capture.demoRecording ? 'The camera, hand detection and microphone are real. Your summary separates Speaker 1 from Speaker 2; the audio is deleted once it is summarized.'
        : 'The camera and hand detection are real. This walkthrough records no audio and opens a clearly labeled sample recap.'
      : harness ? 'Live video and gesture capture stay in your separate glasses harness. Finish there, then return here for your shared chat.'
        : 'The live video is not saved. Either participant can use Finish & connect under your event permissions; the camera detects two hands, not who owns them.'}</Text>}
    {!connected && !finishing && ['ended', 'failed'].includes(conversation.status) && <>
      <View style={{ gap: 10 }}><Tag tone="neutral">Capture ended</Tag><Text style={type.display}>{retrying ? 'Connection not confirmed yet.' : 'Stopped without sharing.'}</Text>
        <Text style={type.secondary}>{retrying ? 'Capture will not restart. The latest confirmed connection state will open your chat; keep this screen open if audio still needs to be uploaded.'
          : 'No connection or recap was shared. Glance will not restart this conversation.'}</Text></View>
      {conversation.error ? <Notice error>{conversation.error}</Notice> : null}
      {!retrying && capture.hasUpload && <Button tone="secondary" busy={capture.busy} onPress={() => void capture.retryUpload()}>Retry audio upload</Button>}
      <Button tone="secondary" onPress={backToEvent} testID="back-to-event">Back to your event</Button>
    </>}
    {!connected && conversation.status === 'processing' && <View style={[s.card, { paddingVertical: 40, alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={colors.ink} /><Text style={type.heading}>Keeping the good parts.</Text><Text style={[type.secondary, { textAlign: 'center' }]}>Preparing one transcript-grounded recap for both of you. It will appear in Connections.</Text>
      <Button tone="ghost" onPress={backToEvent}>Back to your event</Button>
    </View>}
    {conversation.status === 'cancelled' && <><Empty icon="shield" title="No connection shared." text="This conversation was cancelled or event permission was withdrawn. Return to the event when you’re ready." />
      <Button onPress={() => router.replace('/events')}>Back to your events</Button></>}
  </Page>
    {confirming && <View testID="connection-green-confirmation" accessibilityRole="alert"
      style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(47,107,78,0.93)',
        alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <Icon name="check-circle" size={60} color={colors.cream} />
      <Text style={[type.display, { color: colors.cream, textAlign: 'center' }]}>You’re connected.</Text>
      <Text style={[type.body, { color: colors.cream, textAlign: 'center' }]}>Opening your shared chat.</Text>
    </View>}
  </View>;
}

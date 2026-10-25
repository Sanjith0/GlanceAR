import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Empty, Icon, Notice, Page, Portrait } from './components';
import { colors, fonts, s } from './theme';
import { useFaceDirectory, useGlance } from './state';
import { DemoBanner, GlobalStatus, useOperation, useScreenFocused } from './screens';
import FaceCamera, { type FaceFrame, type FaceOverlay } from './capture/FaceCamera';
import { cancelLiveCameraHandoff, prepareLiveCameraHandoff } from './capture/liveCameraStream';
import { matchDescriptor, RecognitionTracker } from './face';
import { talkingPoints } from './talkingPoints';
import { SIGHTING_REPORT_INTERVAL_MS } from './domain';
import { inFinalStretch, LIVE_RECOGNITION_FLASH_MS, LIVE_RECOGNITION_HOLD_MS, RecognitionCountdown, type RecognitionCountdownView } from './recognitionCountdown';
import { RecognitionScope } from './recognitionScope';

const firstName = (name: string) => name.split(' ')[0];
const LIVE_HOLD_LOST_MS = 4_000;
const emptyCountdown: RecognitionCountdownView = {
  partnerId: null, secondsRemaining: null, progress: 0, completed: false,
};
const pageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Pulses the camera window green with "Initiating conversation" for the last
 * RECOGNITION_FLASH_MS of the hold. Two pulses a second stays under photosensitivity
 * limits; Reduce Motion gets a steady tint and steady text.
 */
function ConnectingFlash() {
  const [pulse] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let current = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (current) setReduceMotion(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const useNativeDriver = Platform.OS !== 'web';
    pulse.setValue(1);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.timing(pulse, { toValue: 1, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);
  const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
  return <View pointerEvents="none" testID="connecting-flash" style={[fill, { alignItems: 'center', justifyContent: 'center', padding: 16 }]}>
    <Animated.View testID="connecting-flash-tint" style={[fill, { backgroundColor: '#2BD687',
      opacity: reduceMotion ? 0.25 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.55] }) }]} />
    <Animated.View accessibilityRole="text" accessibilityLiveRegion="assertive"
      style={{ alignItems: 'center', gap: 4, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14,
        backgroundColor: 'rgba(11,27,58,0.6)',
        opacity: reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }}>
      <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: 1.2, textAlign: 'center' }}>INITIATING CONVERSATION</Text>
      <Text style={{ color: '#E8FFF3', fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, textAlign: 'center' }}>Connection building…</Text>
    </Animated.View>
  </View>;
}

export function LiveCameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy } = useOperation();
  const focused = useScreenFocused();
  const { width, height } = useWindowDimensions();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(id); }, [id, selectEvent]));
  const event = app.snapshot?.events.find(e => e.id === id);
  const selected = app.snapshot?.event?.id === id;
  const me = app.snapshot?.me;
  const enabled = selected && Boolean(app.snapshot?.eventPermission?.enabled);
  const members = useMemo(() => selected ? app.snapshot?.members ?? [] : [], [selected, app.snapshot?.members]);
  const people = useMemo(() => new Map(members.map(p => [p.id, p])), [members]);
  const { directory, error: syncError } = useFaceDirectory(id);
  const templates = useMemo(() => directory?.templates ?? [], [directory?.templates]);
  const active = app.snapshot?.conversations.find(c => c.eventId === id && c.consentMode === 'event' && ['consent', 'recording'].includes(c.status));
  const [notice, setNotice] = useState('');

  const leaving = useRef(false);
  useFocusEffect(useCallback(() => { leaving.current = false; }, []));
  const tracker = useRef(new RecognitionTracker());
  const reports = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const [overlays, setOverlays] = useState<FaceOverlay[]>([]);
  const [pairing, setPairing] = useState<Record<string, string>>({});
  const countdown = useRef(new RecognitionCountdown(LIVE_RECOGNITION_HOLD_MS));
  const scope = useRef(new RecognitionScope());
  const mounted = useRef(true);
  const attempt = useRef<number | null>(null);
  const displayedCountdown = useRef(emptyCountdown);
  const [countdownView, setCountdownView] = useState(emptyCountdown);
  const [scopeGeneration, setScopeGeneration] = useState(0);
  const [demoPairPending, setDemoPairPending] = useState(false);
  const [authorizedConversation, setAuthorizedConversation] = useState<{ id: string; generation: number } | null>(null);
  // Live mode: the attendee this phone held in view for the full countdown. Their
  // phone must hold this user too; the server pairs both sightings.
  const liveHeld = useRef<{ id: string; seenAt: number } | null>(null);
  const [liveHeldId, setLiveHeldId] = useState<string | null>(null);

  const publishCountdown = useCallback((next: RecognitionCountdownView) => {
    displayedCountdown.current = next;
    setCountdownView(previous => previous.partnerId === next.partnerId
      && previous.secondsRemaining === next.secondsRemaining && previous.progress === next.progress
      && previous.completed === next.completed ? previous : next);
  }, []);

  const clearCountdown = useCallback(() => {
    countdown.current.reset();
    attempt.current = null;
    setScopeGeneration(scope.current.generation);
    publishCountdown(emptyCountdown);
    setDemoPairPending(false);
    setAuthorizedConversation(null);
    liveHeld.current = null;
    setLiveHeldId(null);
    setOverlays([]);
  }, [publishCountdown, setDemoPairPending, setAuthorizedConversation]);

  const resetCountdown = useCallback(() => {
    if (!mounted.current) return;
    scope.current.invalidate(performance.now());
    clearCountdown();
  }, [clearCountdown]);

  // Directory wrappers are new on each demo render, but scan arrays are immutable.
  // Compare array identity inside the scope fence, not values or wrapper identity.
  const scopeKey = JSON.stringify([
    id, app.mode, me?.id, focused, enabled, app.captureSource,
    directory?.enabled, directory?.scanned, directory?.model,
    members.filter(person => person.glanceEnabled).map(person => person.id).sort(),
  ]);
  useLayoutEffect(() => {
    if (scope.current.update(scopeKey, templates, performance.now())) clearCountdown();
  }, [scopeKey, templates, clearCountdown]);
  useLayoutEffect(() => {
    mounted.current = true;
    const currentScope = scope.current, currentCountdown = countdown.current;
    return () => {
      mounted.current = false;
      currentScope.invalidate(performance.now());
      currentCountdown.reset();
      attempt.current = null;
    };
  }, []);

  // An unrelated active encounter must not carry an earlier partial hold through
  // its lifetime. Our own synchronously submitted pair keeps its authorization.
  const previousActive = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (previousActive.current === active?.id) return;
    previousActive.current = active?.id;
    if (attempt.current === null) resetCountdown();
  }, [active?.id, resetCountdown]);

  useEffect(() => {
    if (!focused || !enabled) return;
    const timer = setInterval(() => {
      if (!mounted.current || attempt.current !== null) return;
      const held = liveHeld.current;
      if (held && performance.now() - held.seenAt > LIVE_HOLD_LOST_MS) {
        // They left the frame before the other phone held this user: start over.
        countdown.current.reset();
        liveHeld.current = null;
        setLiveHeldId(null);
      }
      const next = countdown.current.view(performance.now());
      if (displayedCountdown.current.partnerId && !next.partnerId) setOverlays([]);
      publishCountdown(next);
    }, 100);
    return () => clearInterval(timer);
  }, [app.mode, focused, enabled, publishCountdown]);

  const authorizedGeneration = authorizedConversation?.generation;
  const targetConversationId = app.mode === 'live' ? active?.id
    : authorizedConversation && authorizedGeneration === scopeGeneration && authorizedConversation.id === active?.id
      ? authorizedConversation.id : undefined;
  // Demo transitions need this hold's explicit authorization, not merely an
  // existing active snapshot. Keep the exact stream alive until route replacement.
  useEffect(() => {
    if (!focused || !pageVisible() || !targetConversationId || leaving.current) return;
    if (app.mode === 'demo' && !scope.current.isCurrent(authorizedGeneration!)) return;
    const generation = scope.current.generation;
    leaving.current = true;
    const destination = `conversation:${targetConversationId}`;
    prepareLiveCameraHandoff(destination);
    let cancelled = false, dispatched = false;
    void Promise.resolve().then(() => {
      if (cancelled || !mounted.current || !pageVisible() || !scope.current.isCurrent(generation)) {
        cancelLiveCameraHandoff(destination);
        leaving.current = false;
        return;
      }
      router.replace(`/conversation/${targetConversationId}`);
      dispatched = true;
    }).catch(error => {
      cancelLiveCameraHandoff(destination);
      leaving.current = false;
      if (!cancelled && mounted.current) setNotice(error instanceof Error ? error.message : 'Could not open the conversation.');
    });
    return () => {
      cancelled = true;
      if (!dispatched) { cancelLiveCameraHandoff(destination); leaving.current = false; }
    };
  }, [focused, targetConversationId, app.mode, authorizedGeneration, scopeGeneration]);

  const pairAfterHold = useCallback((partnerId: string) => {
    if (attempt.current !== null || leaving.current || active || !focused || !enabled || !pageVisible()) return;
    const generation = scope.current.generation;
    attempt.current = generation; // Latch before a synchronous demo dispatch.
    setDemoPairPending(true);
    setNotice('');
    void app.pair(id, partnerId).then(conversationId => {
      if (!mounted.current || !scope.current.isCurrent(generation)
        || attempt.current !== generation || !pageVisible()) return;
      setAuthorizedConversation({ id: conversationId, generation });
    }).catch(error => {
      if (!mounted.current || !scope.current.isCurrent(generation) || attempt.current !== generation) return;
      resetCountdown();
      setNotice(error instanceof Error ? error.message : 'Could not start your conversation. Hold both faces in view to retry.');
    });
  }, [active, focused, enabled, app, id, resetCountdown]);

  const report = useCallback((personId: string, now: number) => {
    if (inFlight.current.has(personId) || now - (reports.current.get(personId) ?? 0) < SIGHTING_REPORT_INTERVAL_MS) return;
    inFlight.current.add(personId);
    reports.current.set(personId, now);
    const name = firstName(people.get(personId)?.name ?? 'They');
    app.reportSighting(id, personId).then(result => setPairing(old => ({ ...old, [personId]:
      result.status === 'waiting' ? `Waiting for ${name} to recognize you`
        : result.status === 'busy' && !result.conversationId ? `${name} is in another conversation` : 'Starting your conversation…' })))
      .catch(error => setPairing(old => ({ ...old, [personId]: error instanceof Error ? error.message : 'Could not start a conversation.' })))
      .finally(() => inFlight.current.delete(personId));
  }, [people, app, id]);

  const onFrame = useCallback((frame: FaceFrame) => {
    if (!mounted.current || !focused || !enabled || !pageVisible()
      || leaving.current || !scope.current.acceptsFrame(frame.sampledAt)) return;
    const now = Date.now();
    const results = frame.faces.map(face => ({ face, match: face.descriptor ? matchDescriptor(face.descriptor, templates) : null }));
    const stable = tracker.current.observe(results.flatMap(({ match }) =>
      match && match.profileId !== me?.id && people.has(match.profileId) ? [match.profileId] : []), now);
    setOverlays(results.map(({ face, match }, i): FaceOverlay => {
      const person = match ? people.get(match.profileId) : undefined;
      if (person && person.id === me?.id) return { key: `self-${i}`, box: face.box, tone: 'self', title: 'You' };
      if (person) return {
        key: `${person.id}-${i}`, box: face.box, tone: 'match', title: person.name,
        detail: pairing[person.id] ?? (stable.includes(person.id) ? 'Recognized' : 'Recognizing…'),
        points: talkingPoints(me, person, event?.title),
      };
      return { key: `face-${i}`, box: face.box, tone: 'unknown', title: face.descriptor ? 'Not registered' : 'Move closer to recognize' };
    }));
    if (active || leaving.current) return;
    if (app.mode === 'demo') {
      if (attempt.current !== null) return;
      // Preserve every detection, including unknown and duplicate faces. Filtering
      // them out would let an extra face or two copies of one ID satisfy the hold.
      const ids = results.map(({ match }) => {
        const person = match ? people.get(match.profileId) : undefined;
        return person?.glanceEnabled ? person.id : null;
      });
      const next = countdown.current.observe(ids, me?.id, performance.now(), frame.sampledAt);
      publishCountdown(next);
      if (next.completed && next.partnerId) pairAfterHold(next.partnerId);
      return;
    }
    if (!directory?.scanned) return;
    const t = performance.now();
    const partnerIds = results.flatMap(({ match }) =>
      match && match.profileId !== me?.id && people.has(match.profileId) ? [match.profileId] : []);
    const held = liveHeld.current;
    if (held) {
      if (partnerIds.includes(held.id)) { held.seenAt = t; report(held.id, now); }
      return;
    }
    // Hold exactly one recognized attendee for the countdown (this camera cannot
    // see its own user, so self is implied). Their phone runs the same hold on you.
    const ids = me?.id && partnerIds.length === 1 ? [me.id, partnerIds[0]!] : partnerIds;
    const next = countdown.current.observe(ids, me?.id, t, frame.sampledAt);
    publishCountdown(next);
    if (next.completed && next.partnerId) {
      liveHeld.current = { id: next.partnerId, seenAt: t };
      setLiveHeldId(next.partnerId);
      report(next.partnerId, now);
    }
  }, [focused, enabled, templates, me, people, event?.title, pairing, active,
    app.mode, directory?.scanned, publishCountdown, pairAfterHold, report]);

  const recognizable = templates.filter(t => t.profileId !== me?.id && people.has(t.profileId)).length;
  const registeredPeople = members.filter(person => person.id === me?.id ? Boolean(directory?.scanned)
    : templates.some(t => t.profileId === person.id));
  const cameraActive = focused && enabled && Platform.OS === 'web';
  const counting = countdownView.secondsRemaining !== null;
  const partnerName = firstName(people.get(countdownView.partnerId ?? '')?.name ?? 'your partner');
  const flashing = !demoPairPending && !active && inFinalStretch(countdownView, LIVE_RECOGNITION_HOLD_MS, LIVE_RECOGNITION_FLASH_MS);
  const live = app.mode === 'live';
  const heldName = firstName(people.get(liveHeldId ?? '')?.name ?? 'They');
  // A 4:3 landscape window, as large as the column allows while the countdown card stays on screen.
  const cameraWidth = Math.max(240, Math.min(Math.min(width, 520) - 48, (height - 410) * 4 / 3));
  const cameraSize = { width: cameraWidth, height: cameraWidth * 3 / 4 };
  return <Page back title="LIVE Camera">
    <DemoBanner /><GlobalStatus />
    {!event ? !app.loading && <Empty icon="calendar" title="Event unavailable" text="Go back to your events, or join with an invitation code." />
      : !enabled ? <View style={s.soft}>
        <Text style={s.heading}>Turn on Glance first.</Text>
        <Text style={s.muted}>LIVE Camera only recognizes attendees who turned Glance on for this event, and only after you do too.</Text>
        <Button icon="arrow-left" onPress={() => router.canGoBack() ? router.back() : router.replace(`/event/${id}`)}>Back to the event</Button>
      </View> : <>
        <View style={{ gap: 12 }}><Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>STEP 2 OF 2</Text>
          <Text style={s.title}>Who’s here?</Text>
          <Text style={s.muted}>{app.mode === 'demo'
            ? 'Keep both registered faces in this camera for two seconds. If either leaves, the countdown restarts.'
            : 'Face the person you’re talking to and point your camera at them while they point theirs at you. Hold for two seconds; once both phones recognize each other, your conversation starts.'}</Text>
          {<View testID="recognition-countdown"
            accessibilityLiveRegion="polite"
            style={[s.soft, { backgroundColor: counting || demoPairPending || liveHeldId ? colors.blueLight : colors.canvas,
              borderWidth: 1, borderColor: colors.line, gap: 12 }]}>
            <View style={s.between}>
              <View style={[s.grow, { gap: 3 }]}>
                <Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>{live ? 'LIVE RECOGNITION' : 'SAME-CAMERA DEMO'}</Text>
                {live ? <>
                  <Text style={s.label}>{active ? 'Opening your conversation…'
                    : liveHeldId ? pairing[liveHeldId] ?? `Connecting with ${heldName}…`
                      : counting ? `${partnerName} recognized. Hold steady.` : 'Looking for a registered attendee'}</Text>
                  <Text style={s.small}>{active ? 'Keeping your camera live.'
                    : liveHeldId ? `${heldName}’s phone has to hold you in view too. Keep facing each other.`
                      : counting ? 'Keep them in view until the countdown finishes.'
                        : !directory?.scanned ? 'Go back to registration and scan your own face.'
                          : recognizable === 0 ? 'Nobody else here has a face scan yet.'
                            : 'Point your camera at one person while their phone points at you.'}</Text>
                </> : <>
                <Text style={s.label}>{demoPairPending ? 'Starting your conversation…'
                  : active ? 'A conversation is already open.'
                    : counting ? 'Both recognized. Stay in frame.' : 'Waiting for both faces'}</Text>
                <Text style={s.small}>{demoPairPending ? 'Keeping your camera live.'
                  : active ? 'Resume it, or stop it before starting another.'
                    : counting ? `You and ${partnerName}. Hold until the countdown finishes.`
                      : !directory?.scanned ? 'Go back to registration and scan yourself and one other attendee.'
                        : recognizable === 0 ? 'Go back to registration and add another attendee.'
                          : 'You + one registered attendee, visible together.'}</Text>
                </>}
              </View>
              <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center',
                justifyContent: 'center', backgroundColor: counting ? colors.blue : colors.paper, flexShrink: 0 }}>
                {counting && !demoPairPending && !active
                  ? <Text testID="recognition-countdown-number"
                    accessibilityLabel={`${countdownView.secondsRemaining} seconds remaining`}
                    style={[s.title, { color: colors.paper, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] }]}>
                    {countdownView.secondsRemaining}
                  </Text>
                  : <Icon name={demoPairPending || liveHeldId ? 'arrow-right' : 'users'} size={21} color={colors.blue} />}
              </View>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel="Recognition hold progress"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(countdownView.progress * 100) }}
              style={{ height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.line }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.blue,
                width: `${Math.round(countdownView.progress * 100)}%` }} />
            </View>
            {!live && active && !demoPairPending && <Button tone="secondary" icon="arrow-right"
              disabled={busy}
              onPress={() => {
                if (!focused || !pageVisible() || leaving.current) return;
                resetCountdown();
                const generation = scope.current.generation;
                attempt.current = generation;
                setDemoPairPending(true);
                setAuthorizedConversation({ id: active.id, generation });
              }}>Resume existing conversation</Button>}
          </View>}
        </View>
        <View style={[cameraSize, { alignSelf: 'center', borderRadius: 20, overflow: 'hidden' }]}>
          <FaceCamera active={cameraActive} scopeId={`live:${id}:${app.mode}:${me?.id ?? 'unregistered'}`}
            overlays={overlays} onFrame={onFrame} onCameraReset={resetCountdown} style={cameraSize} />
          {flashing && <ConnectingFlash />}
        </View>
        {notice ? <Notice>{notice}</Notice> : null}
        {syncError ? <Notice error>{`Face database sync failed: ${syncError}`}</Notice> : null}
        {app.mode === 'live' && directory && !directory.scanned && <Notice>Register your own face first. Others can only recognize you, and a conversation can only start, once you have a scan.</Notice>}
        <View testID="recognition-registered" style={s.card}>
          <View style={s.between}><Text style={s.heading}>Registered faces</Text>
            <Badge green={app.mode === 'live'}>{app.mode === 'live' ? 'LIVE SYNC' : 'THIS TAB ONLY'}</Badge></View>
          <Text style={s.small}>{`${recognizable} ${recognizable === 1 ? 'person' : 'people'} recognizable in this event${app.mode === 'live'
            ? '. Updates instantly when attendees join, pause, rescan or delete.' : '.'}`}</Text>
          {registeredPeople.length > 0 && <View style={[s.row, { flexWrap: 'wrap' }]}>
            {registeredPeople.map(person => <View key={person.id} style={[s.row, { gap: 6 }]}>
              <Portrait person={person} size={28} />
              <Text style={s.small}>{`${firstName(person.name)}${person.id === me?.id ? ' (you)' : ''}`}</Text>
            </View>)}
          </View>}
          <Button tone="secondary" icon="user-plus" disabled={busy || demoPairPending}
            onPress={() => router.canGoBack() ? router.back() : router.replace(`/register/${id}`)}>Edit registered users</Button>
        </View>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
          <Text style={[s.small, s.grow]}>Recognition runs on this device. Camera frames are never saved or uploaded, and faces without a scan are never identified.</Text></View>
      </>}
  </Page>;
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait } from './components';
import { colors, fonts, s } from './theme';
import { useFaceDirectory, useGlance } from './state';
import { DemoBanner, GlobalStatus, useOperation, useScreenFocused } from './screens';
import FaceCamera, { type FaceFrame, type FaceOverlay } from './capture/FaceCamera';
import { cancelLiveCameraHandoff, prepareLiveCameraHandoff } from './capture/liveCameraStream';
import { consistentSamples, faceDistance, matchDescriptor, MATCH_THRESHOLD, RecognitionTracker, scanProblem } from './face';
import { talkingPoints } from './talkingPoints';
import { DEMO_FACE_LIMIT, FACE_SCAN_SAMPLES, SIGHTING_REPORT_INTERVAL_MS } from './domain';
import { inFinalStretch, RecognitionCountdown, type RecognitionCountdownView } from './recognitionCountdown';
import { RecognitionScope } from './recognitionScope';

type ScanTarget = { profileId?: string; name: string; role: string };
type ScanRun = { target: ScanTarget; samples: number[][]; lastAt: number; startedAt: number; portrait?: string };
const firstName = (name: string) => name.split(' ')[0];
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
  const app = useGlance(), { busy, perform } = useOperation();
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
  const scan = useRef<ScanRun | null>(null);
  const [overlays, setOverlays] = useState<FaceOverlay[]>([]);
  const [pairing, setPairing] = useState<Record<string, string>>({});
  const [scanView, setScanView] = useState<{ name: string; count: number; hint: string } | null>(null);
  const [consented, setConsented] = useState(false);
  const [newPerson, setNewPerson] = useState<{ name: string; role: string } | null>(null);
  const countdown = useRef(new RecognitionCountdown());
  const scope = useRef(new RecognitionScope());
  const mounted = useRef(true);
  const attempt = useRef<number | null>(null);
  const displayedCountdown = useRef(emptyCountdown);
  const [countdownView, setCountdownView] = useState(emptyCountdown);
  const [scopeGeneration, setScopeGeneration] = useState(0);
  const [demoPairPending, setDemoPairPending] = useState(false);
  const [authorizedConversation, setAuthorizedConversation] = useState<{ id: string; generation: number } | null>(null);

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
    scanView ? 'scanning' : newPerson ? 'editing' : 'recognizing',
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
    if (app.mode !== 'demo' || !focused || !enabled) return;
    const timer = setInterval(() => {
      if (!mounted.current || attempt.current !== null) return;
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

  const stopScan = useCallback((message = '') => {
    scan.current = null;
    resetCountdown();
    setScanView(null); setOverlays([]); setNotice(message);
  }, [resetCountdown]);
  const startScan = useCallback((target: ScanTarget) => {
    resetCountdown();
    tracker.current.reset();
    scan.current = { target, samples: [], lastAt: 0, startedAt: Date.now() };
    setNotice(''); setScanView({ name: target.name, count: 0, hint: 'Look at the camera with only this person in frame.' });
  }, [resetCountdown]);
  const scanFrame = useCallback((frame: FaceFrame, now: number) => {
    const run = scan.current!;
    const problem = scanProblem(frame.faces);
    setOverlays(frame.faces.map((face, i) => ({ key: `scan-${i}`, box: face.box, tone: 'scan',
      title: problem ?? `Scanning ${firstName(run.target.name)} · ${run.samples.length}/${FACE_SCAN_SAMPLES}` })));
    if (now - run.startedAt > 25_000) { stopScan('The scan timed out. Try again facing the camera in good light.'); return; }
    if (problem) { setScanView(view => view && { ...view, hint: problem }); return; }
    const face = frame.faces[0];
    if (!face.descriptor || now - run.lastAt < 350) return;
    run.samples.push(face.descriptor);
    run.lastAt = now;
    if (!run.target.profileId && !run.portrait) run.portrait = frame.crop(face.box);
    if (run.samples.length < FACE_SCAN_SAMPLES) {
      setScanView({ name: run.target.name, count: run.samples.length, hint: 'Hold still…' });
      return;
    }
    if (!consistentSamples(run.samples)) {
      run.samples = []; run.portrait = undefined;
      setScanView({ name: run.target.name, count: 0, hint: 'Those frames didn’t look like one person. Hold still; starting over.' });
      return;
    }
    const { target, samples, portrait } = run;
    // One face, one attendee: never save a scan that already matches someone else.
    const clash = templates.find(t => t.profileId !== target.profileId
      && t.descriptors.some(d => samples.some(sample => faceDistance(sample, d) < MATCH_THRESHOLD)));
    stopScan();
    if (clash) {
      setNotice(`This face already matches ${people.get(clash.profileId)?.name ?? 'another attendee'}’s scan, so it wasn’t saved.`);
      return;
    }
    void perform(async () => {
      const profileId = target.profileId ?? app.addDemoPerson(id, target.name, target.role, portrait!);
      await app.saveFaceScan(profileId, samples);
      setNotice(`${firstName(target.name)}’s face scan is saved${app.mode === 'live'
        ? ' and synced to everyone with Glance on in this event.' : ' in this tab’s memory.'}`);
    });
  }, [templates, people, stopScan, perform, app, id]);

  const onFrame = useCallback((frame: FaceFrame) => {
    if (!mounted.current || !focused || !enabled || !pageVisible()
      || leaving.current || !scope.current.acceptsFrame(frame.sampledAt)) return;
    const now = Date.now();
    if (scan.current) { scanFrame(frame, now); return; }
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
    if (active || leaving.current || newPerson) return;
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
    for (const personId of stable) report(personId, now);
  }, [focused, enabled, scanFrame, templates, me, people, event?.title, pairing, active, newPerson,
    app.mode, directory?.scanned, publishCountdown, pairAfterHold, report]);

  const recognizable = templates.filter(t => t.profileId !== me?.id && people.has(t.profileId)).length;
  const cameraActive = focused && enabled && Platform.OS === 'web';
  const counting = countdownView.secondsRemaining !== null;
  const partnerName = firstName(people.get(countdownView.partnerId ?? '')?.name ?? 'your partner');
  const flashing = app.mode === 'demo' && !demoPairPending && !active && inFinalStretch(countdownView);
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
        <View style={{ gap: 12 }}><Text style={s.title}>Who’s here?</Text>
          <Text style={s.muted}>{app.mode === 'demo'
            ? 'Keep both registered faces in this camera for three seconds. If either leaves, the countdown restarts.'
            : 'Point your camera at the room. People with a face scan get a box with their name and something to talk about. Once you recognize each other, your conversation starts.'}</Text>
          {app.mode === 'demo' && <View testID="recognition-countdown"
            accessibilityLiveRegion="polite"
            style={[s.soft, { backgroundColor: counting || demoPairPending ? colors.blueLight : colors.canvas,
              borderWidth: 1, borderColor: colors.line, gap: 12 }]}>
            <View style={s.between}>
              <View style={[s.grow, { gap: 3 }]}>
                <Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>SAME-CAMERA DEMO</Text>
                <Text style={s.label}>{demoPairPending ? 'Starting your conversation…'
                  : active ? 'A conversation is already open.'
                    : counting ? 'Both recognized. Stay in frame.' : 'Waiting for both faces'}</Text>
                <Text style={s.small}>{demoPairPending ? 'Keeping your camera live.'
                  : active ? 'Resume it, or stop it before starting another.'
                    : scanView ? 'Finish this scan, then bring both people into view.'
                      : newPerson ? 'Finish adding this attendee before starting the hold.'
                        : counting ? `You and ${partnerName}. Hold until the countdown finishes.`
                          : !directory?.scanned ? 'Scan yourself and one other attendee below.'
                            : recognizable === 0 ? 'Add another attendee’s face scan below.'
                              : 'You + one registered attendee, visible together.'}</Text>
              </View>
              <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center',
                justifyContent: 'center', backgroundColor: counting ? colors.blue : colors.paper, flexShrink: 0 }}>
                {counting && !demoPairPending && !active
                  ? <Text testID="recognition-countdown-number"
                    accessibilityLabel={`${countdownView.secondsRemaining} seconds remaining`}
                    style={[s.title, { color: colors.paper, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] }]}>
                    {countdownView.secondsRemaining}
                  </Text>
                  : <Icon name={demoPairPending ? 'arrow-right' : 'users'} size={21} color={colors.blue} />}
              </View>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel="Recognition hold progress"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(countdownView.progress * 100) }}
              style={{ height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.line }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.blue,
                width: `${Math.round(countdownView.progress * 100)}%` }} />
            </View>
            {active && !demoPairPending && <Button tone="secondary" icon="arrow-right"
              disabled={Boolean(scanView) || busy}
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
        {scanView && <View style={[s.soft, s.between]}>
          <View style={[s.grow, { gap: 2 }]}><Text style={s.label}>{`Scanning ${scanView.name} · ${scanView.count}/${FACE_SCAN_SAMPLES}`}</Text>
            <Text style={s.small}>{scanView.hint}</Text></View>
          <View style={{ width: 120 }}><Button tone="ghost" onPress={() => stopScan()}>Cancel</Button></View>
        </View>}
        {notice ? <Notice>{notice}</Notice> : null}
        {syncError ? <Notice error>{`Face database sync failed: ${syncError}`}</Notice> : null}
        {app.mode === 'live' && directory && !directory.scanned && <Notice>Add your own face scan below. Others can only recognize you, and a conversation can only start, once you have one.</Notice>}
        <View style={s.card}>
          <View style={s.between}><Text style={s.heading}>Face database</Text>
            <Badge green={app.mode === 'live'}>{app.mode === 'live' ? 'LIVE SYNC' : 'THIS TAB ONLY'}</Badge></View>
          <Text style={s.small}>{`${recognizable} ${recognizable === 1 ? 'person' : 'people'} recognizable in this event${app.mode === 'live'
            ? '. Updates instantly when attendees join, pause, rescan or delete.' : '.'}`}</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consented }}
            accessibilityLabel="Agree to the face scan terms" onPress={() => setConsented(!consented)}
            style={[s.row, { alignItems: 'flex-start' }]}>
            <Icon name={consented ? 'check-square' : 'square'} color={colors.blue} />
            <Text style={[s.small, s.grow]}>{app.mode === 'live'
              ? 'I agree that attendees of events where I turn Glance on can recognize my face scan with LIVE Camera. My portrait is never used. I can delete my scan at any time.'
              : app.demoSummaries
                ? 'Everyone I scan has agreed, including to be recorded once a conversation starts. Scans stay in this tab’s memory; recordings go to Meta, through the local backend, only to make the summary, and are not kept.'
                : 'Everyone I scan has agreed. Scans stay in this tab’s memory, are never uploaded, and disappear on reload.'}</Text>
          </Pressable>
          {members.map(person => {
            const mine = person.id === me?.id;
            const has = mine ? Boolean(directory?.scanned) : templates.some(t => t.profileId === person.id);
            return <View key={person.id} style={{ gap: 10 }}>
              <View style={s.row}><Portrait person={person} size={40} />
                <View style={s.grow}><Text style={s.label}>{`${person.name}${mine ? ' (you)' : ''}`}</Text>
                  <Text style={s.small}>{!person.glanceEnabled ? 'Glance paused' : has ? 'Face scan synced' : 'No face scan yet'}</Text></View>
                <Icon name={has && person.glanceEnabled ? 'check-circle' : 'circle'} size={20} color={has && person.glanceEnabled ? colors.green : colors.line} /></View>
              {(app.mode === 'demo' || mine) && <View style={s.row}>
                <View style={s.grow}><Button tone="secondary" icon="camera" disabled={Boolean(scanView) || busy || !consented}
                  onPress={() => startScan({ profileId: person.id, name: person.name, role: person.role })}>
                  {has ? 'Rescan' : mine ? 'Scan my face' : 'Scan face'}</Button></View>
                {has && <View style={s.grow}><Button tone="danger" icon="trash-2" disabled={Boolean(scanView) || busy}
                  onPress={() => void perform(async () => {
                    resetCountdown();
                    await app.deleteFaceScan(person.id);
                    setNotice(`${firstName(person.name)}’s face scan was deleted.`);
                  })}>Delete scan</Button></View>}
              </View>}
            </View>;
          })}
          {app.mode === 'demo' && (members.length >= DEMO_FACE_LIMIT
            ? <Text style={s.small}>{`The preview holds up to ${DEMO_FACE_LIMIT} people.`}</Text>
            : newPerson ? <View style={{ gap: 12 }}>
              <Field label="Their name" value={newPerson.name} maxLength={80} placeholder="Who are you scanning?"
                onChangeText={name => setNewPerson({ ...newPerson, name })} />
              <Field label="One-line introduction" value={newPerson.role} maxLength={120} placeholder="Designer · creative tools"
                onChangeText={role => setNewPerson({ ...newPerson, role })} />
              <View style={s.row}>
                <View style={s.grow}><Button icon="camera" disabled={!newPerson.name.trim() || !consented || Boolean(scanView)}
                  onPress={() => { startScan({ name: newPerson.name.trim(), role: newPerson.role.trim() }); setNewPerson(null); }}>Scan their face</Button></View>
                <View style={s.grow}><Button tone="ghost" onPress={() => { resetCountdown(); setNewPerson(null); }}>Cancel</Button></View>
              </View>
            </View> : <Button tone="ghost" icon="user-plus" disabled={Boolean(scanView)}
              onPress={() => { resetCountdown(); setNewPerson({ name: '', role: '' }); }}>{`Add a person (${members.length} of ${DEMO_FACE_LIMIT})`}</Button>)}
        </View>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
          <Text style={[s.small, s.grow]}>Recognition runs on this device. Camera frames are never saved or uploaded, and faces without a scan are never identified.</Text></View>
      </>}
  </Page>;
}

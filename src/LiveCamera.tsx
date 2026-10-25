import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait } from './components';
import { colors, s } from './theme';
import { useFaceDirectory, useGlance } from './state';
import { DemoBanner, GlobalStatus, useOperation, useScreenFocused } from './screens';
import FaceCamera, { type FaceFrame, type FaceOverlay } from './capture/FaceCamera';
import { cancelLiveCameraHandoff, prepareLiveCameraHandoff } from './capture/liveCameraStream';
import { consistentSamples, faceDistance, matchDescriptor, MATCH_THRESHOLD, RecognitionTracker, scanProblem } from './face';
import { talkingPoints } from './talkingPoints';
import { DEMO_FACE_LIMIT, FACE_SCAN_SAMPLES, SIGHTING_REPORT_INTERVAL_MS } from './domain';

type ScanTarget = { profileId?: string; name: string; role: string };
type ScanRun = { target: ScanTarget; samples: number[][]; lastAt: number; startedAt: number; portrait?: string };
const firstName = (name: string) => name.split(' ')[0];

export function LiveCameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const focused = useScreenFocused();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(id); }, [id, selectEvent]));
  const event = app.snapshot?.events.find(e => e.id === id);
  const selected = app.snapshot?.event?.id === id;
  const me = app.snapshot?.me;
  const enabled = selected && Boolean(app.snapshot?.eventPermission?.enabled);
  const members = selected ? app.snapshot?.members ?? [] : [];
  const people = new Map(members.map(p => [p.id, p]));
  const { directory, error: syncError } = useFaceDirectory(id);
  const templates = directory?.templates ?? [];
  const active = app.snapshot?.conversations.find(c => c.eventId === id && c.consentMode === 'event' && ['consent', 'recording'].includes(c.status));
  const [notice, setNotice] = useState('');

  // Move directly into the conversation, retaining only this stream for this exact
  // destination. Audio ownership starts there and never remounts during finish/upload.
  const leaving = useRef(false);
  useFocusEffect(useCallback(() => { leaving.current = false; }, []));
  useEffect(() => {
    if (!focused || !active || leaving.current) return;
    leaving.current = true;
    const destination = `conversation:${active.id}`;
    prepareLiveCameraHandoff(destination);
    let cancelled = false, dispatched = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      router.replace(`/conversation/${active.id}`);
      dispatched = true;
    }).catch(error => {
      cancelLiveCameraHandoff(destination);
      leaving.current = false;
      if (!cancelled) setNotice(error instanceof Error ? error.message : 'Could not open the conversation.');
    });
    return () => {
      cancelled = true;
      if (!dispatched) { cancelLiveCameraHandoff(destination); leaving.current = false; }
    };
  }, [focused, active]);

  const tracker = useRef(new RecognitionTracker());
  const reports = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const scan = useRef<ScanRun | null>(null);
  const [overlays, setOverlays] = useState<FaceOverlay[]>([]);
  const [pairing, setPairing] = useState<Record<string, string>>({});
  const [scanView, setScanView] = useState<{ name: string; count: number; hint: string } | null>(null);
  const [consented, setConsented] = useState(false);
  const [newPerson, setNewPerson] = useState<{ name: string; role: string } | null>(null);

  const report = (personId: string, now: number) => {
    if (inFlight.current.has(personId) || now - (reports.current.get(personId) ?? 0) < SIGHTING_REPORT_INTERVAL_MS) return;
    inFlight.current.add(personId);
    reports.current.set(personId, now);
    const name = firstName(people.get(personId)?.name ?? 'They');
    app.reportSighting(id, personId).then(result => setPairing(old => ({ ...old, [personId]:
      result.status === 'waiting' ? `Waiting for ${name} to recognize you${app.mode === 'demo' ? ' (simulated in preview)' : ''}`
        : result.status === 'busy' && !result.conversationId ? `${name} is in another conversation` : 'Starting your conversation…' })))
      .catch(error => setPairing(old => ({ ...old, [personId]: error instanceof Error ? error.message : 'Could not start a conversation.' })))
      .finally(() => inFlight.current.delete(personId));
  };

  const stopScan = (message = '') => {
    scan.current = null;
    setScanView(null); setOverlays([]); setNotice(message);
  };
  const startScan = (target: ScanTarget) => {
    tracker.current.reset();
    scan.current = { target, samples: [], lastAt: 0, startedAt: Date.now() };
    setNotice(''); setScanView({ name: target.name, count: 0, hint: 'Look at the camera with only this person in frame.' });
  };
  const scanFrame = (frame: FaceFrame, now: number) => {
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
  };

  const onFrame = (frame: FaceFrame) => {
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
    if (active || leaving.current || (app.mode === 'live' && !directory?.scanned)) return;
    for (const personId of stable) report(personId, now);
  };

  const recognizable = templates.filter(t => t.profileId !== me?.id && people.has(t.profileId)).length;
  const cameraActive = focused && enabled && Platform.OS === 'web';
  return <Page back title="LIVE Camera">
    <DemoBanner /><GlobalStatus />
    {!event ? !app.loading && <Empty icon="calendar" title="Event unavailable" text="Go back to your events, or join with an invitation code." />
      : !enabled ? <View style={s.soft}>
        <Text style={s.heading}>Turn on Glance first.</Text>
        <Text style={s.muted}>LIVE Camera only recognizes attendees who turned Glance on for this event, and only after you do too.</Text>
        <Button icon="arrow-left" onPress={() => router.canGoBack() ? router.back() : router.replace(`/event/${id}`)}>Back to the event</Button>
      </View> : <>
        <View style={{ gap: 8 }}><Text style={s.title}>Who’s here?</Text>
          <Text style={s.muted}>Point your camera at the room. People with a face scan get a box with their name and something to talk about. Once you recognize each other, your conversation starts.</Text></View>
        <FaceCamera active={cameraActive} scopeId={`live:${id}`} overlays={overlays} onFrame={onFrame} />
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
                <View style={s.grow}><Button tone="ghost" onPress={() => setNewPerson(null)}>Cancel</Button></View>
              </View>
            </View> : <Button tone="ghost" icon="user-plus" disabled={Boolean(scanView)}
              onPress={() => setNewPerson({ name: '', role: '' })}>{`Add a person (${members.length} of ${DEMO_FACE_LIMIT})`}</Button>)}
        </View>
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
          <Text style={[s.small, s.grow]}>Recognition runs on this device. Camera frames are never saved or uploaded, and faces without a scan are never identified.</Text></View>
      </>}
  </Page>;
}

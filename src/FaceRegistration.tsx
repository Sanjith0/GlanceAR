import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait } from './components';
import { colors, s } from './theme';
import { useFaceDirectory, useGlance } from './state';
import { DemoBanner, GlobalStatus, useOperation, useScreenFocused } from './screens';
import { preloadFaceModels } from './capture/FaceCamera';
import { faceDistance, MATCH_THRESHOLD } from './face';
import { DEMO_FACE_LIMIT } from './domain';
import { GuidedFaceScan, saveScanSets, type ScanResult, type ScanStop } from './GuidedFaceScan';

type ScanTarget = { profileId?: string; name: string; role: string };
/** The camera sheet: a new attendee still being named, or a scan in progress. */
type Sheet = { kind: 'new'; name: string; role: string } | { kind: 'scan'; target: ScanTarget };
const firstName = (name: string) => name.split(' ')[0];

/**
 * Step 1 of LIVE Camera: register faces. The camera stays off until Add user or
 * a scan button opens it, and closes (releasing its tracks) as soon as the scan
 * finishes, fails or is cancelled. Step 2, recognition, is /live/[id].
 */
export function FaceRegistrationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance(), { busy, perform } = useOperation();
  const focused = useScreenFocused();
  const [consented, setConsented] = useState(false);
  // Models download and warm up once someone shows they mean to scan (ticks the agreement),
  // a moment after the tap so the page is never busy while it is still being read or tapped.
  useEffect(() => {
    if (!consented) return;
    const timer = setTimeout(preloadFaceModels, 600);
    return () => clearTimeout(timer);
  }, [consented]);
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

  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // Leaving the screen closes the camera and abandons any unsaved scan.
  useFocusEffect(useCallback(() => () => { setSheet(null); }, []));

  const stopScan = useCallback((reason: ScanStop) => { setSheet(null); setNotice(reason); }, []);
  const startScan = useCallback((target: ScanTarget) => { setNotice(null); setSheet({ kind: 'scan', target }); }, []);
  const target = sheet?.kind === 'scan' ? sheet.target : null;
  // One face, one attendee: never save a scan that already matches someone else.
  const clash = useCallback((center: number[][]) => {
    const taken = templates.find(t => t.profileId !== target?.profileId
      && t.descriptors.some(d => center.some(sample => faceDistance(sample, d) < MATCH_THRESHOLD)));
    return taken ? `This face already matches ${people.get(taken.profileId)?.name ?? 'another attendee'}’s scan, so it wasn’t saved.` : null;
  }, [templates, people, target?.profileId]);
  const saveScan = useCallback((result: ScanResult) => {
    if (!target) return;
    setSheet(null); setNotice(null);
    void perform(async () => {
      const profileId = target.profileId ?? app.addDemoPerson(id, target.name, target.role, result.portrait ?? '');
      await saveScanSets(result, descriptors => app.saveFaceScan(profileId, descriptors));
      setNotice({ text: `${firstName(target.name)} is registered${app.mode === 'live'
        ? ' and synced to everyone with Glance on in this event.' : '. Scans stay in this tab’s memory.'}` });
    });
  }, [target, perform, app, id]);

  const registered = templates.filter(t => people.has(t.profileId)).length;
  const ready = app.mode === 'live' ? Boolean(directory?.scanned) : registered > 0;
  const cameraActive = focused && enabled && Boolean(sheet) && Platform.OS === 'web';
  // A square window, so the scan circle and its ring fit whichever way the camera is held.
  const cameraWidth = Math.max(240, Math.min(Math.min(width, 520) - 48, height - 330));
  // In live mode every scan is of yourself, so open the front camera; the preview scans other people.
  const selfScan = app.mode === 'live' || (target !== null && target.profileId === me?.id);
  const canAdd = app.mode === 'demo' && members.length < DEMO_FACE_LIMIT;
  const meHas = Boolean(directory?.scanned);

  const cameraSheet = sheet && <View testID="registration-camera" style={[s.card, { gap: 14 }]}>
    <View style={s.between}>
      <Text style={s.heading}>{sheet.kind === 'new' ? 'Add user' : `Scanning ${sheet.target.name}`}</Text>
      <Badge>CAMERA ON</Badge>
    </View>
    <GuidedFaceScan active={cameraActive} scopeId={`register:${id}:${app.mode}:${me?.id ?? 'unregistered'}`}
      running={sheet.kind === 'scan'} preferFront={selfScan} wantPortrait={target !== null && !target.profileId}
      size={cameraWidth} clash={clash} onDone={saveScan} onStop={stopScan}>
      {sheet.kind === 'new' && <View style={{ gap: 12 }}>
        <Field label="Their name" value={sheet.name} maxLength={80} placeholder="Who are you scanning?"
          onChangeText={name => setSheet({ ...sheet, name })} />
        <Field label="One-line introduction" value={sheet.role} maxLength={120} placeholder="Designer · creative tools"
          onChangeText={role => setSheet({ ...sheet, role })} />
        <View style={s.row}>
          <View style={s.grow}><Button icon="camera" disabled={!sheet.name.trim() || busy}
            onPress={() => startScan({ name: sheet.name.trim(), role: sheet.role.trim() })}>Start scan</Button></View>
          <View style={s.grow}><Button tone="ghost" onPress={() => stopScan({ text: 'Cancelled. Nobody was added.' })}>Cancel</Button></View>
        </View>
      </View>}
    </GuidedFaceScan>
  </View>;

  return <Page back title="Register faces" footer={event && enabled && !sheet ? <>
    <Button testID="registration-next" icon="arrow-right" disabled={!ready || busy}
      onPress={() => router.push(`/live/${id}`)}>Next</Button>
    {!ready && <Text style={[s.small, { textAlign: 'center' }]}>{app.mode === 'live'
      ? 'Scan your own face to continue.' : 'Register at least one face to continue.'}</Text>}
  </> : undefined}>
    <DemoBanner /><GlobalStatus />
    {!event ? !app.loading && <Empty icon="calendar" title="Event unavailable" text="Go back to your events, or join with an invitation code." />
      : !enabled ? <View style={s.soft}>
        <Text style={s.heading}>Turn on Glance first.</Text>
        <Text style={s.muted}>LIVE Camera only recognizes attendees who turned Glance on for this event, and only after you do too.</Text>
        <Button icon="arrow-left" onPress={() => router.canGoBack() ? router.back() : router.replace(`/event/${id}`)}>Back to the event</Button>
      </View> : <>
        <View style={{ gap: 8 }}>
          <Text style={[s.eyebrow, { fontSize: 10, letterSpacing: 1 }]}>STEP 1 OF 2</Text>
          <Text style={s.title}>Who should Glance recognize?</Text>
          <Text style={s.muted}>{app.mode === 'demo'
            ? 'Add each person with a quick face scan. When everyone is registered, tap Next to start recognizing them.'
            : 'Scan your own face so attendees can recognize you. Others register on their own devices.'}</Text>
        </View>
        {notice ? <Notice error={notice.error}>{notice.text}</Notice> : null}
        {syncError ? <Notice error>{`Face database sync failed: ${syncError}`}</Notice> : null}
        {cameraSheet || <>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consented }}
            accessibilityLabel="Agree to the face scan terms" onPress={() => setConsented(!consented)}
            style={[s.soft, s.row, { alignItems: 'flex-start' }]}>
            <Icon name={consented ? 'check-square' : 'square'} color={colors.blue} />
            <Text style={[s.small, s.grow]}>{app.mode === 'live'
              ? 'I agree that attendees of events where I turn Glance on can recognize my face scan with LIVE Camera. My portrait is never used. I can delete my scan at any time.'
              : app.demoSummaries
                ? 'Everyone I scan has agreed, including to be recorded once a conversation starts. Scans stay in this tab’s memory; recordings go to Meta, through the local backend, only to make the summary, and are not kept.'
                : 'Everyone I scan has agreed. Scans stay in this tab’s memory, are never uploaded, and disappear on reload.'}</Text>
          </Pressable>
          {app.mode === 'demo'
            ? <Button testID="registration-add-user" icon="user-plus" disabled={!canAdd || !consented || busy}
              onPress={() => { setNotice(null); setSheet({ kind: 'new', name: '', role: '' }); }}>Add user</Button>
            : !meHas && <Button icon="camera" disabled={!consented || busy || !me}
              onPress={() => me && startScan({ profileId: me.id, name: me.name, role: me.role })}>Scan my face</Button>}
          {!consented && <Text style={s.small}>Tick the agreement above to scan faces.</Text>}
          {app.mode === 'demo' && !canAdd && <Text style={s.small}>{`The preview holds up to ${DEMO_FACE_LIMIT} people.`}</Text>}
          <View style={s.card}>
            <View style={s.between}><Text style={s.heading}>Registered users</Text>
              <Badge green={app.mode === 'live'}>{app.mode === 'live' ? 'LIVE SYNC' : 'THIS TAB ONLY'}</Badge></View>
            <Text testID="registration-count" style={s.small}>{`${registered} of ${members.length} ${members.length === 1 ? 'person' : 'people'} registered`}</Text>
            {members.map(person => {
              const mine = person.id === me?.id;
              const has = mine ? meHas : templates.some(t => t.profileId === person.id);
              return <View key={person.id} testID={`registered-${person.id}`} style={{ gap: 10 }}>
                <View style={s.row}><Portrait person={person} size={40} />
                  <View style={s.grow}><Text style={s.label}>{`${person.name}${mine ? ' (you)' : ''}`}</Text>
                    <Text style={s.small}>{!person.glanceEnabled ? 'Glance paused' : has ? 'Face registered' : 'Not registered yet'}</Text></View>
                  <Icon name={has && person.glanceEnabled ? 'check-circle' : 'circle'} size={20} color={has && person.glanceEnabled ? colors.green : colors.line} /></View>
                {(app.mode === 'demo' || mine) && <View style={s.row}>
                  <View style={s.grow}><Button tone="secondary" icon="camera" disabled={busy || !consented}
                    onPress={() => startScan({ profileId: person.id, name: person.name, role: person.role })}>
                    {has ? 'Rescan' : mine ? 'Scan my face' : 'Scan face'}</Button></View>
                  {has && <View style={s.grow}><Button tone="danger" icon="trash-2" disabled={busy}
                    onPress={() => void perform(async () => {
                      await app.deleteFaceScan(person.id);
                      setNotice({ text: `${firstName(person.name)}’s face scan was deleted.` });
                    })}>Delete scan</Button></View>}
                </View>}
              </View>;
            })}
          </View>
        </>}
        <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
          <Text style={[s.small, s.grow]}>The camera only opens while you scan. Recognition runs on this device; camera frames are never saved or uploaded.</Text></View>
      </>}
  </Page>;
}

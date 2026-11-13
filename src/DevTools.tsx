import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ConvexError } from 'convex/values';
import { Badge, Button, Empty, Field, Icon, Notice, Page, Portrait } from './components';
import { colors, fonts, s } from './theme';
import { deploymentURL } from './state';
import { useScreenFocused } from './screens';
import { preloadFaceModels } from './capture/FaceCamera';
import { GuidedFaceScan, saveScanSets, type ScanResult, type ScanStop } from './GuidedFaceScan';
import { createDevClient } from './data/devClient';
import type { DevOverview, DevPerson } from './domain';

/**
 * Hidden Dev tools, opened by tapping the Connections tab six times: every face scan
 * on the backend, and a way to add, rename, rescan and remove profiles for people who
 * have no device of their own. There is no key; the backend answers only while its
 * GLANCE_DEV_TOOLS switch is on.
 */
const AGREEMENT = 'This person is here with me and agreed to have their face scanned and to be recognized by attendees of the event I choose. I will delete their scan if they ask.';
const reason = (error: unknown) => error instanceof ConvexError ? String(error.data)
  : error instanceof Error ? error.message : 'Something went wrong. Try again.';
const day = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

type Scanning = { kind: 'add' } | { kind: 'rescan'; person: DevPerson; started: boolean; agreed: boolean };
type Status = { text: string; error?: boolean };

function Check({ checked, onChange, label, testID }: { checked: boolean; onChange: (value: boolean) => void; label: string; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}
    onPress={() => onChange(!checked)} style={[s.row, { alignItems: 'flex-start', minHeight: 44 }]}>
    <Icon name={checked ? 'check-square' : 'square'} color={colors.blue} />
    <Text style={[s.small, s.grow]}>{label}</Text>
  </Pressable>;
}

function Chip({ label, on, onPress, disabled, testID }: { label: string; on: boolean; onPress?: () => void; disabled?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole={onPress ? 'button' : 'text'} accessibilityState={{ selected: on, disabled }}
    accessibilityLabel={label} disabled={disabled || !onPress} onPress={onPress}
    style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, borderWidth: 1,
      borderColor: on ? colors.blue : colors.line, backgroundColor: on ? colors.blueLight : colors.paper }}>
    <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: on ? colors.blue : colors.muted }}>{label}</Text>
  </Pressable>;
}

export function DevToolsScreen() {
  const focused = useScreenFocused();
  const { width, height } = useWindowDimensions();
  const client = useMemo(() => deploymentURL ? createDevClient(deploymentURL) : null, []);
  const [data, setData] = useState<DevOverview | null>(null);
  /** Why the list could not be loaded (for example, the backend switch is off). */
  const [blocked, setBlocked] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', eventId: '', agreed: false });
  const [scanning, setScanning] = useState<Scanning | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; role: string } | null>(null);
  const [confirming, setConfirming] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    try { setData(await client.overview()); setBlocked(''); } catch (error) { setData(null); setBlocked(reason(error)); }
  }, [client]);
  // Load whenever the screen comes into view.
  useEffect(() => {
    if (!client || !focused) return;
    let cancelled = false;
    client.overview().then(value => { if (!cancelled) { setData(value); setBlocked(''); } },
      error => { if (!cancelled) { setData(null); setBlocked(reason(error)); } });
    return () => { cancelled = true; };
  }, [client, focused]);
  // Leaving the screen closes the camera.
  useFocusEffect(useCallback(() => () => { setScanning(null); }, []));

  /** Runs one change, shows what happened, then reloads the list. */
  const act = useCallback(async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setStatus(null);
    try { await work(); setStatus({ text: done }); } catch (error) { setStatus({ text: reason(error), error: true }); }
    setBusy(false); setConfirming('');
    await load();
  }, [load]);

  const stopScan = useCallback((stop: ScanStop) => { setScanning(null); setStatus(stop); }, []);
  const finishScan = useCallback((result: ScanResult) => {
    const current = scanning;
    if (!client || !current) return;
    setScanning(null);
    if (current.kind === 'add') {
      const { name, role, eventId } = form;
      void act(async () => {
        await saveScanSets(result, descriptors => client.addProfile({
          name: name.trim(), role: role.trim(), photoUrl: result.portrait ?? '', descriptors, ...(eventId ? { eventId } : {}),
        }));
        setForm({ name: '', role: '', eventId, agreed: false });
      }, `${name.trim()} was added with a face scan.`);
    } else {
      void act(() => saveScanSets(result, descriptors => client.saveScan(current.person.id, descriptors)),
        `${current.person.name}’s face scan was replaced.`);
    }
  }, [scanning, client, form, act]);

  // Arriving from "Rescan" on a registered face (four taps in LIVE Camera): open that
  // person's rescan as soon as the list has loaded, once per arrival.
  const { rescan: rescanParam } = useLocalSearchParams<{ rescan?: string }>();
  const [opened, setOpened] = useState('');
  if (data && rescanParam && opened !== rescanParam) {
    setOpened(rescanParam);
    const person = data.people.find(candidate => candidate.id === rescanParam);
    if (person) setScanning({ kind: 'rescan', person, started: false, agreed: false });
    else setStatus({ text: 'That person is not in the list, so there is nothing to rescan.', error: true });
  }

  const cameraWidth = Math.max(220, Math.min(Math.min(width, 520) - 88, height - 330));
  const camera = (running: boolean, children?: React.ReactNode) => <GuidedFaceScan active={focused && Platform.OS === 'web'}
    scopeId="dev:scan" running={running} wantPortrait size={cameraWidth} onDone={finishScan} onStop={stopScan}>{children}</GuidedFaceScan>;

  if (!client) return <Page back title="Dev tools"><Text style={s.title}>Dev tools</Text>
    <Empty icon="tool" title="Needs the live backend" text="This build runs the sample walkthrough, which keeps face scans in this tab only. Manage them from Register faces instead." /></Page>;

  if (!data) return <Page back title="Dev tools">
    <View style={{ gap: 8 }}><Text style={s.title}>Dev tools</Text>
      <Text style={s.muted}>See and manage every face scan, and add profiles for people without the app.</Text></View>
    {blocked ? <>
      <Notice error>{blocked}</Notice>
      <Button testID="dev-retry" tone="secondary" icon="refresh-cw" onPress={() => void load()}>Try again</Button>
    </> : <Text style={s.small}>Loading face scans…</Text>}
  </Page>;

  const adding = scanning?.kind === 'add';
  const rescanning = scanning?.kind === 'rescan' ? scanning : null;
  return <Page back title="Dev tools">
    <View style={s.between}>
      <Text style={s.title}>Dev tools</Text>
      <View style={[s.row, { gap: 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Reload the list" onPress={() => void load()}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="refresh-cw" size={19} color={colors.muted} /></Pressable>
      </View>
    </View>
    {status ? <Notice error={status.error}>{status.text}</Notice> : null}

    {rescanning && <View testID="dev-rescan" style={[s.card, { gap: 14 }]}>
      <View style={s.between}><Text style={[s.heading, s.grow]}>{`Rescan ${rescanning.person.name}`}</Text>
        <Badge>CAMERA ON</Badge></View>
      {camera(rescanning.started, <View style={{ gap: 12 }}>
        <Text style={s.small}>This replaces their saved face scan. Point the camera at {rescanning.person.name.split(' ')[0]}; nobody else should be in view.</Text>
        <Check testID="dev-rescan-agree" checked={rescanning.agreed} label={AGREEMENT} onChange={agreed => setScanning({ ...rescanning, agreed })} />
        <View style={s.row}>
          <View style={s.grow}><Button testID="dev-rescan-start" icon="camera" disabled={!rescanning.agreed} onPress={() => setScanning({ ...rescanning, started: true })}>Start scan</Button></View>
          <View style={s.grow}><Button tone="ghost" onPress={() => setScanning(null)}>Cancel</Button></View>
        </View>
      </View>)}
    </View>}

    <View testID="dev-add" style={[s.card, { gap: 14 }]}>
      <View style={s.between}><Text style={s.heading}>{adding ? `Scanning ${form.name.trim()}` : 'Add a face scan profile'}</Text>
        {adding ? <Badge>CAMERA ON</Badge> : null}</View>
      {adding ? camera(true) : <>
        <Text style={s.small}>For someone without the app. LIVE Camera will recognize them in the event you pick. They have no device, so no conversation can be started or recorded with them.</Text>
        <Field label="Their name" value={form.name} maxLength={80} placeholder="Who are you adding?" onChangeText={name => setForm({ ...form, name })} />
        <Field label="One-line introduction" value={form.role} maxLength={120} placeholder="Designer · creative tools" onChangeText={role => setForm({ ...form, role })} />
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Recognized in</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="No event yet" on={!form.eventId} onPress={() => setForm({ ...form, eventId: '' })} />
            {data.events.map(event => <Chip key={event.id} label={event.title} on={form.eventId === event.id}
              onPress={() => setForm({ ...form, eventId: event.id })} />)}
          </View>
        </View>
        <Check testID="dev-agree" checked={form.agreed} label={AGREEMENT}
          onChange={agreed => { setForm({ ...form, agreed }); if (agreed) preloadFaceModels(); }} />
        <Button testID="dev-start-scan" icon="camera" disabled={!form.name.trim() || !form.agreed || busy || scanning !== null}
          onPress={() => { setStatus(null); setScanning({ kind: 'add' }); }}>Start face scan</Button>
      </>}
    </View>

    <View style={s.between}>
      <Text style={s.heading}>Face scans</Text>
      <Text testID="dev-count" style={s.small}>{`${data.people.filter(person => person.scan).length} scanned · ${data.people.filter(person => person.managed).length} added here`}</Text>
    </View>
    {data.truncated ? <Notice>{`Showing the newest ${data.people.length}. Older scans are not listed.`}</Notice> : null}
    {!data.people.length && <Empty icon="users" title="No face scans yet" text="Scans appear here as attendees register their face, or when you add someone above." />}
    {data.people.map(person => {
      const edit = editing?.id === person.id ? editing : null;
      const member = new Set(person.events.map(event => event.id));
      return <View key={person.id} testID={`dev-person-${person.id}`} style={[s.card, { gap: 12 }]}>
        <View style={s.row}>
          <Portrait person={{ id: person.id, name: person.name, role: person.role, photoUrl: '' }} size={44} />
          <View style={[s.grow, { gap: 2 }]}>
            <Text style={s.label}>{person.name}</Text>
            {person.role ? <Text style={s.small}>{person.role}</Text> : null}
          </View>
          <Badge green={!person.managed}>{person.managed ? 'ADDED HERE' : 'OWN DEVICE'}</Badge>
        </View>
        <Text style={s.small}>{!person.scan ? 'No face scan. Not recognized anywhere.'
          : `${person.scan.samples} samples · scanned ${day(person.scan.consentedAt)}${person.scan.current ? '' : ' · outdated, ignored until rescanned'}`}</Text>

        {person.managed ? <View style={{ gap: 8 }}>
          <Text style={s.small}>Recognized in (tap to change)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {data.events.map(event => <Chip key={event.id} label={event.title} on={member.has(event.id)} disabled={busy}
              onPress={() => void act(() => client.setEvent(person.id, event.id, !member.has(event.id)),
                member.has(event.id) ? `${person.name} was taken out of ${event.title}.` : `${person.name} is now recognized in ${event.title}.`)} />)}
            {!data.events.length && <Text style={s.small}>No events exist yet.</Text>}
          </View>
        </View> : person.events.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {person.events.map(event => <Chip key={event.id} label={`${event.title}${event.recognized ? '' : ' · Glance off'}`} on={event.recognized} />)}
        </View>}

        {edit ? <View style={{ gap: 12 }}>
          <Field label="Name" value={edit.name} maxLength={80} onChangeText={name => setEditing({ ...edit, name })} />
          <Field label="One-line introduction" value={edit.role} maxLength={120} onChangeText={role => setEditing({ ...edit, role })} />
          <View style={s.row}>
            <View style={s.grow}><Button icon="check" busy={busy} disabled={!edit.name.trim()}
              onPress={() => void act(async () => { await client.updateProfile(person.id, edit.name.trim(), edit.role.trim()); setEditing(null); }, 'Profile updated.')}>Save</Button></View>
            <View style={s.grow}><Button tone="ghost" onPress={() => setEditing(null)}>Cancel</Button></View>
          </View>
        </View> : <View style={{ gap: 8 }}>
          <View style={s.row}>
            {person.managed && <View style={s.grow}><Button tone="secondary" icon="edit-2" disabled={busy || scanning !== null}
              onPress={() => setEditing({ id: person.id, name: person.name, role: person.role })}>Edit</Button></View>}
            <View style={s.grow}><Button tone="secondary" icon="camera" disabled={busy || scanning !== null}
              onPress={() => { setStatus(null); preloadFaceModels(); setScanning({ kind: 'rescan', person, started: false, agreed: false }); }}>{person.scan ? 'Rescan' : 'Scan'}</Button></View>
          </View>
          <View style={s.row}>
            {person.scan && <View style={s.grow}><Button tone="danger" icon="trash-2" disabled={busy || scanning !== null}
              onPress={() => confirming === `scan:${person.id}`
                ? void act(() => client.deleteScan(person.id), `${person.name}’s face scan was deleted.`)
                : setConfirming(`scan:${person.id}`)}>{confirming === `scan:${person.id}` ? 'Tap again to delete' : 'Delete scan'}</Button></View>}
            {person.managed && <View style={s.grow}><Button tone="danger" icon="user-x" disabled={busy || scanning !== null}
              onPress={() => confirming === `profile:${person.id}`
                ? void act(() => client.deleteProfile(person.id), `${person.name} was removed.`)
                : setConfirming(`profile:${person.id}`)}>{confirming === `profile:${person.id}` ? 'Tap again to remove' : 'Remove person'}</Button></View>}
          </View>
          {!person.managed && <Text style={s.small}>This person registered on their own device. You can rescan or delete their scan, but only they can rename.</Text>}
        </View>}
      </View>;
    })}
    <View style={[s.row, { alignItems: 'flex-start' }]}><Icon name="shield" size={17} color={colors.muted} />
      <Text style={[s.small, s.grow]}>Face scans are biometric data. Only add people who agreed, and delete a scan when someone asks. This screen has no lock: anyone who opens it can do the same.</Text></View>
  </Page>;
}

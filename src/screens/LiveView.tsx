import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Empty, Icon, Notice, Page, Portrait, SampleTag, Tag } from '../components';
import { colors, fonts, layout, radius, s, type } from '../theme';
import { useGlance } from '../state';
import { useAppStore } from '../services/store';
import { useAdapters, useConnections, useEventView, useMe } from '../services/views';
import { suggestPeople } from '../services/suggestions';
import { useDemoMode } from '../services/demoMode';
import { useReducedMotion } from '../ui/motion';
import { PersonSheet } from '../ui/PersonSheet';
import { useOperation } from '../ui/shared';
import type { RecognitionPhase, Suggestion } from '../services/contracts';

/**
 * The live recognition surface. The viewport is a slot: today it shows a
 * labelled sample field, later it receives the existing camera feed and the
 * recognition results map onto the same phases. Recognizing someone never
 * records, bookmarks or shares anything by itself.
 */
export function LiveView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useGlance();
  const me = useMe();
  const demo = useDemoMode();
  const view = useEventView(id);
  const { state, dispatch } = useAppStore();
  const { recognition } = useAdapters();
  const { connections } = useConnections();
  const { busy, perform } = useOperation();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { selectEvent } = app;
  useFocusEffect(useCallback(() => { selectEvent(id); }, [id, selectEvent]));
  const enabled = Boolean(app.snapshot?.event?.id === id && app.snapshot.eventPermission?.enabled);
  const candidates = useMemo(() => view ? suggestPeople(me, view.guests.filter(g => g.glanceEnabled), { eventTitle: view.title, prompt: view.prompt }) : [], [me, view]);
  const [feed, setFeed] = useState<RecognitionPhase>({ phase: 'preparing' });
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<Suggestion | null>(null);
  const [resolved, setResolved] = useState<Suggestion | null>(null);
  const navigating = useRef(false);
  const scenario = state.dev.recognition;
  const active = app.snapshot?.conversations.find(c => c.eventId === id && c.consentMode === 'event' && ['consent', 'recording'].includes(c.status));

  useEffect(() => {
    if (!enabled || resolved) return;
    return recognition.start({ candidates, scenario, startIndex: index }, setFeed);
  }, [enabled, recognition, candidates, scenario, index, attempt, resolved]);
  // Consent and an explicit "it's them" choice override the feed; derived during render, never in an effect.
  const phase: RecognitionPhase = !enabled ? { phase: 'consent' } : resolved ? { phase: 'recognized', suggestion: resolved } : feed;

  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (phase.phase !== 'searching' || reduced) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase.phase, reduced, pulse]);

  const startConversation = (personId: string) => void perform(async () => {
    if (navigating.current) return;
    navigating.current = true;
    try {
      const conversationId = await app.pair(id, personId);
      setSheet(null);
      router.push(`/conversation/${conversationId}`);
    } finally { navigating.current = false; }
  });
  const searchAgain = () => { setResolved(null); setIndex(n => n + 1); };
  const retry = () => { setResolved(null); setAttempt(n => n + 1); };

  if (!view) return <Page back title="Live"><Empty icon="calendar" title="Event unavailable" text="Open an event from Events first." /></Page>;
  const recognized = phase.phase === 'recognized' ? phase.suggestion : null;
  const bookmarkKey = (personId: string) => `${id}:${personId}`;
  const viewportHeight = Math.min(480, Math.max(300, (Math.min(width, layout.column) - 40) * 1.1));
  const frameWidth = Math.min(180, viewportHeight * 0.4);

  return <Page back title={view.title} testID="event-live" headerRight={<Tag tone={enabled ? 'green' : 'neutral'}>{enabled ? 'Glance on' : 'Glance off'}</Tag>}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={type.title}>{phase.phase === 'recognized' ? `That’s ${recognized?.person.name.split(' ')[0]}.`
        : phase.phase === 'uncertain' ? 'Not sure yet.' : phase.phase === 'unknown' ? 'Someone new.' : phase.phase === 'consent' ? 'Ready when you are.' : 'Who’s here?'}</Text>
      <Text accessibilityLiveRegion="polite" style={type.secondary}>{
        phase.phase === 'consent' ? 'Turn on Glance for this event to recognize people who have it on too.'
        : phase.phase === 'preparing' ? 'Getting the camera and the guest list ready.'
        : phase.phase === 'searching' ? 'Point your phone at the room. Guests with Glance on light up.'
        : phase.phase === 'recognized' ? recognized?.personal[0] ?? recognized?.professional[0] ?? ''
        : phase.phase === 'uncertain' ? 'Two guests look similar from here. Pick who you’re talking to, or keep looking.'
        : phase.phase === 'unknown' ? 'They haven’t added a scan, or Glance is off for them. Say hello the old way.'
        : phase.phase === 'permission' ? phase.reason : phase.message}</Text>
    </View>

    <View style={[styles.viewport, { height: viewportHeight }]} testID="live-viewport">
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={{ position: 'absolute', left: -40, right: -40, bottom: -30, height: viewportHeight * 0.34, borderTopLeftRadius: 999, borderTopRightRadius: 999, backgroundColor: 'rgba(240,228,202,0.06)' }} />
        <View style={{ position: 'absolute', left: viewportHeight * 0.1, bottom: viewportHeight * 0.12, width: viewportHeight * 0.22, height: viewportHeight * 0.3, borderTopLeftRadius: 999, borderTopRightRadius: 999, backgroundColor: 'rgba(188,204,219,0.08)' }} />
        <View style={{ position: 'absolute', right: viewportHeight * 0.12, bottom: viewportHeight * 0.1, width: viewportHeight * 0.18, height: viewportHeight * 0.24, borderTopLeftRadius: 999, borderTopRightRadius: 999, backgroundColor: 'rgba(188,204,219,0.08)' }} />
      </View>
      <View style={styles.corner}><Text style={styles.cornerText}>{demo ? 'Sample feed' : 'Camera'}</Text></View>
      {phase.phase === 'consent' || phase.phase === 'permission' || phase.phase === 'error' ? <View style={styles.center}>
        <View style={styles.centerIcon}><Icon name={phase.phase === 'consent' ? 'eye-off' : phase.phase === 'permission' ? 'camera-off' : 'alert-circle'} size={24} color={colors.cream} /></View>
        <Text style={styles.centerText}>{phase.phase === 'consent' ? 'Glance is off for this event' : phase.phase === 'permission' ? 'Camera unavailable' : 'Recognition paused'}</Text>
      </View> : phase.phase === 'preparing' ? <View style={styles.center}><Text style={styles.centerText}>Preparing…</Text></View>
        : <Animated.View style={[styles.frame, { width: frameWidth, height: frameWidth * 1.26, borderTopLeftRadius: frameWidth / 2, borderTopRightRadius: frameWidth / 2,
          borderColor: phase.phase === 'recognized' ? colors.powder : phase.phase === 'uncertain' ? colors.creamDeep : 'rgba(251,248,242,0.6)',
          opacity: phase.phase === 'searching' ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) : 1,
          borderStyle: phase.phase === 'unknown' ? 'dashed' : 'solid' }]}>
          {recognized && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Portrait person={recognized.person} size={frameWidth * 0.7} shape="round" /></View>}
        </Animated.View>}
      {recognized && <Pressable accessibilityRole="button" accessibilityLabel={`About ${recognized.person.name}`} testID="live-identity" onPress={() => setSheet(recognized)}
        style={({ pressed }) => [styles.identity, pressed && s.pressed]}>
        <Portrait person={recognized.person} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.identityName}>{recognized.person.name}</Text>
          <Text numberOfLines={1} style={styles.identityRole}>{recognized.person.occupation}</Text>
          <Text numberOfLines={2} style={styles.identityStarter}>{recognized.starters[0]}</Text>
        </View>
        <Icon name="chevron-up" size={18} color={colors.cream} />
      </Pressable>}
      {phase.phase === 'unknown' && <View style={[styles.identity, { alignItems: 'center' }]}>
        <View style={styles.unknownMark}><Text style={{ fontFamily: fonts.display, color: colors.cream, fontSize: 18 }}>?</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.identityName}>Not recognized</Text><Text style={styles.identityRole}>No scan on file for this guest</Text></View>
      </View>}
      {phase.phase === 'uncertain' && <View style={[styles.identity, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
        <Text style={styles.identityName}>Could be {phase.candidates.map(c => c.name.split(' ')[0]).join(' or ')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {phase.candidates.map(candidate => <Pressable key={candidate.id} accessibilityRole="button" testID={`uncertain-${candidate.id}`}
            onPress={() => { const match = candidates.find(c => c.person.id === candidate.id); if (match) setResolved(match); }}
            style={({ pressed }) => [styles.choice, pressed && s.pressed]}><Portrait person={candidate} size={24} /><Text style={styles.choiceText}>{candidate.name.split(' ')[0]}</Text></Pressable>)}
          <Pressable accessibilityRole="button" onPress={searchAgain} style={({ pressed }) => [styles.choice, { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(251,248,242,0.4)' }, pressed && s.pressed]}>
            <Text style={[styles.choiceText, { color: colors.cream }]}>Not sure</Text></Pressable>
        </View>
      </View>}
    </View>

    {active && <Notice icon="mic">A conversation is already open. <Text onPress={() => router.push(`/conversation/${active.id}`)} style={{ fontFamily: fonts.semibold, color: colors.ink }}>Return to it</Text> before starting another.</Notice>}
    <View style={{ gap: 10 }}>
      {phase.phase === 'consent' && <Button icon="check" busy={busy} testID="live-enable" onPress={() => void perform(async () => {
        if (app.mode === 'live' && Platform.OS !== 'web' && app.captureSource === 'phone') await app.preparePhoneCapture();
        await app.setEventPermission(id, true);
      })}>Turn on Glance for this event</Button>}
      {phase.phase === 'recognized' && recognized && <>
        <Button icon="message-circle" testID="live-start" disabled={Boolean(active)} busy={busy} onPress={() => startConversation(recognized.person.id)}>{`Start a conversation with ${recognized.person.name.split(' ')[0]}`}</Button>
        <Button tone="ghost" icon="rotate-ccw" testID="live-search-again" onPress={searchAgain}>Not them? Search again</Button>
      </>}
      {(phase.phase === 'unknown') && <Button tone="secondary" icon="rotate-ccw" testID="live-search-again" onPress={searchAgain}>Keep looking</Button>}
      {(phase.phase === 'permission' || phase.phase === 'error') && <Button tone="secondary" icon="rotate-ccw" testID="live-retry" onPress={retry}>{phase.phase === 'permission' ? 'Allow camera and retry' : 'Try again'}</Button>}
      {enabled && <Button tone="quiet" size="sm" icon="pause" testID="live-pause" busy={busy} onPress={() => void perform(() => app.setEventPermission(id, false))}>Pause Glance for this event</Button>}
    </View>
    <Text style={type.small}>Recognizing someone doesn’t record or share anything. Starting a conversation records it under both of your event permissions, and either of you can stop without sharing.</Text>
    {demo && <SampleTag>Sample recognition · no camera is used here</SampleTag>}
    <PersonSheet suggestion={sheet} open={sheet !== null} onClose={() => setSheet(null)}
      bookmarked={sheet ? state.bookmarks.includes(bookmarkKey(sheet.person.id)) : false}
      onToggleBookmark={() => sheet && dispatch({ type: 'bookmark', key: bookmarkKey(sheet.person.id), present: !state.bookmarks.includes(bookmarkKey(sheet.person.id)) })}
      metBefore={sheet && connections.find(c => c.personId === sheet.person.id) ? `You connected at ${connections.find(c => c.personId === sheet.person.id)?.event?.title ?? 'an earlier event'}` : undefined}
      primary={sheet ? { label: `Start a conversation with ${sheet.person.name.split(' ')[0]}`, onPress: () => startConversation(sheet.person.id), busy, disabled: Boolean(active) || !sheet.person.glanceEnabled,
        hint: !sheet.person.glanceEnabled ? 'They have Glance off for this event.' : undefined } : undefined} />
  </Page>;
}

const styles = StyleSheet.create({
  viewport: { backgroundColor: colors.ink, borderRadius: radius.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(240,228,202,0.14)' },
  cornerText: { fontFamily: fonts.medium, color: colors.cream, fontSize: 12, lineHeight: 16 },
  center: { alignItems: 'center', gap: 10 },
  centerIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(240,228,202,0.12)', alignItems: 'center', justifyContent: 'center' },
  centerText: { fontFamily: fonts.medium, color: colors.cream, fontSize: 15, lineHeight: 20 },
  frame: { borderWidth: 2.5, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: 'hidden', marginBottom: 120 },
  identity: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(48,42,49,0.9)', borderWidth: 1, borderColor: 'rgba(188,204,219,0.35)' },
  identityName: { fontFamily: fonts.semibold, color: colors.cream, fontSize: 15, lineHeight: 20 },
  identityRole: { fontFamily: fonts.body, color: 'rgba(240,228,202,0.8)', fontSize: 13, lineHeight: 18 },
  identityStarter: { fontFamily: fonts.displayItalic, color: colors.powder, fontSize: 14, lineHeight: 19, marginTop: 2 },
  unknownMark: { width: 40, height: 48, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: 'rgba(240,228,202,0.16)', alignItems: 'center', justifyContent: 'center' },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: 999, backgroundColor: colors.powder },
  choiceText: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 13 },
});

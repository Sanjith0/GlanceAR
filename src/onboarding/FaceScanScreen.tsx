import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon, Notice, Page, SampleTag } from '../components';
import { colors, type } from '../theme';
import { FACE_ANGLES, FaceFrame, type FaceAngle, type FaceFrameState } from '../ui/Arch';
import { OnboardingFrame } from './OnboardingFrame';
import { useAppStore } from '../services/store';
import { useAdapters } from '../services/views';
import { useDemoMode } from '../services/demoMode';
import type { FaceEnrollmentResult } from '../services/contracts';

type View2 = { state: FaceFrameState; angle: FaceAngle; progress: number; captured: FaceAngle[]; message: string; result?: FaceEnrollmentResult };
const ready: View2 = { state: 'ready', angle: 'front', progress: 0, captured: [], message: 'Center your face in the frame, then start the scan.' };

/**
 * Step 1 of signup. The scan is account-level enrollment: it lets people you
 * meet recognize you, only in events where you turn Glance on. It is not a
 * login. In this build the adapter is a labelled sample that never opens a camera.
 */
export function FaceScanScreen({ standalone = false }: { standalone?: boolean }) {
  const { state, dispatch } = useAppStore();
  const { faceEnrollment } = useAdapters();
  const demo = useDemoMode();
  const [view, setView] = useState<View2>(() => state.enrollment.result
    ? { state: 'success', angle: 'right', progress: 1, captured: ['front', 'left', 'right'], message: 'Your scan is saved.', result: state.enrollment.result } : ready);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setView({ ...ready, state: 'scanning', message: FACE_ANGLES[0].instruction });
    if (await faceEnrollment.availability() === 'unavailable') {
      setView({ ...ready, state: 'unavailable', message: 'No camera is available here. You can add a scan later from You.' });
      return;
    }
    faceEnrollment.enroll(step => {
      if (controller.signal.aborted) return;
      if (step.kind === 'capturing') setView({ state: 'scanning', angle: step.angle, progress: step.progress, captured: step.captured,
        message: FACE_ANGLES.find(a => a.key === step.angle)?.instruction ?? '' });
      else if (step.kind === 'success') {
        setView({ state: 'success', angle: 'right', progress: 1, captured: ['front', 'left', 'right'], message: 'Your scan is saved.', result: step.result });
        dispatch({ type: 'enrollment', enrollment: { status: 'enrolled', enrolledAt: step.result.capturedAt, sample: step.result.sample, result: step.result } });
        if (!state.draft.portraitUrl) dispatch({ type: 'draft', patch: { portraitUrl: step.result.portraitUrl } });
      }
      else if (step.kind === 'interrupted') setView(v => ({ ...v, state: 'interrupted', message: step.reason }));
      else setView({ ...ready, state: 'unavailable', message: step.reason });
    }, controller.signal);
  }, [faceEnrollment, dispatch, state.draft.portraitUrl]);

  const scanning = view.state === 'scanning';
  const next = () => standalone ? (router.canGoBack() ? router.back() : router.replace('/profile')) : router.push('/signup/details');
  const lede = 'A quick scan lets the people you meet recognize you, only at events where you turn Glance on. It isn’t a login, and you can remove it any time.';
  const footer = <>
      {view.state === 'success' && <Button testID="face-continue" onPress={next} icon={standalone ? 'check' : 'arrow-right'}>{standalone ? 'Done' : 'Continue'}</Button>}
      {view.state === 'ready' && <Button testID="face-start" onPress={() => void start()} icon="aperture">{demo ? 'Start sample scan' : 'Start scan'}</Button>}
      {scanning && <Button disabled onPress={() => undefined}>Scanning…</Button>}
      {view.state === 'interrupted' && <Button testID="face-retry" onPress={() => void start()} icon="rotate-ccw">Try again</Button>}
      {view.state === 'unavailable' && <>
        <Button testID="face-retry" onPress={() => void start()} icon="rotate-ccw">Try again</Button>
        <Button tone="ghost" testID="face-skip" onPress={next}>{standalone ? 'Back' : 'Set up later from You'}</Button>
      </>}
      {view.state === 'success' && <Button tone="quiet" size="sm" onPress={() => void start()}>Scan again</Button>}
    </>;
  const body = <>
    <View style={{ alignItems: 'center', gap: 18, paddingVertical: 8 }}>
      <FaceFrame state={view.state} angle={view.angle} progress={view.progress} captured={view.captured} portraitUrl={view.result?.portraitUrl} />
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={[type.subheading, { textAlign: 'center', maxWidth: 320 }]}>{view.message}</Text>
        {demo && view.state !== 'ready' && <SampleTag>{view.state === 'success' ? 'Sample scan, no camera used' : 'Sample scan'}</SampleTag>}
      </View>
    </View>
    {view.state === 'ready' && <View style={{ gap: 10 }}>
      {[
        { icon: 'eye' as const, text: 'Look at the frame, then turn slightly left and right.' },
        { icon: 'shield' as const, text: 'Only attendees of events where you turn Glance on can recognize you.' },
        { icon: 'trash-2' as const, text: 'Remove your scan whenever you like from You.' },
      ].map(item => <View key={item.text} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}><Icon name={item.icon} size={14} /></View>
        <Text style={[type.secondary, { flex: 1 }]}>{item.text}</Text>
      </View>)}
    </View>}
    {view.state === 'interrupted' && <Notice icon="info">Nothing was saved. Keep your face inside the frame for the whole scan.</Notice>}
  </>;
  if (standalone) return <Page back title="Face scan" fallback="/profile" footer={footer} testID="face-scan">
    <View style={{ gap: 8 }}><Text accessibilityRole="header" style={type.display}>A face people can place.</Text><Text style={type.secondary}>{lede}</Text></View>
    {body}
  </Page>;
  return <OnboardingFrame step={0} title="A face people can place." lede={lede} footer={footer} testID="signup-face">{body}</OnboardingFrame>;
}

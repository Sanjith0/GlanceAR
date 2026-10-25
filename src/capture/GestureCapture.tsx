import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fonts } from '../theme';
import { assessHand, OneHandGate, TwoHandGate } from '../handGesture';
import { startHandTracking } from './handEngine';
import { drawHandOverlays } from './handOverlay';
import { acquireLiveCameraStream } from './liveCameraStream';

export type GestureSignal = { hands: number; stable: boolean; source: 'phone' | 'glasses' };
export type GestureCaptureProps = {
  active: boolean;
  armed?: boolean;
  sessionId?: string;
  source?: 'phone' | 'glasses';
  onSignal: (event: GestureSignal) => void;
  onStatus?: (message: string) => void;
  /** 2: both people's hands in this camera (demo). 1: this camera faces the other person (live). */
  handsRequired?: 1 | 2;
  /** One-hand mode: whose hand this camera is watching for. */
  partnerName?: string;
  /** Changing this re-arms a gate that already fired, without restarting the camera. */
  rearmKey?: number;
  style?: StyleProp<ViewStyle>;
};

/** Browser camera access is requested only when the deliberate LIVE view mounts. */
export async function requestGestureCameraPermission(): Promise<boolean> { return false; }
/** Private setup copying remains a local-only native action. */
export async function copyPrivateSetupJSON(_value: string): Promise<boolean> { return false; }

export default function GestureCapture({ active, armed = true, sessionId, source = 'phone', onSignal, onStatus, handsRequired = 2, partnerName = 'their', rearmKey = 0, style }: GestureCaptureProps) {
  const video = useRef<HTMLVideoElement | null>(null), canvas = useRef<HTMLCanvasElement | null>(null);
  const twoHands = useRef(new TwoHandGate()), oneHand = useRef(new OneHandGate());
  const [status, setStatus] = useState('Starting LIVE camera…');
  const [progress, setProgress] = useState(0), [mirrored, setMirrored] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [retry, setRetry] = useState(0), [canRetry, setCanRetry] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const cameraKey = JSON.stringify([active, visible, source, sessionId, retry]);
  const latest = useRef({ cameraKey, armed, onSignal, onStatus, handsRequired, partnerName });
  const [renderedInputs, setRenderedInputs] = useState({ cameraKey, armed });
  // Reconcile prop-driven visual resets during render, not a cascading effect.
  // Disarming alone must not hide the live video during the green acknowledgment.
  if (renderedInputs.cameraKey !== cameraKey || renderedInputs.armed !== armed) {
    setRenderedInputs({ cameraKey, armed });
    setProgress(0);
    if (renderedInputs.cameraKey !== cameraKey) { setVideoReady(false); setCanRetry(false); }
  }
  useLayoutEffect(() => { latest.current = { cameraKey, armed, onSignal, onStatus, handsRequired, partnerName }; });
  useLayoutEffect(() => { twoHands.current.reset(); oneHand.current.reset(); }, [armed, sessionId, handsRequired, rearmKey]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    const hide = () => setVisible(false);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', update);
    };
  }, []);

  useEffect(() => {
    const gates = [twoHands.current, oneHand.current];
    gates.forEach(g => g.reset());
    const element = video.current;
    let stopped = false;
    let lease: Awaited<ReturnType<typeof acquireLiveCameraStream>> | null = null;
    let stopTracking: (() => void) | undefined;
    let unwatchTracks: (() => void) | undefined;
    const controller = new AbortController();
    // The layout-committed key changes before passive cleanup. Old async work
    // must not publish to a newly committed session's handlers in that window.
    const isCurrent = () => !stopped && latest.current.cameraKey === cameraKey;
    const report = (message: string) => {
      if (!isCurrent()) return;
      setStatus(message); latest.current.onStatus?.(message);
    };
    const clearOverlay = () => {
      const overlay = canvas.current;
      if (overlay) overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    };
    if (!active || !visible) { report('Camera off'); return; }
    if (source !== 'phone') { report('Glasses video is not available in this browser. No gesture is simulated.'); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      report('Camera unavailable. Open this page over HTTPS in a current browser.'); return;
    }
    void (async () => {
      try {
        if (!element) return;
        report('Starting LIVE camera…');
        const acquired = await acquireLiveCameraStream(undefined, `conversation:${sessionId ?? 'standalone'}`, controller.signal);
        if (!isCurrent()) { acquired.release(); return; }
        lease = acquired;
        const ended = () => {
          if (!isCurrent()) return;
          stopTracking?.(); twoHands.current.reset(); oneHand.current.reset(); setProgress(0); setVideoReady(false); setCanRetry(true);
          clearOverlay();
          report('Camera stopped. Retry here to continue the conversation.');
        };
        acquired.stream.getVideoTracks().forEach(track => track.addEventListener('ended', ended));
        unwatchTracks = () => acquired.stream.getVideoTracks().forEach(track => track.removeEventListener('ended', ended));
        element.srcObject = acquired.stream; setMirrored(acquired.mirrored);
        await element.play();
        if (!isCurrent()) return;
        setVideoReady(true);
        report('Loading on-device hand detection…');
        stopTracking = startHandTracking({
          video: element,
          isCurrent,
          isLive: () => lease?.stream.getVideoTracks()[0]?.readyState === 'live',
          onReady: () => report(latest.current.handsRequired === 1
            ? `Watching for ${latest.current.partnerName} hand: thumb, index and middle up.`
            : 'Both people: show one hand each.'),
          onFrame: (hands, timestamp) => {
            if (!isCurrent()) return;
            const assessments = hands.map(hand => assessHand(hand, element.videoWidth / element.videoHeight));
            const overlay = canvas.current;
            if (overlay) {
              if (overlay.width !== element.videoWidth) overlay.width = element.videoWidth;
              if (overlay.height !== element.videoHeight) overlay.height = element.videoHeight;
              drawHandOverlays(overlay, hands, assessments);
            }
            const one = latest.current.handsRequired === 1;
            const current = one ? oneHand.current : twoHands.current;
            if (!latest.current.armed) { current.reset(); return; }
            const result = current.observe(assessments, timestamp);
            setProgress(result.progress);
            if (one) {
              const who = latest.current.partnerName;
              report(result.stable ? `${who === 'their' ? 'Their' : who} hand recognized.`
                : result.hands ? 'Hold it steady…'
                  : `Watching for ${who} hand: thumb, index and middle up.`);
              if (result.stable && isCurrent() && latest.current.armed) latest.current.onSignal({ hands: 1, stable: true, source: 'phone' });
              return;
            }
            report(result.stable ? 'Both gestures recognized.'
              : hands.length > 2 ? 'Keep only two hands in view, one from each person.'
                : result.hands === 2 ? 'Hold both gestures steady…'
                  : `${result.hands} of 2 ready. Thumb, index and middle up; ring and little folded.`);
            if (result.stable && isCurrent() && latest.current.armed) latest.current.onSignal({ hands: 2, stable: true, source: 'phone' });
          },
          onError: error => {
            if (!isCurrent()) return;
            twoHands.current.reset(); oneHand.current.reset(); setProgress(0); setCanRetry(true); clearOverlay();
            if (lease?.stream.getVideoTracks()[0]?.readyState !== 'live') {
              setVideoReady(false); report('Camera stopped. Retry here to continue the conversation.');
            } else report(`Hand detection unavailable: ${error instanceof Error ? error.message : 'model could not run'}. Retry here.`);
          },
        });
      } catch (error) {
        if (!isCurrent()) return;
        lease?.release(); lease = null;
        setVideoReady(false); setCanRetry(true); clearOverlay();
        if (element) element.srcObject = null;
        const name = error instanceof Error ? error.name : '';
        report(name === 'NotAllowedError' ? 'Camera permission is off. Allow camera access for this site, then retry here.'
          : name === 'NotFoundError' ? 'No camera was found on this device.'
            : `Camera unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    })();
    return () => {
      stopped = true; unwatchTracks?.(); controller.abort(); stopTracking?.(); gates.forEach(g => g.reset());
      lease?.release();
      if (element) element.srcObject = null;
      clearOverlay();
    };
  }, [active, visible, source, sessionId, retry, cameraKey]);

  const mediaStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
    transform: mirrored ? 'scaleX(-1)' : undefined, opacity: active && visible ? 1 : 0 };
  return <View style={[styles.frame, style]}>
    <video ref={video} muted playsInline autoPlay aria-label="LIVE hand gesture camera" style={mediaStyle} />
    <canvas ref={canvas} aria-hidden="true" style={{ ...mediaStyle, pointerEvents: 'none' }} />
    <View pointerEvents="none" style={styles.live}><Text style={styles.liveText}>{active && visible && videoReady ? 'LIVE CAMERA' : 'CAMERA OFF'}</Text></View>
    {canRetry && active && visible && <Pressable accessibilityRole="button" accessibilityLabel="Retry camera and hand detection"
      onPress={() => setRetry(value => value + 1)} style={styles.retry}><Text style={styles.retryText}>Retry camera</Text></Pressable>}
    <View pointerEvents="none" style={styles.caption}>
      <Text accessibilityLiveRegion="polite" style={styles.captionText}>{status}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        accessibilityLabel="Two-hand gesture hold" style={styles.track}>
        <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { minHeight: 240, backgroundColor: '#10161b', borderRadius: 18, overflow: 'hidden' },
  live: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' },
  liveText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1 },
  retry: { position: 'absolute', top: 8, right: 8, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#FFFFFF' },
  retryText: { color: '#17323b', fontFamily: fonts.semibold, fontSize: 12 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, gap: 8, backgroundColor: 'rgba(0,0,0,0.72)' },
  captionText: { color: '#FFFFFF', fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  track: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  progress: { height: 4, backgroundColor: '#38E59A' },
});

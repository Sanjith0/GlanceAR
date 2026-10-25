import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../components';
import { colors, fonts } from '../theme';
import { projectBox, type FaceBox } from '../face';
import { cropFace, detectFaces, faceEngineSupported, loadFaceEngine, type DetectedFace } from './faceEngine';
import { acquireLiveCameraStream, type LiveCameraLease } from './liveCameraStream';

export type FaceFrame = { faces: DetectedFace[]; width: number; height: number; crop: (box: FaceBox) => string };
export type FaceOverlay = {
  key: string; box: FaceBox; title: string; detail?: string; points?: string[];
  tone: 'match' | 'self' | 'unknown' | 'scan';
};
export type FaceCameraProps = {
  active: boolean;
  scopeId?: string;
  overlays: FaceOverlay[];
  onFrame: (frame: FaceFrame) => void;
  style?: StyleProp<ViewStyle>;
};

const tones = {
  match: { border: '#2BD687', fill: 'rgba(20,107,85,0.92)' },
  self: { border: '#8FB6FF', fill: 'rgba(36,104,221,0.9)' },
  unknown: { border: 'rgba(255,255,255,0.7)', fill: 'rgba(11,27,58,0.78)' },
  scan: { border: '#FFD166', fill: 'rgba(11,27,58,0.85)' },
};

/** Video only. Only an explicit, bounded conversation handoff survives unmount. */
export default function FaceCamera({ active, scopeId = 'live:camera', overlays, onFrame, style }: FaceCameraProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const latestFrame = useRef(onFrame);
  useLayoutEffect(() => { latestFrame.current = onFrame; });
  const [status, setStatus] = useState('Starting camera…');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [mirrored, setMirrored] = useState(true);
  const [cameras, setCameras] = useState(0);
  const [source, setSource] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');

  useEffect(() => {
    if (typeof document === 'undefined') return;
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

  const supported = faceEngineSupported();
  useEffect(() => {
    if (!active || !visible || !supported) return;
    const element = video.current;
    let stopped = false, lease: LiveCameraLease | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const loop = async () => {
      if (stopped || !element) return;
      if (!lease?.stream.getVideoTracks().some(track => track.readyState === 'live')) {
        setStatus('Camera stopped. Reopen LIVE Camera to continue.');
        return;
      }
      try {
        if (element.readyState >= 2 && element.videoWidth) {
          const faces = await detectFaces(element);
          if (stopped) return;
          setSource(old => old.width === element.videoWidth && old.height === element.videoHeight
            ? old : { width: element.videoWidth, height: element.videoHeight });
          latestFrame.current({ faces, width: element.videoWidth, height: element.videoHeight, crop: box => cropFace(element, box) });
        }
      } catch (error) {
        if (!stopped) setStatus(`Face detection stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
        return;
      }
      timer = setTimeout(() => { void loop(); }, 120);
    };
    (async () => {
      try {
        if (!element) return;
        lease = await acquireLiveCameraStream(facing, scopeId, controller.signal);
        if (stopped) { lease.release(); return; }
        element.srcObject = lease.stream;
        await element.play();
        if (stopped) return;
        setMirrored(lease.mirrored);
        void navigator.mediaDevices.enumerateDevices()
          .then(devices => { if (!stopped) setCameras(devices.filter(d => d.kind === 'videoinput').length); })
          .catch(() => {});
        setStatus('Loading on-device face models…');
        await loadFaceEngine();
        if (stopped) return;
        setStatus('Live');
        void loop();
      } catch (error) {
        if (stopped) return;
        lease?.release();
        lease = null;
        if (element) element.srcObject = null;
        const name = error instanceof Error ? error.name : '';
        setStatus(name === 'NotAllowedError' ? 'Camera permission is off. Allow camera access for this site and reopen LIVE Camera.'
          : name === 'NotFoundError' ? 'No camera was found on this device.'
            : `Camera unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      lease?.release();
      if (element) element.srcObject = null;
      setStatus('Starting camera…');
    };
  }, [active, visible, supported, facing, scopeId]);

  const shown = !active || !visible ? 'Camera off'
    : !supported ? 'This browser can’t open the camera here. Use a current browser over HTTPS or localhost.' : status;
  const live = shown === 'Live';
  return <View style={[styles.frame, style]} onLayout={e => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
    <video ref={video} muted playsInline autoPlay aria-label="LIVE Camera view"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
        transform: mirrored ? 'scaleX(-1)' : undefined, opacity: active && visible ? 1 : 0 }} />
    {live && source.width > 0 && overlays.map(overlay => {
      const box = projectBox(overlay.box, source, view, mirrored);
      const tone = tones[overlay.tone];
      const labelWidth = Math.min(Math.max(box.width, 190), view.width - 16);
      const labelLeft = Math.min(Math.max(box.x + box.width / 2 - labelWidth / 2, 8), view.width - labelWidth - 8);
      // Below the face if it fits, else above, else pinned inside the frame (over the face).
      const labelHeight = 35 + (overlay.detail ? 17 : 0) + (overlay.points?.length ?? 0) * 36;
      const below = box.y + box.height + 6, above = box.y - 6 - labelHeight;
      const labelTop = below + labelHeight <= view.height - 8 ? below
        : above >= 8 ? above : Math.max(view.height - labelHeight - 8, 8);
      return <React.Fragment key={overlay.key}>
        <View pointerEvents="none" style={[styles.box, { left: box.x, top: box.y, width: box.width, height: box.height, borderColor: tone.border }]} />
        <View pointerEvents="none" accessibilityRole="text" style={[styles.label,
          { left: labelLeft, top: labelTop, width: labelWidth, backgroundColor: tone.fill }]}>
          <Text style={styles.title} numberOfLines={1}>{overlay.title}</Text>
          {overlay.detail ? <Text style={styles.detail}>{overlay.detail}</Text> : null}
          {overlay.points?.map(point => <Text key={point} style={styles.point}>• {point}</Text>)}
        </View>
      </React.Fragment>;
    })}
    {!live && <View style={styles.status}><Icon name={active ? 'camera' : 'camera-off'} size={26} color="#BCD1D6" />
      <Text style={styles.statusText}>{shown}</Text></View>}
    {live && cameras > 1 && <Pressable accessibilityRole="button" accessibilityLabel="Switch camera"
      onPress={() => setFacing(facing === 'environment' ? 'user' : 'environment')} style={styles.flip}>
      <Icon name="refresh-cw" size={18} color={colors.paper} /></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { height: 440, backgroundColor: '#10161b', borderRadius: 20, overflow: 'hidden' },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 12 },
  label: { position: 'absolute', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  title: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  detail: { color: '#D9E7FF', fontFamily: fonts.body, fontSize: 11, lineHeight: 15 },
  point: { color: '#FFFFFF', fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  status: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  statusText: { color: '#FFFFFF', fontFamily: fonts.body, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  flip: { position: 'absolute', top: 12, right: 12, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
});

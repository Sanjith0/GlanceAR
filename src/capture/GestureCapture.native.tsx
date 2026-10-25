import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import captureModule from '../../modules/glance-capture';

export type CaptureSource = 'phone' | 'glasses';
export type GestureSignal = { hands: number; stable: boolean; source: CaptureSource };
export type GestureCaptureProps = {
  active: boolean;
  source?: CaptureSource;
  onSignal: (event: GestureSignal) => void;
  onStatus?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
};

type NativeProps = {
  active: boolean;
  source: CaptureSource;
  style?: StyleProp<ViewStyle>;
  onSignal: (event: { nativeEvent: GestureSignal }) => void;
  onStatus: (event: { nativeEvent: { message: string } }) => void;
};

let NativeCapture: React.ComponentType<NativeProps> | null = null;
if (Platform.OS === 'ios' && captureModule) {
  try {
    NativeCapture = requireNativeViewManager<NativeProps>('GlanceCapture');
  } catch {
    // Expo Go / a stale development client is an unavailable capability, not a
    // fallback detector. The UI explains how to get a real native build.
  }
}

export default function GestureCapture({
  active,
  source = 'phone',
  onSignal,
  onStatus,
  style,
}: GestureCaptureProps) {
  const [status, setStatus] = useState('Camera off');
  const unavailable = source === 'glasses'
    ? 'Glasses capture is not connected to this Expo app. The separate DAT iPhone harness tests real glasses frames. “Meta Adventurer” support is unverified.'
    : Platform.OS !== 'ios'
      ? 'Native hand capture currently requires an iPhone. No signal is simulated.'
      : !NativeCapture
        ? 'Real hand detection requires the GlanceAR iOS development build. Expo Go does not contain the Vision capture module.'
        : null;

  useEffect(() => {
    if (unavailable) onStatus?.(unavailable);
  }, [onStatus, unavailable]);

  if (unavailable || !NativeCapture) {
    return (
      <View style={[styles.placeholder, style]} accessibilityRole="text">
        <Text style={styles.heading}>Camera capture unavailable</Text>
        <Text style={styles.explanation}>{unavailable}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, style]}>
      <NativeCapture
        style={StyleSheet.absoluteFill}
        active={active}
        source={source}
        onSignal={({ nativeEvent }) => {
          // Native generation guards also reject late frames after disarming.
          if (active && nativeEvent.source === source) onSignal(nativeEvent);
        }}
        onStatus={({ nativeEvent }) => {
          setStatus(nativeEvent.message);
          onStatus?.(nativeEvent.message);
        }}
      />
      <View pointerEvents="none" style={styles.caption}>
        <Text style={styles.captionText}>{active ? status : 'Camera off'}</Text>
        {active && <Text style={styles.hint}>Both people: show one hand each, palms toward camera. Hold both three-finger signals for about a second.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { minHeight: 220, backgroundColor: '#10161b', borderRadius: 18, overflow: 'hidden' },
  placeholder: { minHeight: 180, padding: 20, justifyContent: 'center', backgroundColor: '#eaf0f1', borderRadius: 18 },
  heading: { color: '#17323b', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  explanation: { color: '#455d66', fontSize: 13, lineHeight: 20 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: 'rgba(0,0,0,0.64)' },
  captionText: { color: '#ffffff', fontSize: 12, lineHeight: 17 },
  hint: { color: '#bcd1d6', fontSize: 11, lineHeight: 16, marginTop: 4 },
});

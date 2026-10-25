import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../components';
import { colors, s } from '../theme';
import type { FaceBox } from '../face';

export type FaceFrame = { faces: { box: FaceBox; score: number; descriptor?: number[] }[]; width: number; height: number; sampledAt: number; crop: (box: FaceBox) => string };
export type FaceOverlay = {
  key: string; box: FaceBox; title: string; detail?: string; points?: string[];
  tone: 'match' | 'self' | 'unknown' | 'scan';
};
export type FaceCameraProps = {
  active: boolean; scopeId?: string; overlays: FaceOverlay[];
  onFrame: (frame: FaceFrame) => void; onCameraReset?: () => void; style?: StyleProp<ViewStyle>;
};

/**
 * No native face model is linked yet. Templates come from the browser's face-api
 * model, so a native detector must use the same model or it would never match.
 */
export default function FaceCamera({ style }: FaceCameraProps) {
  return <View style={[s.soft, { alignItems: 'center', padding: 28 }, style]}>
    <Icon name="camera-off" size={28} color={colors.blue} />
    <Text style={[s.small, { textAlign: 'center' }]}>LIVE Camera recognition currently runs in the browser build. The iPhone app needs a native port of the same face model before it can recognize attendees.</Text>
  </View>;
}

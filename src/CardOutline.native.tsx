import React from 'react';
import { View } from 'react-native';
import { colors } from './theme';

/** Native build: a plain outline. The travelling line is drawn only in the browser build. */
export function CardOutline({ width, height, radius, progress }: {
  width: number; height: number; radius: number; progress: number; active: boolean;
}) {
  if (width < 8 || height < 8) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, borderRadius: radius,
    borderWidth: 2, borderColor: progress > 0 ? colors.violet : colors.violetSoft, opacity: 0.35 + 0.65 * Math.max(0, Math.min(1, progress)) }} />;
}

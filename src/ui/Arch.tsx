import React, { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../components';
import { colors, fonts, type } from '../theme';
import { useReducedMotion } from './motion';

/** A filled arch: full radius on top, a small radius at the base. */
export function Arch({ width, height, color = colors.powder, style, children, base = 0.08 }: {
  width: number; height: number; color?: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode; base?: number;
}) {
  return <View style={[{ width, height, backgroundColor: color, overflow: 'hidden',
    borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2, borderBottomLeftRadius: width * base, borderBottomRightRadius: width * base }, style]}>
    {children}
  </View>;
}

export type FaceFrameState = 'ready' | 'scanning' | 'success' | 'interrupted' | 'unavailable';
export type FaceAngle = 'front' | 'left' | 'right';
export const FACE_ANGLES: { key: FaceAngle; label: string; instruction: string }[] = [
  { key: 'front', label: 'Front', instruction: 'Look straight at the frame.' },
  { key: 'left', label: 'Slight left', instruction: 'Turn your head a little to the left.' },
  { key: 'right', label: 'Slight right', instruction: 'Now a little to the right.' },
];

/**
 * The guided enrollment frame. The arch outline carries the state; three marks
 * above it record the captured angles. The silhouette is a stand-in for a live
 * preview and never a camera.
 */
export function FaceFrame({ state, angle, progress, captured, portraitUrl, width = 232 }: {
  state: FaceFrameState; angle: FaceAngle; progress: number; captured: FaceAngle[]; portraitUrl?: string; width?: number;
}) {
  const height = Math.round(width * 1.24);
  const reduced = useReducedMotion();
  const [sweep] = useState(() => new Animated.Value(0));
  const [breathe] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (state !== 'scanning' || reduced) { sweep.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(sweep, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [state, reduced, sweep]);
  useEffect(() => {
    if (state !== 'ready' || reduced) { breathe.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(breathe, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [state, reduced, breathe]);

  const outline = state === 'interrupted' ? colors.danger : state === 'success' ? colors.green : state === 'unavailable' ? colors.faint : colors.ink;
  const tilt = angle === 'left' ? '-10deg' : angle === 'right' ? '10deg' : '0deg';
  const headSize = width * 0.42;
  return <View style={{ alignItems: 'center', gap: 14 }}>
    <View accessibilityRole="image" accessibilityLabel={`Face frame, ${state}`} style={{ width: width + 28, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
        {FACE_ANGLES.map(item => {
          const done = captured.includes(item.key);
          const active = item.key === angle && state === 'scanning';
          return <View key={item.key} accessible accessibilityLabel={`${item.label}${done ? ', captured' : active ? ', capturing' : ''}`}
            style={{ alignItems: 'center', gap: 5, width: 64 }}>
            <View style={{ width: 22, height: 26, borderTopLeftRadius: 11, borderTopRightRadius: 11, borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
              backgroundColor: done ? colors.ink : active ? colors.powderDeep : colors.creamDeep, alignItems: 'center', justifyContent: 'center' }}>
              {done && <Icon name="check" size={12} color={colors.cream} />}
            </View>
            <Text style={[type.micro, { color: done || active ? colors.ink : colors.faint }]}>{item.label}</Text>
          </View>;
        })}
      </View>
      <View style={{ width, height, borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2, borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
        borderWidth: 2.5, borderColor: outline, borderStyle: state === 'unavailable' ? 'dashed' : 'solid', backgroundColor: colors.paper, overflow: 'hidden',
        alignItems: 'center', justifyContent: 'flex-end' }}>
        {state === 'success' && portraitUrl
          ? <Image source={{ uri: portraitUrl }} accessibilityLabel="Your sample portrait" style={{ width: '100%', height: '100%' }} />
          : <Animated.View style={{ alignItems: 'center', transform: [{ rotate: tilt }, { translateY: state === 'ready' ? breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) : 0 }],
            opacity: state === 'unavailable' ? 0.35 : 1 }}>
            <View style={{ width: headSize, height: headSize * 1.18, borderRadius: headSize / 2, backgroundColor: colors.powder,
              transform: [{ translateX: angle === 'left' ? -headSize * 0.12 : angle === 'right' ? headSize * 0.12 : 0 }] }} />
            <View style={{ width: width * 0.86, height: width * 0.42, backgroundColor: colors.powder, marginTop: -headSize * 0.1,
              borderTopLeftRadius: width * 0.36, borderTopRightRadius: width * 0.36, marginBottom: -width * 0.1 }} />
          </Animated.View>}
        {state === 'scanning' && <Animated.View pointerEvents="none" style={[styles.sweep, { top: sweep.interpolate({ inputRange: [0, 1], outputRange: [height * 0.12, height * 0.86] }) }]} />}
        {state === 'scanning' && <View pointerEvents="none" style={[styles.progressTrack, { width: width * 0.62 }]}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>}
        {state === 'success' && <View style={styles.successTag}><Icon name="check" size={14} color={colors.cream} /><Text style={styles.successText}>Scan saved</Text></View>}
        {state === 'interrupted' && <View style={[styles.successTag, { backgroundColor: colors.danger }]}><Icon name="alert-circle" size={14} color={colors.cream} /><Text style={styles.successText}>Interrupted</Text></View>}
        {state === 'unavailable' && <View style={[styles.successTag, { backgroundColor: colors.plumSoft }]}><Icon name="camera-off" size={14} color={colors.cream} /><Text style={styles.successText}>Camera unavailable</Text></View>}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  sweep: { position: 'absolute', left: 14, right: 14, height: 2, backgroundColor: colors.powderDeep, opacity: 0.9 },
  progressTrack: { position: 'absolute', bottom: 18, height: 4, borderRadius: 2, backgroundColor: colors.creamDeep, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.ink },
  successTag: { position: 'absolute', bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.green,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  successText: { fontFamily: fonts.semibold, color: colors.cream, fontSize: 13, lineHeight: 17 },
});

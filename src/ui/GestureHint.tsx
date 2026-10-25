import React from 'react';
import { Text, View } from 'react-native';
import { colors, type } from '../theme';

/** A compact, one-time explanation of the three-finger finish: thumb, pointer and middle up, the rest folded. */
export function GestureHint({ compact = false }: { compact?: boolean }) {
  const fingers = [
    { h: 30, up: true, label: 'thumb', tilt: '-28deg', x: -14 },
    { h: 46, up: true, label: 'pointer', tilt: '-6deg', x: 0 },
    { h: 50, up: true, label: 'middle', tilt: '2deg', x: 0 },
    { h: 22, up: false, label: 'ring', tilt: '6deg', x: 0 },
    { h: 18, up: false, label: 'little', tilt: '12deg', x: 0 },
  ];
  return <View accessible accessibilityLabel="Three-finger sign: thumb, pointer and middle finger up, ring and little finger folded"
    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.paper, borderRadius: 18, padding: compact ? 12 : 16 }}>
    <View style={{ width: 84, height: 70, alignItems: 'flex-end', justifyContent: 'flex-end', flexDirection: 'row', gap: 5, paddingBottom: 6 }}>
      {fingers.map(finger => <View key={finger.label} style={{ width: 11, height: finger.h, borderRadius: 6, marginLeft: finger.x,
        backgroundColor: finger.up ? colors.ink : colors.lineStrong, transform: [{ rotate: finger.tilt }] }} />)}
      <View style={{ position: 'absolute', left: 30, right: 0, bottom: -6, height: 22, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: colors.powder }} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.subheading}>Three fingers to finish</Text>
      <Text style={type.small}>Each of you holds up thumb, pointer and middle, rest folded, for about a second. Or use the button below.</Text>
    </View>
  </View>;
}

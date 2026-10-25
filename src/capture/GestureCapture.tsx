import React from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../components';
import { colors, s } from '../theme';

export default function GestureCapture({ active, style }: {
  active: boolean; source?: 'phone' | 'glasses';
  onSignal: (event: { hands: number; stable: boolean; source: 'phone' | 'glasses' }) => void;
  onStatus?: (message: string) => void; style?: StyleProp<ViewStyle>;
}) {
  if (!active) return null;
  return <View style={[s.soft, { alignItems: 'center', padding: 28 }, style]}>
    <Icon name="camera-off" size={28} color={colors.blue} />
    <Text style={[s.small, { textAlign: 'center' }]}>Camera gesture detection requires the native iPhone build. This web walkthrough uses an explicitly simulated gesture.</Text>
  </View>;
}

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, fonts, s } from './theme';
import type { CameraDevice } from './capture/glassesBridge';

/** iPhone camera / Ray-Ban Meta switch. Render only inside the Glance Glasses Live iPhone shell. */
export function CameraPicker({ value, onChange, note }: { value: CameraDevice; onChange: (device: CameraDevice) => void; note?: string }) {
  const options: { device: CameraDevice; label: string }[] = [{ device: 'phone', label: 'iPhone camera' }, { device: 'glasses', label: 'Ray-Ban Meta' }];
  return <View style={{ gap: 6 }}>
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.line }}>
      {options.map(option => {
        const selected = option.device === value;
        return <Pressable key={option.device} testID={`camera-${option.device}`} accessibilityRole="radio" accessibilityState={{ selected }}
          onPress={() => onChange(option.device)}
          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: selected ? colors.paper : 'transparent' }}>
          <Text style={{ fontFamily: selected ? fonts.bold : fonts.medium, fontSize: 14, color: selected ? colors.ink : colors.muted }}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    {value === 'glasses' && note ? <Text style={s.small}>{note}</Text> : null}
  </View>;
}

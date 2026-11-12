import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, fonts, s } from '../theme';
import { setUi, useDiscover, type UiMode } from './store';

/** Accent for the Events face. 4.8:1 on white, so it also carries small text. */
export const eventsBlue = '#0866FF';
export const eventsBlueLight = '#E7F0FF';

const MODES: readonly { mode: UiMode; label: string; hint: string }[] = [
  { mode: 'glance', label: 'Glance', hint: 'Glance view' },
  { mode: 'events', label: 'Events', hint: 'Events view' },
];

/** Switches the whole app between the usual Glance UI and the Events (Discover) UI. */
export function ModeSwitch() {
  const { ui } = useDiscover();
  return <View accessibilityRole="tablist" accessibilityLabel="App view" style={{ flexDirection: 'row', backgroundColor: colors.canvas, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: colors.line }}>
    {MODES.map(({ mode, label, hint }) => {
      const selected = ui === mode;
      return <Pressable key={mode} testID={`ui-mode-${mode}`} accessibilityRole="tab" accessibilityLabel={hint}
        aria-selected={selected} onPress={() => setUi(mode)}
        style={({ pressed }) => [{ minHeight: 38, paddingHorizontal: 14, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
          selected && { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line }, pressed && s.pressed]}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: selected ? (mode === 'events' ? eventsBlue : colors.ink) : colors.muted }}>{label}</Text>
      </Pressable>;
    })}
  </View>;
}

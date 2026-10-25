import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Icon, useIsDesktop } from '../../components';
import { colors, fonts } from '../../theme';
import { NAV } from '../../ui/Shell';
import { Protected } from '../../services/Protected';

/** Three destinations. Hidden on desktop, where the rail takes over. */
function PhoneTabBar({ state, navigateToTab, emitter }: BottomTabBarProps) {
  const desktop = useIsDesktop();
  if (desktop) return null;
  return <View accessibilityRole="tablist" style={styles.bar}>
    {state.routes.map((route, index) => {
      const item = NAV.find(n => n.key === route.name);
      if (!item) return null;
      const active = state.index === index;
      return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label}
        onPress={() => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!active && !event.defaultPrevented) navigateToTab(route.key);
        }} style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
        <View style={[styles.pill, active && styles.pillActive]}><Icon name={item.icon} size={20} color={colors.ink} /></View>
        <Text style={[styles.label, active && { color: colors.ink, fontFamily: fonts.semibold }]}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export default function TabsLayout() {
  return <Protected>
    <Tabs tabBar={props => <PhoneTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}>
      <Tabs.Screen name="events" options={{ title: 'Events' }} />
      <Tabs.Screen name="connections" options={{ title: 'Connections' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  </Protected>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.canvas, paddingTop: 8, paddingBottom: 10, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 56, justifyContent: 'center' },
  pill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: colors.powder },
  label: { fontFamily: fonts.medium, color: colors.muted, fontSize: 12, lineHeight: 16, flexShrink: 0 },
});

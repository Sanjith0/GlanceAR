import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Icon, Portrait, Wordmark, useIsDesktop, type IconName } from '../components';
import { colors, fonts, s } from '../theme';
import { useSession } from '../services/session';
import { useMe } from '../services/views';

export const NAV: { key: string; label: string; icon: IconName; href: '/events' | '/connections' | '/profile' }[] = [
  { key: 'events', label: 'Events', icon: 'calendar', href: '/events' },
  { key: 'connections', label: 'Connections', icon: 'users', href: '/connections' },
  { key: 'profile', label: 'You', icon: 'user', href: '/profile' },
];

/**
 * Desktop stage: a plum rail with the wordmark and three destinations beside a
 * capped content column. Phones keep the bottom tab bar instead.
 */
function DesktopRail() {
  const pathname = usePathname();
  const me = useMe();
  return <View accessibilityRole="menubar" style={styles.rail}>
    <Pressable accessibilityRole="link" accessibilityLabel="Glance home" onPress={() => router.navigate('/events')} style={{ marginBottom: 28 }}>
      <Wordmark size={28} color={colors.cream} accent={colors.powder} />
    </Pressable>
    {NAV.map(item => {
      const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        || (item.key === 'events' && /^\/(event|live|create|join|conversation)/.test(pathname))
        || (item.key === 'connections' && /^\/(connection|recap)/.test(pathname));
      return <Pressable key={item.key} accessibilityRole="link" accessibilityState={{ selected: active }} onPress={() => router.navigate(item.href)}
        style={({ pressed }) => [styles.railItem, active && styles.railItemActive, pressed && s.pressed]}>
        <Icon name={item.icon} size={18} color={active ? colors.ink : colors.cream} />
        <Text style={[styles.railLabel, active && { color: colors.ink }]}>{item.label}</Text>
      </Pressable>;
    })}
    <View style={{ flex: 1 }} />
    {me && <Pressable accessibilityRole="link" accessibilityLabel="Open your profile" onPress={() => router.navigate('/profile')} style={[styles.railItem, { gap: 12 }]}>
      <Portrait person={me} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.railLabel, { fontFamily: fonts.semibold }]}>{me.name}</Text>
        <Text numberOfLines={1} style={[styles.railLabel, { fontSize: 12, opacity: 0.7 }]}>{me.occupation}</Text>
      </View>
    </Pressable>}
  </View>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const { status } = useSession();
  const showRail = desktop && status === 'signed-in';
  return <View style={styles.shell}>
    {showRail && <DesktopRail />}
    <View style={styles.main}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },
  main: { flex: 1, minWidth: 0 },
  rail: { width: 232, paddingHorizontal: 18, paddingVertical: 26, backgroundColor: colors.plum, gap: 6 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14 },
  railItemActive: { backgroundColor: colors.powder },
  railLabel: { fontFamily: fonts.medium, color: colors.cream, fontSize: 15, lineHeight: 20 },
});

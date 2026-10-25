import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { colors, fonts, s } from './theme';
import type { Profile } from './domain';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} accessible={false} aria-hidden={true}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
export function Button({ children, onPress, icon, tone = 'primary', disabled = false, busy = false, testID }: {
  children: string; onPress: () => void; icon?: IconName; tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean; busy?: boolean; testID?: string;
}) {
  const background = tone === 'secondary' ? s.secondary : tone === 'ghost' ? s.ghost : tone === 'danger' ? s.danger : undefined;
  const text = tone === 'secondary' ? s.secondaryText : tone === 'ghost' ? s.ghostText : tone === 'danger' ? s.dangerText : undefined;
  const color = disabled || busy ? colors.muted : tone === 'primary' ? colors.paper : tone === 'secondary' ? colors.blue : tone === 'danger' ? colors.danger : colors.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={children} accessibilityState={{ disabled: disabled || busy }}
    testID={testID} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.button, background, (disabled || busy) && s.disabled, pressed && s.pressed]}>
    {busy ? <ActivityIndicator color={color} size="small" /> : icon ? <Icon name={icon} size={18} color={color} /> : null}
    <Text style={[s.buttonText, text, (disabled || busy) && { color: colors.muted }]}>{children}</Text>
  </Pressable>;
}
export function Portrait({ person, size = 52 }: { person: Profile; size?: number }) {
  return person.photoUrl ? <Image accessibilityLabel={`${person.name}'s profile portrait`} source={{ uri: person.photoUrl }}
    style={[s.avatar, { width: size, height: size, borderRadius: size * 0.3 }]} /> :
    <View style={[s.avatar, s.avatarFallback, { width: size, height: size }]}><Text style={s.heading}>{person.name[0]}</Text></View>;
}
export function Badge({ children, green = false }: { children: string; green?: boolean }) {
  return <View style={[s.badge, green && { backgroundColor: colors.greenLight }]}><Text style={[s.badgeText, green && { color: colors.green }]}>{children}</Text></View>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label}
    placeholderTextColor={colors.muted} {...props} style={[s.input, props.style]} /></View>;
}
export function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.status, error && s.error]}>
    <Text style={[s.small, error && { color: colors.danger }]}>{children}</Text>
  </View>;
}
export function Page({ children, back, title, footer }: { children: React.ReactNode; back?: boolean; title?: string; footer?: React.ReactNode }) {
  return <View style={s.page}><ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    {back && <View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel="Go back"
      onPress={() => router.canGoBack() ? router.back() : router.replace('/events')}
      style={{ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="arrow-left" />
    </Pressable><Text style={[s.label, { flex: 1 }]}>{title}</Text></View>}
    {children}
  </ScrollView>{footer && <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 10,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper }}>{footer}</View>}</View>;
}
export function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
    <View style={{ padding: 14, borderRadius: 18, backgroundColor: colors.blueLight }}><Icon name={icon} color={colors.blue} size={26} /></View>
    <Text style={s.heading}>{title}</Text><Text style={[s.muted, { textAlign: 'center' }]}>{text}</Text>
  </View>;
}
export function Wordmark() {
  return <Text style={{ fontFamily: fonts.bold, color: colors.ink, fontSize: 25, letterSpacing: -1.1 }}>glance</Text>;
}

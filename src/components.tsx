import React, { useState } from 'react';
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { colors, fonts, layout, radius, s, space, type } from './theme';
import type { Profile } from './domain';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} accessible={false} aria-hidden={true}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export function Button({ children, onPress, icon, tone = 'primary', disabled = false, busy = false, testID, size = 'md', align = 'center', accessibilityLabel, style }: {
  children: string; onPress: () => void; icon?: IconName; tone?: ButtonTone; size?: 'md' | 'sm';
  disabled?: boolean; busy?: boolean; testID?: string; align?: 'center' | 'start'; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || busy;
  const fill = tone === 'secondary' ? colors.powder : tone === 'ghost' || tone === 'quiet' ? 'transparent' : tone === 'danger' ? colors.dangerLight : colors.ink;
  const color = inactive ? colors.faint : tone === 'primary' ? colors.cream : tone === 'danger' ? colors.danger : colors.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? children} accessibilityState={{ disabled: inactive, busy }}
    testID={testID} disabled={inactive} onPress={onPress}
    style={({ pressed }) => [styles.button, size === 'sm' && styles.buttonSmall, align === 'start' && { justifyContent: 'flex-start' },
      { backgroundColor: fill }, tone === 'ghost' && styles.buttonGhost, inactive && styles.buttonDisabled,
      inactive && tone === 'ghost' && { borderColor: colors.line }, pressed && !inactive && s.pressed, style]}>
    {busy ? <ActivityIndicator color={color} size="small" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={color} /> : null}
    <Text numberOfLines={1} style={[styles.buttonText, size === 'sm' && styles.buttonTextSmall, { color }]}>{children}</Text>
  </Pressable>;
}

/** A small circular press target for icons; 44pt minimum. */
export function IconButton({ name, onPress, label, tone = 'plain', size = 20, disabled, testID }: {
  name: IconName; onPress: () => void; label: string; tone?: 'plain' | 'filled' | 'inverse'; size?: number; disabled?: boolean; testID?: string;
}) {
  const color = tone === 'inverse' ? colors.cream : disabled ? colors.faint : colors.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID}
    onPress={onPress} style={({ pressed }) => [styles.iconButton, tone === 'filled' && { backgroundColor: colors.paper },
      tone === 'inverse' && { backgroundColor: 'rgba(48,42,49,0.55)' }, pressed && s.pressed]}>
    <Icon name={name} size={size} color={color} />
  </Pressable>;
}

const monogramTones = [
  { bg: colors.powder, fg: colors.ink }, { bg: colors.creamDeep, fg: colors.ink },
  { bg: colors.ink, fg: colors.cream }, { bg: colors.powderDeep, fg: colors.ink }, { bg: colors.plum, fg: colors.cream },
] as const;
export function monogramTone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return monogramTones[hash % monogramTones.length];
}
/**
 * The arch is Glance's framing motif: a window you glance through. Portraits,
 * the enrollment frame and event guest imagery all share it.
 */
export function Portrait({ person, size = 52, shape = 'arch', ring = false }: { person: Pick<Profile, 'name' | 'photoUrl'>; size?: number; shape?: 'arch' | 'round' | 'square'; ring?: boolean }) {
  const r = shape === 'arch' ? { borderTopLeftRadius: size / 2, borderTopRightRadius: size / 2, borderBottomLeftRadius: size * 0.16, borderBottomRightRadius: size * 0.16 }
    : shape === 'round' ? { borderRadius: size / 2 } : { borderRadius: size * 0.22 };
  const tone = monogramTone(person.name || '?');
  const ringStyle = ring ? { borderWidth: Math.max(2, size * 0.04), borderColor: colors.paper } : null;
  if (person.photoUrl) return <Image accessibilityLabel={`${person.name}'s portrait`} source={{ uri: person.photoUrl }}
    style={[{ width: size, height: size, backgroundColor: colors.blueLight }, r, ringStyle]} />;
  return <View accessibilityLabel={`${person.name}'s portrait`} style={[{ width: size, height: size, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }, r, ringStyle]}>
    <Text style={{ fontFamily: fonts.display, color: tone.fg, fontSize: size * 0.42, lineHeight: size * 0.5, marginTop: size * 0.08 }}>{(person.name || '?').trim()[0]?.toUpperCase()}</Text>
  </View>;
}

/** Overlapping portraits for a guest preview. */
export function PortraitStack({ people, size = 36, max = 4 }: { people: Pick<Profile, 'id' | 'name' | 'photoUrl'>[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    {shown.map((person, index) => <View key={person.id} style={{ marginLeft: index ? -size * 0.28 : 0 }}><Portrait person={person} size={size} ring /></View>)}
    {people.length > max && <Text style={[type.smallStrong, { marginLeft: 8 }]}>+{people.length - max}</Text>}
  </View>;
}

export type TagTone = 'neutral' | 'blue' | 'green' | 'plum' | 'danger' | 'sample';
export function Tag({ children, tone = 'neutral', icon }: { children: string; tone?: TagTone; icon?: IconName }) {
  const bg = tone === 'blue' ? colors.powder : tone === 'green' ? colors.greenLight : tone === 'plum' ? colors.ink
    : tone === 'danger' ? colors.dangerLight : tone === 'sample' ? colors.paper : colors.creamDeep;
  const fg = tone === 'green' ? colors.green : tone === 'plum' ? colors.cream : tone === 'danger' ? colors.danger : colors.ink;
  return <View style={[styles.tag, { backgroundColor: bg }, tone === 'sample' && { borderWidth: 1, borderColor: colors.lineStrong }]}>
    {icon && <Icon name={icon} size={12} color={fg} />}
    <Text style={[styles.tagText, { color: fg }]}>{children}</Text>
  </View>;
}
/** Legacy alias kept for the camera lab screens. */
export function Badge({ children, green = false }: { children: string; green?: boolean }) {
  return <Tag tone={green ? 'green' : 'blue'}>{children}</Tag>;
}

/** Editable interest chip. Selected chips read as powder blue; removable chips carry an × target. */
export function Chip({ children, selected = false, onPress, onRemove, testID }: { children: string; selected?: boolean; onPress?: () => void; onRemove?: () => void; testID?: string }) {
  const interactive = Boolean(onPress);
  return <View style={[styles.chip, selected && styles.chipSelected]} testID={testID}>
    <Pressable accessibilityRole={interactive ? 'button' : undefined} accessibilityState={{ selected }} disabled={!interactive} onPress={onPress}
      style={({ pressed }) => [styles.chipBody, pressed && interactive && s.pressed]}>
      <Text style={[styles.chipText, selected && { color: colors.ink }]}>{children}</Text>
    </Pressable>
    {onRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${children}`} onPress={onRemove} hitSlop={8}
      style={({ pressed }) => [styles.chipRemove, pressed && s.pressed]}><Icon name="x" size={13} color={colors.muted} /></Pressable>}
  </View>;
}

export function Field({ label, hint, error, optional, multiline, style, testID, inputRef, ...props }: TextInputProps & {
  label: string; hint?: string; error?: string; optional?: boolean; testID?: string; inputRef?: React.ComponentProps<typeof TextInput>['ref'];
}) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
      <Text style={type.label} nativeID={`${testID ?? label}-label`}>{label}</Text>
      {optional && <Text style={type.small}>Optional</Text>}
    </View>
    <TextInput ref={inputRef} accessibilityLabel={label} accessibilityHint={hint} placeholderTextColor={colors.faint}
      multiline={multiline} testID={testID}
      onFocus={event => { setFocused(true); props.onFocus?.(event); }} onBlur={event => { setFocused(false); props.onBlur?.(event); }}
      {...props}
      style={[s.input, multiline && { minHeight: 112, paddingTop: 13, textAlignVertical: 'top' }, focused && styles.inputFocused,
        error ? styles.inputError : null, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null, style]} />
    {error ? <Text accessibilityRole="alert" style={[type.small, { color: colors.danger }]}>{error}</Text>
      : hint ? <Text style={type.small}>{hint}</Text> : null}
  </View>;
}

export function Notice({ children, error = false, icon }: { children: React.ReactNode; error?: boolean; icon?: IconName }) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.status, error && s.error, { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }]}>
    {icon && <Icon name={icon} size={16} color={error ? colors.danger : colors.ink} />}
    <Text style={[type.small, { flex: 1, color: error ? colors.danger : colors.text }]}>{children}</Text>
  </View>;
}

/** Consistent demo labeling: one quiet tag, never a paragraph of disclaimers. */
export function SampleTag({ children = 'Sample' }: { children?: string }) {
  return <Tag tone="sample" icon="eye">{children}</Tag>;
}

export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return width >= layout.desktop;
}

export function BackButton({ fallback = '/events', label = 'Go back' }: { fallback?: string; label?: string }) {
  return <IconButton name="arrow-left" label={label} onPress={() => router.canGoBack() ? router.back() : router.replace(fallback as never)} />;
}

/**
 * Standard screen scaffold: optional header row, scrolling content, sticky footer.
 * On desktop the content column is capped and centered rather than stretched.
 */
export function Page({ children, back, title, headerRight, footer, fallback, wide = false, contentStyle, padded = true, testID }: {
  children: React.ReactNode; back?: boolean; title?: string; headerRight?: React.ReactNode; footer?: React.ReactNode;
  fallback?: string; wide?: boolean; contentStyle?: StyleProp<ViewStyle>; padded?: boolean; testID?: string;
}) {
  const desktop = useIsDesktop();
  const column = { width: '100%' as const, maxWidth: wide ? layout.wide : layout.column, alignSelf: 'center' as const };
  return <View style={s.page} testID={testID}>
    <ScrollView style={s.page} contentContainerStyle={[padded && s.content, { flexGrow: 1 }, column, desktop && { paddingTop: space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {(back || title || headerRight) && <View style={[s.row, { marginLeft: back ? -10 : 0, minHeight: 44 }, !padded && { paddingHorizontal: layout.gutter, paddingTop: space.lg }]}>
        {back && <BackButton fallback={fallback} />}
        <Text numberOfLines={1} style={[type.label, { flex: 1 }]}>{title}</Text>
        {headerRight}
      </View>}
      {children}
    </ScrollView>
    {footer && <View style={styles.footer}><View style={[column, { gap: 10 }]}>{footer}</View></View>}
  </View>;
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: React.ReactNode }) {
  return <View style={[styles.empty]}>
    <View style={styles.emptyArch}><Icon name={icon} color={colors.ink} size={24} /></View>
    <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
    <Text style={[type.secondary, { textAlign: 'center', maxWidth: 320 }]}>{text}</Text>
    {action && <View style={{ marginTop: 6, alignSelf: 'stretch' }}>{action}</View>}
  </View>;
}

export function Section({ title, action, children, note }: { title: string; action?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return <View style={{ gap: space.md }}>
    <View style={s.between}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={type.heading}>{title}</Text>
        {note && <Text style={type.small}>{note}</Text>}
      </View>
      {action}
    </View>
    {children}
  </View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[s.divider, { marginHorizontal: inset }]} />;
}

/** The lowercase wordmark: Fraunces, tight, with the arch as its full stop. */
export function Wordmark({ size = 26, color = colors.ink, accent = colors.powderDeep }: { size?: number; color?: string; accent?: string }) {
  return <View accessibilityRole="header" accessibilityLabel="glance" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
    <Text style={{ fontFamily: fonts.display, color, fontSize: size, lineHeight: size * 1.1, letterSpacing: -size * 0.045 }}>glance</Text>
    <View style={{ width: size * 0.26, height: size * 0.36, marginLeft: size * 0.09, marginBottom: size * 0.16, backgroundColor: accent,
      borderTopLeftRadius: size * 0.13, borderTopRightRadius: size * 0.13, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
  </View>;
}

export function ListRow({ onPress, children, chevron = true, testID, style }: PressableProps & { children: React.ReactNode; chevron?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress ?? undefined} testID={testID}
    style={({ pressed }) => [styles.listRow, pressed && onPress && s.pressed, style]}>
    <View style={[s.row, { flex: 1 }]}>{children}</View>
    {onPress && chevron && <Icon name="chevron-right" color={colors.faint} size={18} />}
  </Pressable>;
}

/** Full-bleed hairline progress used for scans and holds. */
export function ProgressBar({ value, label, tone = 'ink' }: { value: number; label: string; tone?: 'ink' | 'green' | 'blue' }) {
  const fill = tone === 'green' ? colors.green : tone === 'blue' ? colors.powderDeep : colors.ink;
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    style={{ height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.line }}>
    <View style={{ height: 4, borderRadius: 2, backgroundColor: fill, width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
  </View>;
}

/** Step progress for onboarding: the current step is ink, completed steps plum, upcoming steps sand. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return <View accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
    accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }} style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {steps.map((step, index) => <View key={step} style={{ flex: 1, height: 4, borderRadius: 2,
        backgroundColor: index < current ? colors.plumSoft : index === current ? colors.ink : colors.line }} />)}
    </View>
    <Text style={type.micro}>{`Step ${current + 1} of ${steps.length} · ${steps[current]}`}</Text>
  </View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52, paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: 16, paddingVertical: 8 },
  buttonGhost: { borderWidth: 1.5, borderColor: colors.lineStrong },
  buttonDisabled: { backgroundColor: colors.creamDeep },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  buttonTextSmall: { fontSize: 14, lineHeight: 20 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, maxWidth: '100%' },
  chipSelected: { backgroundColor: colors.powder, borderColor: colors.powder },
  chipBody: { paddingLeft: 14, paddingRight: 12, paddingVertical: 9, minHeight: 40, justifyContent: 'center', flexShrink: 1 },
  chipText: { fontFamily: fonts.medium, color: colors.text, fontSize: 14, lineHeight: 20 },
  chipRemove: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -6, marginRight: 2 },
  inputFocused: { borderColor: colors.ink, backgroundColor: colors.white },
  inputError: { borderColor: colors.danger },
  footer: { paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.canvas },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, gap: 12, borderRadius: radius.lg, backgroundColor: colors.paper },
  emptyArch: { width: 56, height: 68, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
    backgroundColor: colors.powder, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10 },
});

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Portrait } from '../components';
import { colors, fonts } from '../theme';
import type { Profile } from '../domain';
import { Arch } from './Arch';

export type CoverTheme = 'arches' | 'meridian' | 'window' | 'ledger' | 'tide';
export const COVER_THEMES: { key: CoverTheme; label: string; note: string }[] = [
  { key: 'arches', label: 'Arches', note: 'Two arches meeting on cream' },
  { key: 'meridian', label: 'Meridian', note: 'A powder sun on plum' },
  { key: 'window', label: 'Window', note: 'Guests in a wall of small arches' },
  { key: 'ledger', label: 'Ledger', note: 'A typographic poster' },
  { key: 'tide', label: 'Tide', note: 'Soft bands of powder blue' },
];

export function coverInk(theme: CoverTheme) {
  return theme === 'meridian' ? colors.cream : colors.ink;
}

function titleSize(title: string, scale: number) {
  const length = title.trim().length;
  const base = length > 34 ? 24 : length > 22 ? 30 : length > 14 ? 36 : 42;
  return Math.round(base * scale);
}

/**
 * Art-directed event covers. Each theme composes the palette and the arch
 * motif differently so a short list of events reads as distinct invitations.
 */
export function EventCover({ title, theme, dateLabel, guests = [], height = 200, scale = 1, style, children }: {
  title: string; theme: CoverTheme; dateLabel?: string; guests?: Pick<Profile, 'id' | 'name' | 'photoUrl'>[];
  height?: number; scale?: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode;
}) {
  const ink = coverInk(theme);
  const size = titleSize(title, scale);
  const titleStyle = { fontFamily: theme === 'ledger' ? fonts.displayItalic : fonts.display, color: ink, fontSize: size, lineHeight: Math.round(size * 1.04), letterSpacing: -size * 0.03 };
  const ground = theme === 'meridian' ? colors.plum : theme === 'window' ? colors.powder : theme === 'ledger' ? colors.paper : theme === 'tide' ? colors.paper : colors.paperSoft;
  const pad = 20 * scale;
  const thumbnail = scale < 0.5;
  return <View style={[styles.frame, { height, backgroundColor: ground }, style]}>
    {theme === 'arches' && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Arch width={height * 0.6} height={height * 0.86} color={colors.powder} style={{ position: 'absolute', right: height * 0.22, bottom: -height * 0.18 }} />
      <Arch width={height * 0.6} height={height * 0.72} color={colors.plum} base={0} style={{ position: 'absolute', right: -height * 0.06, bottom: -height * 0.18, opacity: 0.92 }} />
    </View>}
    {theme === 'meridian' && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', width: height * 0.9, height: height * 0.9, borderRadius: height * 0.45, backgroundColor: colors.powder, right: -height * 0.18, top: -height * 0.26 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.22, height: 1.5, backgroundColor: 'rgba(240,228,202,0.35)' }} />
    </View>}
    {theme === 'window' && <View pointerEvents="none" style={{ position: 'absolute', top: pad * 0.7, right: pad * 0.7, width: '66%', flexDirection: 'row', flexWrap: 'wrap', gap: 6 * scale, justifyContent: 'flex-end' }}>
      {Array.from({ length: 6 }).map((_, index) => {
        const guest = guests[index];
        const w = height * 0.19, h = height * 0.25;
        return <Arch key={index} width={w} height={h} color={colors.paper} base={0.12}>
          {guest && <View style={{ alignItems: 'center', justifyContent: 'flex-end', flex: 1 }}><Portrait person={guest} size={w} shape="arch" /></View>}
        </Arch>;
      })}
    </View>}
    {theme === 'ledger' && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: pad, right: pad, top: pad, height: 1.5, backgroundColor: colors.ink }} />
      <View style={{ position: 'absolute', left: pad, right: pad, bottom: pad, height: 1.5, backgroundColor: colors.ink }} />
      <View style={{ position: 'absolute', right: pad, bottom: pad + 10, width: height * 0.34, height: height * 0.42, borderRadius: height * 0.17, backgroundColor: colors.powder, transform: [{ rotate: '-14deg' }] }} />
    </View>}
    {theme === 'tide' && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[0, 1, 2, 3].map(index => <View key={index} style={{ position: 'absolute', left: -20, right: -20, bottom: index * height * 0.11 - 6, height: height * 0.075,
        borderRadius: height, backgroundColor: index % 2 ? colors.powder : colors.powderLight, opacity: 1 - index * 0.14 }} />)}
    </View>}
    <View style={{ flex: 1, padding: pad, justifyContent: theme === 'window' ? 'flex-end' : 'space-between', gap: 10 }}>
      {dateLabel && theme !== 'window' ? <Text style={[styles.date, { color: ink, fontSize: 13 * scale, lineHeight: 18 * scale }]}>{dateLabel}</Text> : <View />}
      {!(thumbnail && theme === 'window') && <Text numberOfLines={thumbnail ? 2 : 3} style={[titleStyle, { maxWidth: theme === 'arches' ? '56%' : theme === 'meridian' ? '70%' : theme === 'window' ? '60%' : '86%' }, theme === 'ledger' && { marginBottom: 10 }]}>{title.trim() || 'Untitled gathering'}</Text>}
    </View>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 22, overflow: 'hidden' },
  date: { fontFamily: fonts.medium, letterSpacing: 0 },
});

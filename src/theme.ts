import { StyleSheet } from 'react-native';

export const colors = {
  ink: '#0B1B3A', muted: '#5C6B80', blue: '#2468DD', blueLight: '#EAF2FF',
  line: '#DFE6F0', paper: '#FFFFFF', canvas: '#F4F7FC', green: '#146B55',
  greenLight: '#E8F5EF', danger: '#AD3046', dangerLight: '#FBECEF',
};
export const fonts = {
  body: 'Inter_400Regular', medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold',
};
export const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.canvas, alignItems: 'center' },
  app: { flex: 1, width: '100%', maxWidth: 520, backgroundColor: colors.paper },
  page: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40, gap: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  grow: { flex: 1 },
  title: { color: colors.ink, fontFamily: fonts.bold, fontSize: 30, lineHeight: 37, letterSpacing: -1 },
  heading: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27, letterSpacing: -0.4 },
  body: { color: colors.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  label: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 },
  eyebrow: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.4 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 20, gap: 16 },
  soft: { backgroundColor: colors.blueLight, borderRadius: 16, padding: 16, gap: 8 },
  divider: { height: 1, backgroundColor: colors.line },
  input: {
    minHeight: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14,
    color: colors.ink, fontFamily: fonts.body, fontSize: 15, backgroundColor: colors.paper,
  },
  button: {
    minHeight: 52, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14,
    backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 10,
  },
  buttonText: { color: colors.paper, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  secondary: { backgroundColor: colors.blueLight },
  secondaryText: { color: colors.blue },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  ghostText: { color: colors.ink },
  danger: { backgroundColor: colors.dangerLight },
  dangerText: { color: colors.danger },
  disabled: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.75 },
  badge: { alignSelf: 'flex-start', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.blueLight },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 14, letterSpacing: 0.7, color: colors.blue },
  avatar: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.blueLight },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  status: { padding: 14, borderRadius: 12, gap: 6, backgroundColor: colors.blueLight },
  error: { backgroundColor: colors.dangerLight },
});

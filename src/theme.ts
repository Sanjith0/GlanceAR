import { Platform, StyleSheet } from 'react-native';

/**
 * Glance design tokens.
 *
 * Cream is the canvas, powder blue is for moments of emphasis, plum anchors
 * typography, navigation and important actions. Values are digital
 * approximations of the reference palette (Pantone P 7-9 U, P 109-10 U,
 * P 101-16 U), not official conversions.
 */
export const palette = {
  cream: '#F0E4CA',
  creamDeep: '#E6D6B3',
  sand: '#D9C7A0',
  ivory: '#FBF8F2',
  ivorySoft: '#F6F0E3',
  powder: '#BCCCDB',
  powderLight: '#D6E0EA',
  powderDeep: '#9FB4C7',
  plum: '#4B414B',
  plumSoft: '#6B5F6B',
  plumMist: '#8C8290',
  ink: '#302A31',
  moss: '#2F6B4E',
  mossLight: '#DCE8DF',
  berry: '#8E3B46',
  berryLight: '#F1DEDF',
  white: '#FFFFFF',
} as const;

/**
 * Semantic colors. `colors` keeps the names the capture components already
 * import (`ink`, `muted`, `blue`, `line`, `paper`, `canvas`, …) so the working
 * camera and hand-detection views pick up the new palette without edits.
 */
export const colors = {
  cream: palette.cream,
  creamDeep: palette.creamDeep,
  plum: palette.plum,
  plumSoft: palette.plumSoft,
  canvas: palette.cream,
  paper: palette.ivory,
  paperSoft: palette.ivorySoft,
  line: palette.creamDeep,
  lineStrong: palette.sand,
  ink: palette.ink,
  text: palette.plum,
  muted: palette.plumSoft,
  faint: palette.plumMist,
  blue: palette.powderDeep,
  blueLight: palette.powderLight,
  powder: palette.powder,
  powderLight: palette.powderLight,
  powderDeep: palette.powderDeep,
  green: palette.moss,
  greenLight: palette.mossLight,
  danger: palette.berry,
  dangerLight: palette.berryLight,
  white: palette.white,
  /** Overlay scrims on camera and cover imagery. */
  scrim: 'rgba(48,42,49,0.72)',
  scrimSoft: 'rgba(48,42,49,0.42)',
} as const;

export const fonts = {
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** Editorial serif for selected headlines and the wordmark. */
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  displayItalic: 'Fraunces_400Regular_Italic',
  displayItalicStrong: 'Fraunces_600SemiBold_Italic',
} as const;

/** 4-point spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const motion = { fast: 150, base: 220, slow: 320 } as const;
/** Layout breakpoints: phone-first, with a considered desktop stage. */
export const layout = { phone: 390, tablet: 720, desktop: 980, column: 600, wide: 1120, gutter: 20 } as const;

export const type = StyleSheet.create({
  display: { fontFamily: fonts.display, color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
  displayItalic: { fontFamily: fonts.displayItalic, color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -0.8 },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  heading: { fontFamily: fonts.display, color: colors.ink, fontSize: 23, lineHeight: 28, letterSpacing: -0.4 },
  subheading: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, color: colors.text, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16, lineHeight: 24 },
  secondary: { fontFamily: fonts.body, color: colors.muted, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.body, color: colors.muted, fontSize: 13, lineHeight: 19 },
  smallStrong: { fontFamily: fonts.semibold, color: colors.text, fontSize: 13, lineHeight: 19 },
  micro: { fontFamily: fonts.medium, color: colors.muted, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 14, lineHeight: 20 },
  quote: { fontFamily: fonts.displayItalic, color: colors.text, fontSize: 19, lineHeight: 27 },
});

export const shadow = Platform.select({
  web: { boxShadow: '0 10px 30px rgba(48,42,49,0.10)' },
  default: { shadowColor: palette.ink, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
}) as object;

/**
 * Shared layout styles. The legacy names (`s.card`, `s.button`, …) remain so the
 * existing camera components keep compiling; new screens use the primitives in
 * `components.tsx` and `ui/`.
 */
export const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.canvas },
  app: { flex: 1, width: '100%', backgroundColor: colors.canvas },
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: layout.gutter, paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  title: type.title,
  heading: type.heading,
  body: type.body,
  muted: type.secondary,
  small: type.small,
  label: type.label,
  eyebrow: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: space.lg + 2, gap: space.lg },
  soft: { backgroundColor: colors.blueLight, borderRadius: radius.lg, padding: space.lg + 2, gap: space.sm },
  divider: { height: 1, backgroundColor: colors.line },
  input: {
    minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13,
    color: colors.ink, fontFamily: fonts.body, fontSize: 16, backgroundColor: colors.paper,
  },
  button: {
    minHeight: 52, paddingHorizontal: 20, paddingVertical: 14, borderRadius: radius.pill,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
  },
  buttonText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  secondary: { backgroundColor: colors.powder },
  secondaryText: { color: colors.ink },
  ghost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.lineStrong },
  ghostText: { color: colors.ink },
  danger: { backgroundColor: colors.dangerLight },
  dangerText: { color: colors.danger },
  disabled: { backgroundColor: colors.creamDeep, borderWidth: 0 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.blueLight },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.ink },
  avatar: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.blueLight },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  status: { padding: 14, borderRadius: radius.md, gap: 6, backgroundColor: colors.blueLight },
  error: { backgroundColor: colors.dangerLight },
  creamDeep: { backgroundColor: colors.line },
});

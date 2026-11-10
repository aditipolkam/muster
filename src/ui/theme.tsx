import React, { createContext, useContext, useMemo } from 'react';
import { TextStyle, useColorScheme } from 'react-native';

/**
 * The one place colours, radii, spacing, type and icon sizes are defined (the "trail" redesign).
 * Screens read these through `useTheme()` and never hard-code a colour.
 *
 * Colour roles, kept strict so a colour always means the same thing:
 * - primary (green): actions, selection, "nearby"/success
 * - meeting (orange): meeting points only
 * - self (blue): your own position on the map only
 * - warning (amber): warnings only
 * - danger (red): destructive actions and errors only
 */
export type Palette = {
  /** Warm ground behind every screen. */
  bg: string;
  surface: string;
  /** Neutral chip / segmented-track grey. */
  surfaceAlt: string;
  /** Hairline / card border. */
  border: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  primary: string;
  onPrimary: string;
  primaryPressed: string;
  primarySoft: string;
  /** Dark green text on primarySoft. */
  deep: string;
  /** Legacy alias for an attention accent; now the meeting orange. */
  accent: string;
  danger: string;
  onDanger: string;
  dangerBg: string;
  /** Warning text (amber on warningBg). */
  warning: string;
  warningText: string;
  warningBg: string;
  warningBorder: string;
  infoBg: string;
  overlay: string;
  /** Success / presence dot. */
  connected: string;
  /** Meeting points. */
  meeting: string;
  meetingSoft: string;
  meetingText: string;
  meetingStroke: string;
  /** You, on the map. */
  self: string;
  selfHalo: string;
  /** Dark "ink" card (status pill, navigation instruction, pinned meeting point). */
  ink: string;
  onInk: string;
  onInkMuted: string;
  mapSelf: string;
  mapMember: string;
  mapMeeting: string;
  mapTrail: string;
};

const light: Palette = {
  bg: '#F6F5F0',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEEE8',
  border: '#E4E2DA',
  text: '#15201A',
  textMuted: '#5B665F',
  textSecondary: '#5B665F',
  primary: '#1D5C3B',
  onPrimary: '#FFFFFF',
  primaryPressed: '#14432A',
  primarySoft: '#E6EFE8',
  deep: '#14432A',
  accent: '#D9622B',
  danger: '#A3261B',
  onDanger: '#FFFFFF',
  dangerBg: '#FBE7E4',
  warning: '#6A4400',
  warningText: '#7A4F00',
  warningBg: '#FFF4DE',
  warningBorder: '#F3E3C2',
  infoBg: '#E6EFE8',
  overlay: 'rgba(21,32,26,0.45)',
  connected: '#2E9E5B',
  meeting: '#D9622B',
  meetingSoft: '#FCE9DF',
  meetingText: '#8E3A12',
  meetingStroke: '#C2531F',
  self: '#2563EB',
  selfHalo: 'rgba(37,99,235,0.16)',
  ink: '#15201A',
  onInk: '#FFFFFF',
  onInkMuted: '#C9D3CC',
  mapSelf: '#2563EB',
  mapMember: '#1D5C3B',
  mapMeeting: '#D9622B',
  mapTrail: '#2A9C9A',
};

const dark: Palette = {
  bg: '#0F1512',
  surface: '#18211C',
  surfaceAlt: '#212C26',
  border: '#2E3B33',
  text: '#EAF0EC',
  textMuted: '#9AA79F',
  textSecondary: '#9AA79F',
  primary: '#58B58A',
  onPrimary: '#06150E',
  primaryPressed: '#7FCBA6',
  primarySoft: '#1D2D25',
  deep: '#CDE8D8',
  accent: '#F08A55',
  danger: '#F2766E',
  onDanger: '#2B0906',
  dangerBg: '#3A1B18',
  warning: '#F2C46B',
  warningText: '#F2C46B',
  warningBg: '#3A2E10',
  warningBorder: '#4D3D17',
  infoBg: '#1D2D25',
  overlay: 'rgba(0,0,0,0.6)',
  connected: '#5CC27A',
  meeting: '#F08A55',
  meetingSoft: '#3A2216',
  meetingText: '#F6B593',
  meetingStroke: '#F08A55',
  self: '#6A9BF8',
  selfHalo: 'rgba(106,155,248,0.2)',
  ink: '#0A0F0C',
  onInk: '#FFFFFF',
  onInkMuted: '#C9D3CC',
  mapSelf: '#6A9BF8',
  mapMember: '#58B58A',
  mapMeeting: '#F08A55',
  mapTrail: '#4FBFBC',
};

/** Spacing on a 4/8 grid. `gutter` is the one screen edge inset; `section` the gap between groups. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  gutter: 20,
  xl: 24,
  xxl: 32,
  huge: 40,
  /** Gap between sections of a screen. */
  section: 24,
} as const;

/**
 * Corners. Every control (button, input, search, selector, segmented tab, chip, tab indicator,
 * icon button) is a full pill. Only containers (cards, banners, sheets) use a large fixed radius;
 * nothing is square or slightly rounded. The older names map onto these two rules.
 */
export const radius = {
  pill: 999,
  /** Cards, banners, menus, panels. */
  card: 24,
  /** Bottom sheets (top corners). */
  sheet: 32,
  // Controls: all pills.
  sm: 999,
  tile: 999,
  input: 999,
  md: 999,
  button: 999,
  // Containers.
  lg: 24,
} as const;

/** Control sizes. Touch targets are never below 44. */
export const size = {
  touch: 44,
  button: 54,
  buttonSmall: 44,
  input: 52,
  search: 52,
  tabPillW: 56,
  tabPillH: 30,
  /** Segmented tab and interactive chip height. */
  segment: 44,
  chip: 36,
  iconButton: 48,
  /** Fixed slot for a leading row icon, so rows line up. */
  iconSlot: 28,
} as const;

/**
 * Manrope is the design font. Until its files are bundled (ios/android assets + linking) this
 * stays undefined and the system font is used; set it to 'Manrope' in one place when they are.
 */
export const fontFamily: string | undefined = undefined;

/** Type scale. Screen titles 26-30/800, card titles 16-19/800, captions 12-13/600. */
export const type = {
  hero: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.4 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '800' },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  input: { fontSize: 16 },
} as const satisfies Record<string, TextStyle>;

/** Tabular figures for distances, bearings and times so numbers do not jitter. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * No shadows anywhere: surfaces separate by a hairline border or background contrast.
 */

/** Icon sizes and stroke weight: one scale for the whole app (SF Symbols weight on iOS). */
export const iconSize = { sm: 16, md: 20, lg: 24, xl: 28 } as const;
export const iconWeight = 'regular' as const;

export type Theme = { dark: boolean; c: Palette };

const ThemeContext = createContext<Theme>({ dark: false, c: light });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo<Theme>(
    () => (scheme === 'dark' ? { dark: true, c: dark } : { dark: false, c: light }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

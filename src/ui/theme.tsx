import React, { createContext, useContext, useMemo } from 'react';
import { TextStyle, useColorScheme, ViewStyle } from 'react-native';

/**
 * The one place colours, radii, spacing, type and elevation are defined (the "trail" redesign).
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
  /** Shadow colour for floating map controls. */
  shadow: string;
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
  shadow: '#15201A',
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
  shadow: '#000000',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  gutter: 20,
  xl: 24,
  xxl: 32,
  huge: 40,
} as const;

export const radius = {
  sm: 8,
  /** Icon tiles. */
  tile: 12,
  input: 14,
  md: 14,
  button: 16,
  /** Cards. */
  card: 20,
  lg: 20,
  /** Bottom sheets (top corners). */
  sheet: 28,
  pill: 999,
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
} as const;

/**
 * Manrope is the design font. Until its files are bundled (ios/android assets + linking) this
 * stays undefined and the system font is used; set it to 'Manrope' in one place when they are.
 */
export const fontFamily: string | undefined = undefined;

/** Tabular figures for distances, bearings and times so numbers do not jitter. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** The only shadow: floating map controls and sheets over the map. Cards use a border instead. */
export const floating = (c: Palette): ViewStyle => ({
  shadowColor: c.shadow,
  shadowOpacity: 0.1,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
});

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

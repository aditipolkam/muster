import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
  onDanger: string;
  warning: string;
  warningBg: string;
  infoBg: string;
  dangerBg: string;
  overlay: string;
  primaryPressed: string;
  primarySoft: string;
  deep: string;
  textSecondary: string;
  connected: string;
  mapSelf: string;
  mapMember: string;
  mapMeeting: string;
  mapTrail: string;
};

const light: Palette = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F5EF',
  border: '#E2E8E1',
  text: '#18231D',
  textMuted: '#66716B',
  primary: '#176438',
  onPrimary: '#FFFFFF',
  accent: '#B7771C',
  danger: '#BE4C45',
  onDanger: '#FFFFFF',
  warning: '#B7771C',
  warningBg: '#FFF1D0',
  infoBg: '#E7F2E8',
  dangerBg: '#FBE4E1',
  overlay: 'rgba(24,35,29,0.45)',
  primaryPressed: '#104D2B',
  primarySoft: '#E7F2E8',
  deep: '#103F29',
  textSecondary: '#66716B',
  connected: '#248B43',
  mapSelf: '#3989F5',
  mapMember: '#236B42',
  mapMeeting: '#9858CA',
  mapTrail: '#2A9C9A',
};

const dark: Palette = {
  bg: '#0F1512',
  surface: '#18211C',
  surfaceAlt: '#212C26',
  border: '#2E3B33',
  text: '#EAF0EC',
  textMuted: '#9AA79F',
  primary: '#58B58A',
  onPrimary: '#06150E',
  accent: '#F2B13B',
  danger: '#F2766E',
  onDanger: '#2B0906',
  warning: '#F2C46B',
  warningBg: '#3A2E10',
  infoBg: '#1D2D25',
  dangerBg: '#3A1B18',
  overlay: 'rgba(0,0,0,0.6)',
  primaryPressed: '#7FCBA6',
  primarySoft: '#1D2D25',
  deep: '#EAF0EC',
  textSecondary: '#9AA79F',
  connected: '#5CC27A',
  mapSelf: '#6AA5F8',
  mapMember: '#58B58A',
  mapMeeting: '#B88BDD',
  mapTrail: '#4FBFBC',
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
export const radius = { sm: 8, input: 12, md: 14, card: 16, lg: 20, sheet: 24, pill: 999 } as const;

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

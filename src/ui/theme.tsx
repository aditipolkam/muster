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
};

const light: Palette = {
  bg: '#F5F3EC',
  surface: '#FFFFFF',
  surfaceAlt: '#ECE9DF',
  border: '#D9D5C7',
  text: '#16201A',
  textMuted: '#5C665F',
  primary: '#2D6A4F',
  onPrimary: '#FFFFFF',
  accent: '#D98E04',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  warning: '#8A5A00',
  warningBg: '#FFF1D0',
  infoBg: '#E3EFE8',
  dangerBg: '#FBE4E1',
  overlay: 'rgba(22,32,26,0.45)',
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
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

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

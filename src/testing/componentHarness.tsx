import React from 'react';
import { Services, ServicesProvider } from '../runtime/services';
import { ThemeProvider } from '../ui/theme';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function Harness({ services, children }: { services: Services; children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export const fakeNav = () => {
  const calls: unknown[][] = [];
  const nav = {
    navigate: (...a: unknown[]) => calls.push(a),
    goBack: () => calls.push(['goBack']),
    getParent: () => nav,
  };
  return { nav, calls };
};

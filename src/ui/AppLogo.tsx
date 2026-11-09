import React from 'react';
import { Image } from 'react-native';

// The Muster app icon (assets/brand/muster-icon.svg, rendered to PNG). react-native-svg is not a
// dependency, so the in-app logo is a bitmap.
const ICON = require('../assets/brand/muster-icon.png');

/** The Muster logo: the app icon with rounded corners, as on the home screen. */
export function AppLogo({ size = 56 }: { size?: number }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size, borderRadius: size * 0.225 }}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Muster"
      testID="app-logo"
    />
  );
}

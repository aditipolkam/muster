/* eslint-env jest */
// Native modules are never loaded in unit tests; individual tests mock what they exercise.

// The icon font is loaded natively; unit tests only need something renderable.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const R = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }) => R.createElement(Text, { testID: `icon-${name}` }),
  };
});

// SF Symbols are native (iOS). In tests, render the Ionicons fallback the Icon component passes.
jest.mock('expo-symbols', () => ({
  __esModule: true,
  SymbolView: ({ fallback }) => fallback ?? null,
}));

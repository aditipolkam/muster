module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/build/', '/ios/', '/android/', '/tools/region-builder/out/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@maplibre|expo(nent)?|@expo(nent)?/.*|expo-.*|react-native-.*|zustand|ulid|@noble)/)',
  ],
};

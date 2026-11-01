const zone = (target, from, message) => ({ target, from, message });

module.exports = {
  root: true,
  extends: '@react-native',
  plugins: ['import'],
  settings: {
    'import/resolver': { typescript: { project: './tsconfig.json' } },
  },
  rules: {
    'no-console': 'error',
    'no-void': 'off',
    'react-native/no-inline-styles': 'off',
    // Rule 6 (CLAUDE.md): no network in core paths. Only src/features/maps-manager may use it.
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Network access is allowed only in src/features/maps-manager.' },
      { name: 'XMLHttpRequest', message: 'Network access is allowed only in src/features/maps-manager.' },
      { name: 'WebSocket', message: 'Network access is allowed only in src/features/maps-manager.' },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'expo/fetch', message: 'Network access is allowed only in src/features/maps-manager.' },
          { name: '@offline-protocol/mesh-sdk', message: 'Only src/mesh/sdk.ts may import the SDK.' },
        ],
      },
    ],
    // Architecture dependency rule (docs/ARCHITECTURE.md section 3).
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          ...['features', 'data', 'platform', 'app', 'runtime', 'ui', 'mesh'].map(d =>
            zone('./src/domain', `./src/${d}/**`, 'domain/ imports nothing from RN, the SDK or features.'),
          ),
          ...['features', 'mesh', 'platform', 'app', 'runtime', 'ui'].map(d =>
            zone('./src/data', `./src/${d}/**`, 'data/ may import only domain/ and shared/.'),
          ),
          ...['features', 'mesh', 'data', 'app', 'runtime', 'ui'].map(d =>
            zone('./src/platform', `./src/${d}/**`, 'platform/ may import only domain/ and shared/.'),
          ),
          ...['features', 'data', 'platform', 'app', 'runtime', 'ui'].map(d =>
            zone('./src/mesh', `./src/${d}/**`, 'mesh/ may import only domain/ and shared/.'),
          ),
          ...['features', 'mesh', 'data', 'platform', 'app', 'runtime', 'ui', 'domain'].map(d =>
            zone('./src/shared', `./src/${d}/**`, 'shared/ is a leaf.'),
          ),
          ...['features', 'mesh', 'data', 'platform', 'app', 'runtime', 'domain'].map(d =>
            zone('./src/ui', `./src/${d}/**`, 'ui/ is presentational: react-native and shared only.'),
          ),
          zone('./src/runtime', './src/app/**', 'runtime/ must not depend on app/.'),
          ...['map', 'maps-manager', 'location', 'markers', 'settings', 'mesh-diagnostics'].map(f =>
            zone(`./src/features/${f}`, [`./src/features/!(${f})/**`, './src/app/**'], 'features never import each other.'),
          ),
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/features/maps-manager/**/*.{ts,tsx}'],
      rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': ['error', { paths: [{ name: '@offline-protocol/mesh-sdk', message: 'Only src/mesh/sdk.ts may import the SDK.' }] }] },
    },
    {
      files: ['src/mesh/sdk.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      files: ['src/shared/base64.ts', 'src/domain/groups/invite.ts', 'src/features/maps-manager/hash.ts', 'src/testing/**', '__tests__/**'],
      rules: { 'no-bitwise': 'off' },
    },
    {
      files: ['__tests__/**', '**/*.test.{ts,tsx}', 'tools/**', 'scripts/**', '*.js'],
      env: { jest: true, node: true },
      rules: { 'no-console': 'off', 'no-restricted-globals': 'off', 'import/no-restricted-paths': 'off' },
    },
  ],
  ignorePatterns: ['src/assets/generated/', 'build/', 'ios/Pods/', 'node_modules/', 'tools/region-builder/out/', 'android/'],
};

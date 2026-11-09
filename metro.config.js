const fs = require('fs');
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// The SDK is consumed either as a local build (a symlink created by `file:` in package.json, see
// scripts/sdk-source.sh local) or as the published npm package. Metro needs extra help only for
// the symlinked form, so detect it instead of keeping a flag in sync by hand.
// MUSTER_SDK=local|npm forces a mode (TRAILMESH_SDK, the pre-rename name, still works).
const sdkLink = path.join(__dirname, 'node_modules/@offline-protocol/mesh-sdk');
function sdkRealPath() {
  try {
    return fs.realpathSync(sdkLink);
  } catch {
    return null;
  }
}
const real = sdkRealPath();
const detectedLocal = real !== null && !real.startsWith(path.join(__dirname, 'node_modules'));
const mode =
  process.env.MUSTER_SDK || process.env.TRAILMESH_SDK || (detectedLocal ? 'local' : 'npm');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {};

if (mode === 'local' && real) {
  const escape = s => s.replace(/[/\\]/g, '[/\\\\]');
  const defaultBlock = defaultConfig.resolver.blockList;
  // One copy of react and react-native: the SDK's own devDependencies must not be bundled.
  const blocked = [
    new RegExp(`${escape(path.join(real, 'node_modules/react-native'))}[/\\\\].*`),
    new RegExp(`${escape(path.join(real, 'node_modules/react'))}[/\\\\].*`),
  ];
  config.watchFolders = [real];
  config.resolver = {
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    blockList: [
      ...(Array.isArray(defaultBlock) ? defaultBlock : defaultBlock ? [defaultBlock] : []),
      ...blocked,
    ],
    extraNodeModules: {
      '@offline-protocol/mesh-sdk': real,
      react: path.join(__dirname, 'node_modules/react'),
      'react-native': path.join(__dirname, 'node_modules/react-native'),
    },
  };
}

module.exports = mergeConfig(defaultConfig, config);

# ADR 0006: The SDK is consumed from the local checkout through a `file:` dependency, behind one import site

Status: Accepted (Phase 2). iOS simulator build and Android arm64 debug APK build verified; no device behaviour verified (`PROGRESS.md`).

## Context

The SDK ships prebuilt natives only in its npm package. A source checkout has none until `npm run build:all` runs, and the SDK tree must never be edited. TrailMesh has to build against the checkout today and against the published package later, without code changes.

## Decision

- `package.json` depends on `file:../offline-protocol-sdk/bindings/react-native`. npm creates a symlink in `node_modules/@offline-protocol/mesh-sdk`.
- `metro.config.js` detects that symlink (or `TRAILMESH_SDK=local|npm`) and only then adds the SDK folder to `watchFolders`, maps the package and `react`/`react-native` through `extraNodeModules`, and blocks the SDK's own `node_modules/react{,-native}` so one copy of each is bundled. With the npm package nothing is overridden.
- iOS autolinks `MeshSdk.podspec` (package root); Android autolinks through the SDK's `react-native.config.js`. No manual Podfile or Gradle edits are needed.
- `scripts/sdk-source.sh local | npm <version>` switches modes and runs `pod install`.
- Only `src/mesh/sdk.ts` imports the package (ESLint `no-restricted-imports` plus `__tests__/meshBoundaries.test.ts`). The rest of the app sees `MeshPort`.
- `src/mesh/sdk.ts` exposes an `SdkFactory` seam, so tests inject `FakeSdk` and never load the native module.

## Consequences

- Changing the SDK means rebuilding its natives (`docs/SDK_INTEGRATION.md` section 2.2) and re-running `pod install` / a Gradle build; JS changes in the SDK need Metro restarted (`--reset-cache`).
- The build writes only git-ignored artifacts into the SDK tree (`target/`, `bindings/react-native/{lib,ios/libs,android/src/main/jniLibs}`). `git status` in the SDK was clean before and after the iOS build, including the regenerated bindings.
- `npm install` in TrailMesh needs `--legacy-peer-deps` (pre-existing: `@babel/plugin-transform-export-namespace-from@8` peers on `@babel/core@8`, the RN preset uses 7).
- Wi-Fi Direct is disabled in Phase 2 (BLE only), but the SDK's library manifest still merges its Wi-Fi permissions into the app.

# ADR 0001: React Native 0.81.5 with Expo SDK 54 modules (not 0.82)

Status: Accepted (Phase 1, 2026-10-31)

## Context

`ARCHITECTURE.md` AD-1 pins bare React Native 0.82.x, chosen so the app matches the version the SDK example apps run (0.82.1), and adopts the Expo native modules (`expo-location`, `expo-file-system`, ...) via `install-expo-modules`.

Findings while scaffolding:

- No Expo SDK targets 0.82. SDK 54 targets RN 0.81.5, SDK 55 targets 0.83.x.
- `install-expo-modules` refuses RN 0.82 ("Unable to find compatible Expo SDK version").
- With RN 0.82.1 and the SDK 54 modules wired by hand, the iOS build fails in `ExpoModulesCore` (`EXJSIUtils.h`: `no member named 'CallInvoker' in namespace facebook::react`, a header RN 0.82 no longer pulls in transitively). Fixing it means patching a third-party native module, and more patches would follow on Android.
- The SDK's React Native binding declares `"react-native": ">=0.70.0"`, so 0.82 parity is a preference, not a requirement.

## Decision

Use **React Native 0.81.5** (React 19.1.0) with **Expo SDK 54** modules, the combination Expo tests. Still bare, New Architecture, Hermes. `npx expo install --check` reports no mismatches.

## Consequences

- Smallest deviation from AD-1 that needs no native patches. TypeScript, navigation, state, MapLibre v11.5.1 (`react-native >= 0.80`) and op-sqlite are unaffected.
- Revisit when moving to Expo SDK 55 (RN 0.83) or later; Phase 2 should confirm the SDK binding works on 0.81.5 (expected: peer range is `>=0.70`).
- Expo modules are wired manually (Podfile `use_expo_modules!`, Gradle `expo-autolinking-settings`, `MainApplication` wrapper) because the installer does not support this combination.
- iOS: Xcode 26 clang rejects fmt's `consteval` checks; `ios/Podfile` post_install flips `FMT_USE_CONSTEVAL` to 0 in the fmt pod (a build define cannot override it).
- iOS: MapLibre RN v11 gets MapLibre Native through SwiftPM; `$MLRN.post_install(installer)` must be called from the Podfile.

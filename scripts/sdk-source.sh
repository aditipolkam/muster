#!/usr/bin/env bash
# Switch which Offline Protocol SDK TrailMesh builds against.
#   scripts/sdk-source.sh local            link ../offline-protocol-sdk/bindings/react-native (needs SDK natives built)
#   scripts/sdk-source.sh npm <version>    install the published @offline-protocol/mesh-sdk@<version>
# Only package.json, the lockfile and Pods change. The SDK checkout is never edited.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="$ROOT/../offline-protocol-sdk/bindings/react-native"
PKG="@offline-protocol/mesh-sdk"
cd "$ROOT"

# The project already needs this flag: @babel/plugin-transform-export-namespace-from@8 declares a
# peer on @babel/core@8 while the React Native preset pins 7 (pre-existing, tracked in PROGRESS.md).
NPM_FLAGS=(--legacy-peer-deps --no-audit --no-fund)

mode="${1:-}"
case "$mode" in
  local)
    [ -d "$SDK_DIR" ] || { echo "SDK not found at $SDK_DIR" >&2; exit 1; }
    for need in "$SDK_DIR/ios/libs/offline_protocol_uniffi.xcframework" "$SDK_DIR/lib/index.js"; do
      [ -e "$need" ] || echo "warning: $need is missing. Build the SDK first (docs/SDK_INTEGRATION.md section 2)." >&2
    done
    npm pkg set "dependencies.$PKG=file:../offline-protocol-sdk/bindings/react-native"
    npm install "${NPM_FLAGS[@]}"
    ;;
  npm)
    version="${2:?usage: sdk-source.sh npm <version>}"
    npm install "$PKG@$version" "${NPM_FLAGS[@]}"
    ;;
  *)
    echo "usage: $0 local | npm <version>" >&2
    exit 2
    ;;
esac

if [ -d "$ROOT/ios" ]; then
  (cd "$ROOT/ios" && pod install)
fi
echo "SDK source: $mode. Run 'npm run typecheck' and rebuild the native app."

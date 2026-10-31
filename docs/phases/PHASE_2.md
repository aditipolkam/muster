# Phase 2: Mesh SDK Integration and Peer Discovery

## Scope

In:
- Build the SDK natives locally and link the SDK via `file:` (`SDK_INTEGRATION.md` §2), plus `scripts/sdk-source.sh local|npm`.
- `MeshPort`, `SdkMeshAdapter`, `FakeMesh`; the SDK lifecycle contract (listeners-before-start, battery feed, foreground reconcile, teardown).
- Permissions: Bluetooth (iOS usage strings + background modes; Android 12+ scan/advertise/connect, legacy location on <= 11), Android foreground service handling, Wi-Fi Direct permission flow.
- Nearby devices screen: discovered/lost peers, RSSI, transport, mesh status, topology/diagnostics.
- Identity: show own `off1…` address (copyable/QR), display name.
- Minimal ping test: send/receive a direct message between two devices to prove the path (developer screen, to be hidden later).
- Persist inbound events in the handler (events table, dedupe).

Out: groups, DataStore use, location sharing.

## Dependencies

Phase 1 scaffold (project, DB, CI). D-1 licence route awareness (building is allowed regardless). Rust toolchain, uniffi-bindgen 0.32.2, NDK, Xcode, >= 15 GiB free disk.

## Architecture considerations

- Single import site `src/mesh/sdk.ts`; ESLint rule enforces.
- The adapter converts SDK events to typed observables; normalises errors and `diagnostic` events (`native_event_gap`, `native_event_replayed`).
- Config per `SDK_INTEGRATION.md` §11; internet transport disabled; telemetry never enabled.
- `appId` is final here (D-2), because changing it later rotates the SDK storage namespace and identity.
- Android manifest merge: SDK declares Bluetooth/Wi-Fi permissions; add TrailMesh's own plus foreground service types; verify the merged manifest in CI (`aapt dump permissions`).
- iOS: `NSBluetoothAlwaysUsageDescription`, `UIBackgroundModes` bluetooth-central + bluetooth-peripheral.
- `FakeMesh` simulates N virtual peers with latency/loss/partition for tests in later phases.

## Implementation tasks

1. P2-1 Build SDK natives (`npm run build:all` in the SDK RN binding), one repo at a time, with `df -h` check. Record `git status` before/after in the SDK; confirm no tracked files changed (A-01). Document exact toolchain versions that worked.
2. P2-2 Link into TrailMesh, Metro config, pods, Gradle; app boots with the native module loaded on both OSes.
3. P2-3 `MeshPort` + `SdkMeshAdapter` (start/stop/status/peers/localAddress/battery).
4. P2-4 Determine the RN persistence defaults for the outbox (A-04) by reading `index.ts`/native modules and testing kill/restart with a pending message; document.
5. P2-5 Permission/enablement flow (Bluetooth on, permissions, Wi-Fi Direct grant before `start()`, `requestEnableBluetooth` on Android).
6. P2-6 Lifecycle: AppState reconcile, `mesh_stopped_by_user`, destroy/recreate rules, kill-and-relaunch test.
7. P2-7 Nearby screen + diagnostics (peer table, `getTopology`, `getTransportMetrics`, retry queue, event-gap counter).
8. P2-8 Developer ping screen (direct message round trip with delivered/failed state).
9. P2-9 `sdk-source.sh` + CI job that type-checks in both modes (npm mode against the published version).
10. P2-10 Decide Wi-Fi Direct `autoAccept` default from measured group-formation time and battery (A-08 initial data).

## Acceptance criteria

- AC1: App starts the mesh on iOS and Android; `localAddress()` is shown and stable across restarts.
- AC2: Two phones (any OS pair) discover each other within 30 s of both running in the foreground, 1-10 m apart; appear and disappear in the list with `neighbor_discovered/lost`.
- AC3: A direct message from A to B shows `delivered` on A and is persisted on B (events table) exactly once, including after B was in the background and returned (hold/replay path).
- AC4: Toggling Bluetooth off/on, killing the app, and (Android) tapping Stop in the notification leave the app in a correct state after foreground reconcile; no stuck "mesh active" indicator.
- AC5: No SDK import outside `src/mesh/sdk.ts` (lint passes); switching `sdk-source.sh npm <version>` builds (when that version is published; else documented as pending).
- AC6: SDK source tree has no modified tracked files (A-01 closed).
- AC7: Battery level feed reaches the SDK on start and on change (verified via `getBatteryLevel()`).
- AC8: Telemetry is not enabled (assert in a test that `enableTelemetry` is never called).

## Automated testing

- Unit: adapter with a mocked SDK module (listener-before-start ordering, destroy rules, event normalisation, hold/replay dedupe, `mesh_stopped_by_user` idempotency).
- `FakeMesh` contract tests: the same suite runs against `FakeMesh` and (device-only) against `SdkMeshAdapter`.
- Lint: import boundaries; forbidden API list (`enableTelemetry`).
- Manifest/Info.plist assertions in CI.
- Type-check matrix: local and npm SDK modes.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| Discovery matrix iOS-iOS, iOS-Android, Android-Android | 2+2 | AC2 each pair |
| Direct message delivery and persistence | pairs | AC3 |
| Range check: indoor, outdoor open air | pair | Record discovery/loss distance (feeds A-03) |
| Backgrounding: 1, 5, 15 min | each OS | Record whether discovery/messages survive; no false claims in UX |
| 3-device line A-B-C where A and C are out of range | 3 | A to C message delivered via B (multi-hop confirmation) |
| Android Wi-Fi Direct enablement, group formation time | 2 Android | Record times; decide P2-10 |
| Permission denial paths | each OS | Clear recovery UI |
| Battery drain: 1 h foreground, mesh on, screen on | each OS | Record baseline |

## Deliverables

- Linked, running SDK integration with `MeshPort`/adapter/fake.
- Nearby devices and diagnostics screens; developer ping.
- `scripts/sdk-source.sh`; CI with both modes.
- ADRs: SDK linking, Wi-Fi Direct default; updated `SDK_INTEGRATION.md` with confirmed behaviour, assumptions A-01/A-04/A-08 resolved; `PROGRESS.md`.

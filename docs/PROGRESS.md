# Progress

Last updated: 2026-11-09 (trail UI redesign)

## Status

| Phase | Status | Notes |
|---|---|---|
| 0. Architecture and documentation | Complete | This document set. No application code exists |
| 1. Offline Maps and GPS | **Implemented, NOT accepted** | Code, automated tests and iOS-simulator evidence done. Acceptance needs the physical-device checklist below. See Phase 1 report |
| 2. Mesh SDK Integration and Peer Discovery | **Implemented, NOT accepted** | Local SDK built and linked, mesh adapter, pub/sub layer, diagnostics screen, tests. **No Bluetooth behaviour verified: needs two physical devices.** See Phase 2 report |
| 3. Groups and Meeting Point Sharing | **Implemented, NOT accepted** | Organizer-led groups, QR / nearby join, group pub/sub, meeting points on the map, acknowledgments, persistence, tests, docs. **No Bluetooth, camera scan or two-device behaviour verified.** See Phase 3 report |
| Extension: Adventures and achievements | **Implemented, NOT accepted** | Adventures, checkpoints with arrival detection, 13 badges, group adventures on the `adv` channel, recap and journal, small celebrations. 125 new tests. **Nothing verified on a device.** See `GAMIFICATION_PROGRESS.md` |
| Extension: Group activities | **In progress (organizer and participant screens built; PNG, group cards and device checks left)** | **Behind the `groupActivities` flag in `src/shared/features.ts`, off by default (2026-11-08):** while off, a group's adventure is planned and run as before, group info shows the old Adventures card, and an activity received from another phone is shown as a plain group adventure. Turn it on there to work on it. Spec `phases/EXT_GROUP_ACTIVITIES.md`, ADR 0011. Done: domain and data (`draft`, publish, task phases, order flag, map area, `done` state, organizer order check, migration 5) and the service (private drafts, publish = start, no edits after publish, per-person Start and automatic finish on the last phase, ordered lock on the phone, late joiner from phase 1). 40 new tests, incl. a three-phone fake-mesh run. A person's own finish (`progress.finishedAt`, personal, never sent) counts as completion for their journal, recap and badges and survives a later cancel by the organizer; the shared status stays the organizer's. Organizer flow rebuilt to the reference design `Muster Checkpoint and Activity Flow.png` (2026-11-03): Edit Activity (summary card, Details / Phases / Settings tabs, numbered phases with a type icon, Reorder, Add Phase, Save Draft / Publish), Add Phase (Location Checkpoint, Collect Item, Take a Photo, Custom Task), the phase form (name, description, Select Location, Completion Radius slider 15 to 150 m, Require Photo, Include Map Region), Select Location on the Map tab (search for a place, crosshair, Place Pin Here, then the offline region box with Adjust and an about-size, Confirm Location) and Phase Added. Phases now have a type, a radius, a photo rule and (organizer's draft only) a map region; at publish the regions merge into the one download, and publish is refused with a clear message if they are more than 0.5 degrees apart. Migration 6. A person's own note and photo per phase have a table and service calls but no screen yet. 32 more tests. Participant screens built to the reference (2026-11-03): the activity page changes with where you are. Before Start: cover, Published, group and phase count, about distance and time, description, **Download Map Region** (one tap plans the area and starts the download; shows progress, then "Map region downloaded"; this is the only network use and only on that tap), Phases, Preview on Map, Activity Rules, Start Activity. After Start: timer, participants started out of members, Progress / Updates tabs, the phase timeline (done with time and photo thumbnail, current with "At location" or the distance, locked). The phase page has a photo area (attach from the library, remove), a location status card, a note, and Mark as Complete (disabled while a required photo is missing or the phase is locked). Finishing the last phase opens Activity Completed (duration, distance, phases, View Summary, Share through the system share sheet). Activity History rows show date, distance, time and phases. Photos need `expo-image-picker` (added; **run `cd ios && pod install` before the next iOS build**, not done here). `[ASSUMPTION A-31]` the picker works without a permission prompt on both OSes: not run on a device. **Not done:** the illustrated PNG of a finished activity (needs an image-capture library), a "Share with Group" that posts to the group (chat is the next phase; Share uses the system sheet), group-page activity cards. **A-34:** the region size shown is a guess (40 KB per tile, unmeasured), shown as "About". **Not checked by eye:** none of these screens has been looked at in a simulator or on a device. Nothing verified on a device |
| 4. Live Location and Group Coordination | Not started | |
| 5. Offline Navigation and GPX Trails | Not started | |
| 6. Reliability, Synchronization and Production Hardening | Not started | |

## Open decisions (need an owner)

| ID | Decision | Needed by | Notes |
|---|---|---|---|
| D-1 | ~~SDK licence route~~ | Closed 2026-10-30 | Company-owned SDK, internal demo of the pub/sub model. Not a constraint |
| D-6 | Group-backed topics (ADR 0036) before or after the app? | Closed 2026-10-30 | After, only if Phase 4 metrics justify it. App is built on per-person subscriptions (ADR 0035) |
| D-2 | App identifier / `appId` (placeholder `app.muster`) and bundle ids | Phase 1 | Changing `appId` later changes the SDK storage namespace and identity |
| D-3 | Where region files are hosted (object storage/CDN) and who builds them | Phase 1 | No server code, only static files |
| D-4 | Initial region set and zoom caps | Phase 1 | Drives download sizes |
| D-5 | ~~Target group size~~ | Closed 2026-11-01 | Hard cap 12 active members per group (organizer holds 3 follows per member; ADR 0035 limits) |

## Spike / assumption register

| ID | Question | Phase | Result |
|---|---|---|---|
| S1-1 / A-14 | Does RN MapLibre v11 render `pmtiles://file://` on iOS and Android offline? | 1 | **iOS simulator: YES** (world z0-3 and a z0-15 region render with labels and sprites from local files; no tile requests left the process). **Android: not run** (no emulator/device). **Physical iPhone, airplane mode: not run** |
| S1-2 / A-13 | Multiple PMTiles sources performance | 1 | Pending. Style tested with 3 region sources structurally; no FPS measurement |
| S1-3 | op-sqlite vs expo-sqlite benchmark | 1 | Not run. op-sqlite works in the iOS simulator (migrations, adoption, reopen). ADR 0003 provisional |
| S1-4 / A-15 | `expo-location` + heading in a bare RN app | 1 | Partial. iOS simulator: permission grant, simulated fix, puck and accuracy label work. Heading, cold-start time, Android: not tested. RN is 0.81.5 (ADR 0001) |
| P2-1 / A-01 | SDK build leaves tracked SDK files unchanged | 2 | **iOS: confirmed** (clean `git status` before/after build, bindings regenerated byte-identical). **Android: confirmed** (`npm run build:uniffi:android`, 4 ABIs, then SDK `git status --porcelain --untracked-files=no` empty). **A-01 closed.** |
| P2-4 / A-04 | Outbox persistence default in RN | 2 | **Open.** Phase 2 sends no direct messages (pub/sub only), so it was not examined |
| P3-3 / A-05 | Invite over BLE-only; joiner event sequence | 3 | **Not exercised.** Phase 3 uses service subscriptions, not `meshInviteToGroup` (ADR 0007). Stays open for any later move to MLS groups |
| P3-4 / A-06 | DataStore doc id limits | 3 | **Not exercised** (DataStore unused, ADR 0007) |
| P3-5 / A-07 | Group DataStore replication over BLE only | 3 | **Not exercised** (DataStore unused, ADR 0007) |
| A-19 | Provider-side `service_subscription_changed` `active` fires when the app accepts a follower | 3 | Typed in the SDK (`types.ts`, "on either side"); **not observed on a device**. Join welcome and state push depend on it |
| A-20 | SDK `provider`/`sender` is the authenticated peer (basis of authorization) | 3 | Pending (device test M8) |
| A-21 | Subscribe to a provider two hops away; first-subscription time | 3 | Pending (M5) |
| A-22 | `service_subscribe_received` for new and renewed follows under `restricted` | 3 | Pending |
| A-23 | `registerService('tm.group.1', '1')` accepted on both OSes | 3 | Pending |
| A-24 | ~200-character QR scans reliably (expo-camera, both OSes) | 3 | Pending (G2, G7) |
| S4-1 / A-02 | Validate service subscriptions as the live lane (run right after Phase 2) | 4 | Pending. Phase 2 provides the harness (Mesh tab, `MESH_VERIFICATION.md`); no device run yet |
| A-18 | `memberIds` from group info are the `off1…` addresses needed for `subscribeService` | 3 | Not applicable: the roster is Muster's own (member addresses come from subscription requests) |
| A-26 to A-30 | Adventure assumptions: service key charset, relay echo to originator, GPS thresholds, reduced-motion API, MapLibre expressions | Ext. | Pending. Listed with their device tests in `GAMIFICATION_PROGRESS.md` and `GAMIFICATION_TEST_REPORT.md` (D1 to D12) |
| F-1 / A-03 | Trail partitioning and convergence | 6 | Pending |
| B-1 / A-16 | Battery budget | 6 | Pending |

## Phase 1 report (2026-10-31)

### Implemented
- Bare RN **0.81.5** (not 0.82, ADR 0001), TS strict, New Arch, Hermes; Expo SDK 54 modules wired by hand. React Navigation (tabs + stack), Zustand, op-sqlite behind `DbPort`, zod, ESLint with architecture import-boundary and no-network rules, Prettier, Jest.
- Layers per ARCHITECTURE.md 3: `domain` (pure geo, PMTiles header, region state machine, coverage, permission/GPS state), `data` (DbPort, serial write queue, migration runner, repositories), `platform` (file, location), `features/{map,maps-manager,markers,settings}`, `runtime` (DI + hooks), `ui` (design system).
- Map: MapLibre v11 with runtime-built style (bundled z0-3 world base + up to 3 region PMTiles sources, local glyphs/sprites), pan/zoom/rotate (native gestures), compass, follow / follow+heading, own location puck + accuracy circle + heading cone, GPS status chip (acquiring / ok / weak / lost after 15 s / off), permission banners, coverage banner, attribution on the map and in About.
- Offline regions: catalog (remote, cached, bundled fallback), resumable streamed download with `.part` + Range, SHA-256 verify, PMTiles header validation, atomic install, pause/resume/discard, free-space guard (1.2x), interrupted-state recovery on launch, orphan-file adoption, import from Files, delete, storage usage, regions list with sizes.
- Markers: long-press to add, persisted in SQLite (`local_points`), rename, move (crosshair at map centre), delete, lat/lon display, straight-line distance + bearing from GPS, Saved Locations list with show-on-map.
- Screens: Main Map, Download maps, Downloaded maps, Saved locations, Settings (permissions, storage, diagnostics v0, catalog address, About).
- `tools/region-builder` (`build.mjs` extract + sha256 + catalog, `serve.mjs` Range-capable dev server with throttle / drop-connection options), `scripts/gen-style-assets.mjs`, 5 ADRs.
- Test regions built from Protomaps build 2026-10-29 (ODbL): `lake-district` 25.8 MB (z0-15), `ben-nevis` 1.5 MB (z0-14), plus dev fixtures `test-corrupt` and `test-too-large` in `catalog.dev.json`. D-4 still open; these are test regions.

### Automated results
| Check | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors (a few harmless warnings) |
| `npm test` | 123 tests in 9 suites, all pass |
| iOS debug build (simulator, iPhone 17) | **succeeds** |
| Android `assembleDebug` (arm64-v8a only, debug) | **succeeds** (debug APK 60 MB, arm64 only, includes the ~6.4 MB generated style modules in the JS bundle). Never installed or run: no emulator/device |
| Real SQLite (Node built-in) | migrations v0->v1, rollback on failure, crash-safe re-run, close/reopen persistence, 50 concurrent writes |

What the unit tests cover: geo math; PMTiles header (including a real Protomaps extract); region state machine; coverage; permission and GPS-lost logic; `LocationService`; `MapPackManager` with fake HTTP/FS (success, pause+Range resume, kill+resume via new instance, network drop, server ignoring Range, corrupt sha256, invalid PMTiles, 1.2x space guard, oversize stream, disk-write failure, cancel, double-start, import valid/invalid/too big, delete, storage, catalog fallback chain, orphan adoption); `StyleBuilder` (validated by the MapLibre style-spec validator; no remote URL in style; attribution on every source); style asset bootstrap; component tests for the five screens against a **mocked** MapLibre module; AC8 tests (no fetch/XHR/WebSocket in core flows, source scan, HTTP client constructed only in the composition root).

Bugs found by testing and fixed: double-tap Download could start two jobs on one `.part` file; deep-link focus ignored data that loaded after mount; recursive storage walk and empty `Directory.list()` names (found only on the simulator: Hermes OOM at launch); zod 4 needs a Babel plugin under Metro.

### iOS simulator evidence (iPhone 17, iOS 26.5; debug build, Metro on localhost)
What was observed (screenshots reviewed, not just logs):
- App cold-starts: DB opens and migrates, bundled style assets and world base are written to Documents/style, tabs render.
- Bundled world base (z0-3) renders through `pmtiles://file://` with country labels (local glyphs), city markers (local sprite) and attribution visible.
- A `lake-district.pmtiles` copied into `Documents/maps` was adopted at launch and rendered at ~z14 (terrain, water, tracks, peak icons, labels). It was still installed and rendered after killing and relaunching the app.
- `simctl privacy grant location` + `simctl location set` produced a puck and "GPS +/-5 m" chip; with the static simulated location no further fixes arrive, so the chip goes to "GPS lost" after 15 s (iOS only delivers on change). On real hardware, confirm this does not false-alarm when stationary.
- While the map was used, the app process had sockets only to the local Metro server; the dev tile/catalog server logged **no** requests.
- MapLibre logs glyph-range errors for scripts outside the bundled subset (e.g. Arabic). Non-fatal; labels in those scripts are missing (ADR 0002).

### NOT verified (do not treat as done)
- **Airplane mode** on any device or simulator (the simulator shares the Mac's network; "no sockets" is not the same as airplane mode). AC1 on iOS and Android devices: not tested.
- **Any touch interaction on a running app**: long-press to add a marker, drag/rotate/zoom gestures, follow button, Download/Pause/Resume/Delete buttons, Files import picker, alerts. No UI automation was available (Maestro install was not permitted; deep links need an OS confirmation tap). These paths are covered only by Jest with a mocked map and fake network/file system.
- **Download on a real runtime**: `expo/fetch` streaming, `FileHandle` writes, Range resume after app kill, and SHA-256 speed on Hermes have not been run on a simulator or device. (AC2)
- **Heading/compass**, cold-start GPS time, walking track, reduced-accuracy (iOS) and coarse (Android) permission flows. (AC4)
- **Android**: no emulator or device; only a build attempt (below). Android file/permission/manifest behaviour untested.
- Cold start to interactive map < 3 s (AC9); bundle/install size (A-11); memory/FPS with 3 regions (A-13); low-storage behaviour on a real device; iOS iCloud backup exclusion of maps (not implemented; Android `allowBackup=false` is set).
- Release build; `npm run ios` / `android` convenience flows.

### Acceptance criteria status
| AC | Status |
|---|---|
| AC1 offline render, no network | Partially evidenced on iOS simulator; **device + airplane mode pending** |
| AC2 resume / corrupt / space | Logic proven in unit tests; **real-runtime pending** |
| AC3 import valid/invalid | Logic + component tests; **picker flow pending** |
| AC4 location, accuracy, heading, GPS lost | Puck/accuracy/lost logic done and partly seen on simulator; **heading and devices pending** |
| AC5 markers persist, independent of tiles | Persistence tested (SQLite reopen); on-device interaction **pending** |
| AC6 outside coverage | Component-tested; **on-device pending** |
| AC7 attribution on map and About | Visible on simulator map; About component-tested |
| AC8 no network outside download | Automated tests pass; process-level check on simulator |
| AC9 cold start < 3 s | **Not measured on reference device** |

Phase 1 is therefore **not marked complete**. Phase 2 not started.

### Remaining manual verification (device matrix, per PHASE_1.md)
1. iPhone + Android phone, airplane mode, installed region: render, pan/zoom/rotate, screenshot (AC1, S1-1).
2. Download `lake-district` over Wi-Fi with `serve.mjs --drop-after-mb 5`, kill the app mid-download, toggle Wi-Fi: resumes and passes sha (AC2). Download `test-corrupt` (rejected, removed) and `test-too-large` (refused).
3. Import a valid and an invalid `.pmtiles` from Files (AC3).
4. Outdoor cold GPS, walk 500 m; compass within +/-15 degrees; background the app and return; deny / approximate (iOS) / coarse (Android) permission paths (AC4, S1-4).
5. Long-press marker, move, delete, relaunch (AC5); pan outside coverage (AC6).
6. Time cold start with a region (AC9); measure APK/IPA and install size (A-11); 3 regions on the oldest Android (A-13); run S1-3 benchmark; time SHA-256 of a 200 MB file on Hermes.
7. Decide D-2 (appId; currently placeholder `app.muster`), D-3 (hosting), D-4 (regions).

### Deviations from the plan
- RN 0.81.5 instead of 0.82 (ADR 0001). World base z0-3 (2.4 MB), not z0-5 (15 MB), embedded as base64 modules (ADR 0002). Own streaming downloader instead of `createDownloadResumable` (ADR 0004). `map_regions` gained `error_code`, `source_url`, and a `paused` state. A `runtime/` layer (DI context + hooks) and `ui/` layer were added to keep features from importing each other. `muster://` URL scheme registered (deep links to tabs).
- Not done: `PmtilesFileStrategy` fallbacks (loopback server, MBTiles) were not needed on iOS and are not implemented; CI pipeline files and pre-commit hook were not created; E2E (Maestro/Detox) not set up; `MAP_ARCHITECTURE.md` measured sizes updated only via ADR 0002.

### Repo hygiene notes
- An empty `.git` directory (no commits) was created inside `trailmesh/` by an accidental `git init`; it can be deleted.
- `build/`, `ios/Pods`, build logs and `tools/region-builder/{out,hosted}` are build products (gitignored).

## Phase 2 report (2026-10-31)

### Implemented
- **Local SDK build and link** (ADR 0006): SDK natives built from `../offline-protocol-sdk` with its own scripts; `file:` dependency; Metro auto-detects the symlink; `scripts/sdk-source.sh local|npm`; rebuild steps in `SDK_INTEGRATION.md` 2.5. SDK source unchanged (`git status --porcelain --untracked-files=no` empty after every build).
- **Native config:** iOS `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`, `UIBackgroundModes` bluetooth-central/peripheral; Android `POST_NOTIFICATIONS` (the SDK manifest supplies the Bluetooth and foreground-service permissions). `expo-battery` added for the battery feed.
- **`src/mesh/`** (imports only `shared/`; the SDK only in `sdk.ts`):
  - `SdkMeshAdapter` (`MeshPort`): permission check/request, Bluetooth detection and enable request (Android), start/stop/destroy, listeners registered before `start()`, never reuses a destroyed instance, battery feed, foreground `reconcile()`, `mesh_stopped_by_user` handling, peers from `neighbor_discovered/lost`, `Connected` only from `getTopology()` links, SDK `diagnostic` warnings.
  - `PubSub`: subscribe / unsubscribe / unsubscribeAll, provide / stopProviding, accept/reject subscriber, publish, `onMessage` handlers, error list, restore after SDK restart.
  - `envelope.ts` (zod, 2 KB budget, version gate), `topics.ts` (`tm/1/<scope>/<channel>`, `diag` scope), `SeenIds` (memory dedupe) + `events` table (migration 2, dedupe across restarts, persisted before handlers run).
- **Mesh tab** (developer diagnostics): SDK state, Bluetooth, permissions, address, start/stop, scanning animation (honours Reduce Motion), nearby peers with Nearby/Connected/Lost and RSSI, test publisher (event/state), consent requests, test subscriber, subscriptions, published list with SDK delivery counts, received list with duplicate flag, errors and SDK diagnostics. UI imports no SDK code.
- **Test doubles** (`src/testing`, never imported by production code, enforced by a test): `FakeSdk`, `FakeMesh` + `FakeNetwork`.
- **Docs:** `SDK_INTEGRATION.md` section 13 (calls used, findings, unverified list), `MESH_PROTOCOL.md` 2.2, `MESH_VERIFICATION.md`, ADR 0006.

### Automated results (2026-10-31)
- `npm run typecheck`: pass. `npm run lint`: 0 errors, 4 warnings (2 pre-existing style, 2 `self` alias in `FakeSdk`). `npm run format:check`: pass.
- `npm test`: 14 suites, 213 tests pass (90 new: envelope/topics 20, pub/sub 21, adapter 35, boundaries 6, screen 8; Phase 1 tests unchanged except the schema label and migration version).
- Covered: serialization round-trip and size/shape/version rejection; unique message ids; duplicate suppression in memory and across a simulated restart via SQLite; persistence-before-handler; subscription cleanup (unsubscribe, unsubscribeAll, handler detach, `dispose` releases all transport listeners); provider consent; restore after SDK restart; listener-before-start order; permission and Bluetooth paths per OS; failed start/stop; stop-by-user idempotency; foreground reconcile; destroy then new instance; battery feed; `enableTelemetry` never called (runtime and source scan); single SDK import site.
- `react-native bundle` for iOS and Android succeeds with the symlinked SDK; one copy of react/react-native.
- **iOS simulator:** `xcodebuild` Debug build with the local SDK **succeeded** (compiles and links `MeshSdk` and `offline_protocol_uniffi.xcframework`); built Info.plist contains the Bluetooth keys and background modes; the app launched against Metro and reached the map with no native-module error. The Mesh tab was **not** exercised on the simulator (opening it needs an OS "Open in Muster?" tap that no available tool can press; same limit as Phase 1). The screen is covered by component tests with `FakeMesh`.
- **Android:** SDK natives built for arm64-v8a, armeabi-v7a, x86_64, x86 (jniLibs). `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` **succeeded** (78 MB debug APK containing `libuniffi_offline_protocol.so`; merged manifest has `BLUETOOTH_SCAN` (neverForLocation), `BLUETOOTH_ADVERTISE/CONNECT`, legacy `BLUETOOTH*` (<=30), `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` and the `MeshForegroundService` `connectedDevice` service). Only arm64 was built to save disk; the other ABIs were not compiled into an app. The APK was **not installed or run** (no emulator/device).

### NOT verified (do not claim)
- **Any real Bluetooth behaviour on any device**: discovery, `Connected`, subscription handshake, publish/receive between two phones, range, loss, background, Android notification Stop, permission prompts, iOS Bluetooth prompt, battery. The simulator cannot do BLE. Acceptance criteria AC1-AC4, AC7 are therefore **open**; AC5 (single import site) and AC8 (telemetry) and AC6 on iOS (SDK tree clean) are evidenced by tests/commands above. AC5's `npm` mode switch is **not tested** (no published version was installed).
- The Mesh tab visually on a simulator or device (no screenshot taken).
- Running the Android app (build only; no emulator or device) and a 4-ABI Gradle build.

### Unsupported SDK capabilities and blockers
- No group-scoped topics (unchanged, G1): pub/sub is per-provider. A consumer must know a provider's address; the screen offers nearby peers and a typed address.
- No delivery acknowledgement for service updates; only the publisher's `ServicePublishReport`. The UI never says "delivered".
- No connected-peers API (derived from topology); no iOS Bluetooth authorisation query from JS.
- Open question for the SDK owners: how a consumer that subscribes before the provider has re-registered is handled (device test step 12).
- Pre-existing tooling issue: `npm install` needs `--legacy-peer-deps` (`@babel/plugin-transform-export-namespace-from@8` vs `@babel/core@7`).
- Disk: this machine has ~3-5 GiB free. The iOS SDK build wrote ~1.7 GiB to `offline-protocol-sdk/target`; Android adds more. Builds were run one at a time with a free-space watchdog.
- A Metro server from an earlier session was still listening on 8081 with the old config; it was left running. Restart it (`--reset-cache`) before using the Mesh tab in a debug build.

### Deviations from `PHASE_2.md`
- Direct-message ping (P2-8), Wi-Fi Direct (P2-10), the Nearby QR/copy identity screen and the `sdk-source.sh npm` CI matrix (P2-9) are **not done**: this phase was scoped to pub/sub, so the test publisher/subscriber replaces the ping. Wi-Fi Direct is disabled.
- `FakeMesh` simulates two-node pub/sub with loss and duplication, not N peers with latency/partition.
- `appId` is still the placeholder `app.muster` (D-2 open): changing it later rotates SDK storage and identity.

### Next step (needs a human with two phones)
Run `docs/MESH_VERIFICATION.md` on two devices with the network disabled and fill in its results table and the device log below. Phase 3 is not started.

## Phase 3 report (2026-11-01)

### Implemented
- **Group management:** create (ULID id, name, creator is organizer), roster with names, roles and `Connected` badge, leave (member) / end (organizer), remove member (organizer), all persisted in SQLite (migration 3). Capacity 12 active members.
- **Joining:** organizer shows an invitation QR (`muster://join?v=1&g&o&t&n`, 128-bit single-use token, 24 h, hash stored, optional auto-approve); joiner scans it (expo-camera), pastes the link, or opens the deep link. **Nearby discovery:** the organizer opens the group for 10 minutes; joiners list groups found among nearby peers and ask to join; approval is always required. The join request is the SDK subscription request itself.
- **Group pub/sub** (MESH_PROTOCOL.md 2.3, ADR 0007): topics for membership events, meeting point updates, removals, acknowledgments and sync requests, plus the join reply and the beacon. No wildcard, retained message or replay is used. Organizer-star topology, state pushed by the provider when a follower becomes active, `sync_request` fallback, subscriptions re-established on start / mesh change / every 30 s.
- **Authorization:** group state is accepted only from the organizer recorded locally; member messages only from active roster members, only about themselves; subscription requests are gated the same way; envelope author must equal the SDK sender; all payloads zod-validated and bounded.
- **Meeting points:** the organizer long-presses the map (choice: meeting point for a group vs personal marker), adds a name and optional description, publishes, edits, moves (crosshair) and removes. Members see them as map markers (distinct colour, label, ring on selection, green outline once acknowledged), open a sheet (who shared / updated, distance, Acknowledge) and a details screen. Highest `rev` wins, tie by greatest author, tombstones for removals, duplicate envelopes rejected (memory + `events` table), out-of-order safe.
- **UI:** Groups tab with Groups, Create Group, Join Group, Group Details and Meeting Point Details screens; sheet, editor and move controls on the map; mesh-off banner with Start; pending-join cards; notices.
- **Layering:** `domain/groups` (pure), `data` repos, `features/groups/GroupService`, `mesh/groupTopics`, additive `PubSub` hooks (`owns`, `onRequest`, `onSubscriptionEvent`), runtime hooks. Phase 1 and 2 code and behaviour are unchanged (all 213 earlier tests pass untouched except one schema label v2 -> v3).
- **Dependencies:** `expo-camera`, `qrcode-generator` (ADR 0008). No SDK change: SDK `git status --porcelain --untracked-files=no` empty after all builds.

### Automated results (2026-11-01)
| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 4 warnings (pre-existing style, `self` alias in `FakeSdk`, one shadow in `QrCode`) |
| `npm run format:check` | pass |
| `npm test` | **302 tests in 19 suites pass** (213 earlier + 89 new) |
| `react-native bundle` iOS / Android | succeed |
| iOS simulator Debug `xcodebuild` (with expo-camera, `pod install`) | **BUILD SUCCEEDED**. App not launched or exercised |
| Android `assembleDebug` arm64-v8a | succeeds (87 MB); merged manifest has `CAMERA`, no `RECORD_AUDIO`. Not installed or run |

New tests: `groupsDomain` (version ordering over every arrival order, idempotence, authorization table, invite tokens/links/expiry, topics, point serialization and size budget, marker rendering), `groupsMesh` (create, join by invite / auto-approve / nearby, rejection, single use, expiry, capacity, publish / update / remove, acknowledgments incl. delivery after reconnect, away-and-back, leave / remove / end), `groupsSecurity` (non-member, other member, forged author, wrong author field, roster forgery, non-member ack / hello / sync, refused follows, malformed payloads, duplicates, out-of-order, removal-before-point, sync request), `groupsPersistence` (migration 2 -> 3 keeps data, state survives a real file-database restart, inbox dedupe across restart, restarted member catches up, stale join cleanup), `groupsScreens` (all five screens and the map: long-press choice, editor publish, received coordinates as markers, acknowledge, removal). The authorizer was mutation-checked (allowing everything makes 5 security tests fail).

### NOT verified (do not claim)
- **Any real Bluetooth behaviour**: join, state push, acknowledgments, reconnection, two-hop, range, background. `FakeMesh` is an in-memory double and now also emits provider-side activation / ending events as the SDK type documents (A-19); the real SDK has not been observed doing so. If A-19 is wrong the join stalls at "Waiting" (see GROUPS_VERIFICATION.md).
- QR **scanning** on any device (the camera view is mocked in tests); QR display is tested only as a rendered matrix. No simulator interaction was possible (no UI automation), so no screenshots exist of the new screens.
- Android and iOS runtime of the new screens and the camera permission flows.
- Physical-device plan: `docs/GROUPS_VERIFICATION.md` (G1-G7, M1-M9, L1-L4, P1).

### Acceptance against PHASE_3.md (as re-scoped by the brief)
| Criterion | Status |
|---|---|
| AC1 roster identical on all devices after QR join | Logic proven with `FakeMesh`; **devices pending** |
| AC2 point on all maps in 10 s / 60 s two-hop | **Pending** (needs devices) |
| AC3 offline member catches up | Logic proven (away-and-back, restart); **devices pending** |
| AC4 / AC5 concurrent edit / delete resolution | Single writer (organizer) so no concurrent edits; ordering rule proven for all arrival orders including delete vs edit |
| AC6 tampered record does not crash | Proven (malformed / out-of-range payloads rejected and counted) |
| AC7 non-members ignored, removed members stop appearing | Proven in tests; devices pending |
| AC8 older app refused | **Not done**: only one build exists; `hello.appV` is sent but no `minAppVersion` gate yet |
| AC9 kill and restart keeps state | Proven with a real file database; an unsent acknowledgment is re-sent exactly once logically |
| AC10 licence | Closed earlier (D-1) |

### Deviations from `PHASE_3.md` and the earlier protocol text
- Transport is service subscriptions, not DataStore / MLS groups / group messages (ADR 0007), as the brief requires. No `ReplicatedDocs`, `MeshBus` or event lane.
- **Only the organizer** publishes meeting points (brief); PHASE_3.md / section 3.3 let any member edit. Personal markers (`local_points`) are **not** migrated into groups; they stay personal.
- No `minAppVersion` / version gate yet (P3-10), no `enforceAdminCommits` evaluation (P3-11), no co-admin promotion, no group rename, no local notifications beyond in-app notices. Kinds other than "meeting" (waypoint / hazard / camp) and `radiusM` were left out.
- Members do not see each other's acknowledgments; the organizer is a single point of failure for new points while out of range (ADR 0007 consequences).
- `PubSub` lost no behaviour but gained three additive hooks; `FakeMesh` now emits provider-side and `ended` events.

### Known limitations
- Retries to an absent member are limited to one attempt per minute per topic and rely on the 30 s timer; a long absence costs battery only as much as those attempts.
- If the app is killed after an envelope was stored but before it was applied, that envelope counts as a duplicate when redelivered; the next organizer push or **Sync now** repairs it (envelope ids are new on every push).
- A joiner's name is unknown to the organizer until the `hello` arrives, so the approval prompt shows the short address.
- Android: `RECORD_AUDIO` removed from the merged manifest; the debug build was not run.

### Next step (needs people with phones)
Run `docs/GROUPS_VERIFICATION.md`, record A-19 to A-24 and fill the device log. Phase 4 is not started.

## Log

| Date | Entry |
|---|---|
| 2026-10-30 | Phase 0 complete. Inspected `offline-protocol-sdk` 0.31.0 (read-only). Key findings: no group-scoped pub/sub in the SDK (ADR 0036 unimplemented), service subscriptions exist but ADR 0035 is "Proposed", DataStore CRDT documents are the best fit for shared state, SDK licence is AGPL-3.0/commercial. Researched MapLibre RN v11.5.1, PMTiles, OSM tile policies. Nothing built or installed. `offline-protocol-sdk` not modified |

| 2026-11-09 | Trail UI redesign (ADR 0014), branch `redesign/trail-ui`: tokens in `src/ui/theme.tsx`, four tabs with a soft-green active pill, Compass inside navigation (Map \| Compass, shared `navSession` store, tab bar hidden while navigating or placing a pin), orange flag meeting pins, new meeting sheet, navigating card, set meeting point steps 1 and 2, redesigned groups list, group page and group info; follower Acknowledge removed from the UI (pub/sub). UI only: no mesh, SDK, data model or protocol change. typecheck, lint (0 errors), 648 Jest tests and the iOS JS bundle pass. **Not checked in a simulator or on a device** (a native build first needs `pod install` for `expo-image-picker`) |
| 2026-11-09 | Group trip map (ADR 0013): the organizer chooses one area on the map in Group info; it is sent in each person's welcome (`rg`, optional, no new message) and locked once someone joins. Members get a Download card, a banner on the group page and a "Map not downloaded" badge until a downloaded map covers it. Migration 7. `MapArea` moved to `domain/maps/mapArea.ts`; one `useAreaDownload` hook for the trip map and activities. 20 new tests (`groupsTripMap`, `groupsScreens`, `pickLocation`); 645 pass. **Not checked on a device or in a simulator** |
| 2026-11-01 | Online map while no downloaded region covers the view (remote planet PMTiles, assumption A-25 **unverified on device**) and online place search (Nominatim, dev only) feeding the download sheet. CLAUDE.md rule 6 amended with this exception |
| 2026-11-08 | Join requests not reaching the organizer: fixed (ADR 0012). The app was linked to the SDK checkout's 2026-10-31 natives despite `^0.32.0` in `package.json` (lockfile `link: true`); now the published `@offline-protocol/mesh-sdk@0.32.0` (pinned, registry install, `pod install` done). App fixes: join request admitted by the SDK at once and approved by the app (no 60 s approval timeout), resume coalesced and run only on lifecycle/address/nearby changes, retries subscribe again instead of reusing an ended id, beacons always accepted (no re-subscribe storm), joiner drops its join topic once in. `__tests__/groupsJoin.test.ts` (8 of 9 fail on the old code). Device run (Android Realme RMX5108 joiner, iPhone 15 organizer, both 0.32.0): the request reached the iPhone after 3-4 min, past the SDK's 120 s pending timeout; Android logcat shows indications to the iPhone never confirmed (`Notification flushed` absent). Added: a join that times out without an answer is asked again for up to 10 min, one card per person. Then: the joiner's name rides in the subscription params (card shows it); out-of-range providers back off 1 -> 30 min. A device run on a temporary diagnostic SDK build with engine logging traced the slowness to the iPhone probing 8 dead pending sessions every 5 s, each probe re-offered to the Realme; SDK fix on branch `fix/mesh-only-probe-backoff` (probe back-off when only the mesh could carry it), SDK tests green. **Verified on the two phones**: the request arrived in seconds and the joiner left "waiting" right after approval; iPhone-to-Realme fragments fell from 2,502 in 5 min to 59. The diagnostic switch was not kept. Muster is on the local SDK until the fix is released |
| 2026-11-03 | Navigation redesign step 5: Activity tab, adventure toast host (not over the Map), dead code removed. Simulator + Jest |
| 2026-11-03 | Navigation redesign step 5: Activity tab, adventure toast host (not over the Map), dead code removed. Simulator + Jest |
| 2026-11-03 | Navigation redesign step 4: chat-style group page (Updates) and Group info screen. Jest only |
| 2026-11-03 | Navigation redesign step 3: Compass tab with optional grouped location dropdown. Jest only |
| 2026-11-03 | Navigation redesign step 2: stripped Map, tap-to-pin, in-map straight-line navigation. Jest only |
| 2026-11-03 | Navigation redesign step 1: five tabs, Profile tab owns name and photo, group screens no longer ask for a name. ADR 0010. Jest only |
| 2026-11-02 | Adventures and achievements (gamification) implemented: migration 4, `adv` channel on the group service (ADR 0009), 13 badges, arrival detection, route and distance, recap and journal, map overlay, reduced-motion-aware celebration. Not accepted: no device verification. No change to existing mesh contracts; SDK untouched. Docs: `GAMIFICATION_*.md` |
| 2026-11-01 | Custom map areas: download whatever the map shows by extracting from a hosted planet PMTiles with range requests (`RegionExtractor`, `AreaDownloadSheet`, `fflate` for directory gzip). Debug builds fall back to the public Protomaps daily build (`devPlanet()`, dated 2 days back); release builds need D-3: a self-hosted planet file with Range support and `--planet-url` in the catalog. Verified in Node against the real 2026-10-30 build (Ben Nevis z14 = 1,619,870 B vs 1,619,872 B from the `pmtiles` CLI); **not run on a device**. Onboarding screen added |
| 2026-11-01 | UI restyled to `DESIGN_SYSTEM.md`: new tokens/components (Button, Card, StatusPill, ListRow, SegmentedTabs, Icon), four tabs (Map, Group, Navigate, More), new Navigate and More screens, group details split into Members / Updates / Meeting point. Glyph icons pending a Lucide + react-native-svg decision. Not checked on a device |
| 2026-11-01 | Phase 3 implemented (see Phase 3 report). Not accepted: no device verification. Groups built on service subscriptions (ADR 0007); expo-camera + qrcode-generator added (ADR 0008). SDK untouched |
| 2026-10-31 | Phase 2 implemented (see Phase 2 report). Not accepted: no device verification. iOS SDK natives built from `offline-protocol-sdk` and linked; SDK tracked files unchanged |
| 2026-10-31 | Phase 1 implemented (see Phase 1 report). Not accepted: device verification pending. Nothing in `offline-protocol-sdk` touched |

## Navigation redesign (2026-11-03), step 1 of 5

Decision (ADR 0010): the architecture is purpose-agnostic (offline location sharing for any group); hiking stays the marketing frame. Agreed target: tabs **Compass, Activity, Map (centre, launch tab), Groups, Profile**; Map shows only recenter, download, search and an offline-coverage icon; Compass gets a target dropdown grouped by group; group screen becomes WhatsApp-like (Updates default, members in group info, tapping a meeting point opens it on the map); selecting a map point offers "Start navigation" (straight line). **Out of scope for now:** offline routing and short text messages over the mesh.

Done in step 1: five-tab shell (`Navigate` route is labelled "Compass"; `More` is gone, replaced by `Activity` and `Profile` stacks), Profile tab (name, local-only photo via `expo-document-picker`, Settings icon top right, Downloaded maps / Saved locations / Mesh diagnostics rows), name input removed from Create and Join group (they read `profile.name` and point to Profile when empty). Jest only, **not run on a device**; the photo is stored under `<documents>/profile/` and is never sent over the mesh.

Step 2 done (2026-11-03): the Map shows a search bar alone on top, and in the bottom-right corner, stacked vertically: an offline-coverage icon (`◉` available offline, `◌` online map not saved; tap explains and offers the download), download and recenter, plus the mandatory OSM attribution. Removed from the map: GPS/mesh/online pills, permission/coverage/first-run/info banners, mesh status sheet, group card, adventure banners and progress chip. Tapping empty map drops a temporary pin (`PinSheet`: distance, Start navigation, Save); markers and meeting points have "Start navigation" in their sheets; navigation draws a dashed straight line from the GPS fix and shows `NavigationBar` (name, distance, bearing, "straight line, terrain not considered", End). Long-press still offers marker / meeting point / checkpoint. Jest only, **not run on a device**. A-26 `[ASSUMPTION]`: a feature tap does not also fire the map `onPress` in MapLibre RN 11; a 350 ms guard covers it either way, unverified on device.

Known gaps from step 2: `MeshStatusSheet`, `AdventureChip` and the group-card code are now unused (delete in step 5). `AdventureBanners` (arrival, badge, hint toasts) is no longer mounted anywhere, so checkpoint hints and "badge earned" are not shown until step 5 gives them a home; arrival detection itself still runs. The permission banner is gone: recenter requests permission or opens Settings, but there is no passive "location off" message on the map.

Step 3 done (2026-11-03): Compass tab works with no target (a dial that turns against the heading, so north stays north, plus the heading in degrees) and has an optional dropdown (`TargetPicker`) of locations: meeting points grouped by group, then "My places" (markers), plus "Compass only" to clear. Deep links (`groupId/pointId`, `markerId`, `adventureId/checkpointId`) still select a target. Nothing is selected by default (it used to pick the first meeting point). Adventure checkpoints are only selectable by deep link, not in the dropdown. Dial rotation depends on the device heading sensor; **not verified on a device** (the old arrow-relative-to-heading maths was reworked).

Step 4 done (2026-11-03): the group page (`GroupDetailsScreen`) is a chat-style Updates feed (events only, no text messages): day labels, centred "X joined/left" pills, and meeting-point cards that open the point on the Map; newest at the bottom (inverted list). The header (back, avatar, name, "N members · mesh status") opens the new `GroupInfoScreen` (route `GroupInfo`), which holds what used to be tabs: meeting points (tap = plotted on the Map), adventures, members, invitations (QR, nearby, requests), Sync now and Leave/End. Organizers see a bar "Press and hold the map to share a meeting point" with an Open map button. Jest only, **not run on a device**. 

Groups flow pass (2026-11-03): the Groups list is titled "Groups", sorted active / waiting / ended, rows show an avatar and "N members · You organize"; with no groups it shows two start cards (Start a group, Join a group), otherwise compact Create/Join buttons. Create asks only for the group name (autofocus, "You will join as <profile name>") and lands on Group info with the invitation QR already shown and a Done button. Join: a deep link shows "You are invited to <group>" with one Join button; otherwise Scan QR first, then groups open nearby (with Ask to join), with pasting a link tucked behind "Paste an invitation link instead"; while waiting there is a card with Cancel request. Jest only for logic; layout checked on the iOS simulator (iPhone 17 Pro) with seeded groups, not on a physical device.

Groups tidy pass (2026-11-03), found by running the screens on the simulator: meeting-point update cards had collapsed to a sliver (fixed width), banners on the group page ran edge to edge (now padded), the status pill on Group info was left-aligned (centred), Group info sections reordered (meeting points, members, invite, adventures, sync/leave), list-row trailing badges are now vertically centred, the group icon glyph `☺` rendered as a colour emoji on iOS (text variation selector added to `☺ ☻ ⚙ ⚑`), and the "+" icon on Scan QR code was dropped.

Icons, tab bar and onboarding (2026-11-03): the glyph characters are replaced by one icon family, Ionicons through `@expo/vector-icons` (already installed with expo; its font loads through the already-linked expo-font, so no new native module). The name-to-icon table is still the single place in `ui/components.tsx` that knows the family; the selected tab uses the filled variant. The bottom bar now has the Map as a raised round button in the centre (green when selected). Onboarding asks for a name on its own second screen ("Step 2 of 2": initial-letter avatar preview, autofocused field, Continue disabled until non-blank, Back to the welcome; trimmed and stored as `profile.name`). Checked in the iOS simulator in a debug build (icons render, tab bar and onboarding look right). `[ASSUMPTION A-27]` the icon font also loads in a **release** build (bare RN with expo-font and expo-asset linked); not verified, test a release build before shipping. If it fails, icons render blank and the fallback is bundling the font natively. `DESIGN_SYSTEM.md` still names Lucide; Ionicons is used instead until `react-native-svg` is added.

Step 5 done (2026-11-03): the old Adventures screen is now the Activity tab (title "Activity", a "+" in the header starts a new adventure, trophy icon on Achievements, no back arrow since it is a tab root). Adventure news (checkpoint reached, near-checkpoint hint, badge earned, adventure finished) is shown by `AdventureToastHost` as a banner over every tab **except the Map**; while the Map is open the news waits and appears on the next tab, so a hiker who never leaves the Map does not see arrival banners (decision to revisit if that is wrong; arrival detection itself is unaffected). `AdventureBanners` moved to `features/adventures` (features may not import each other). Removed dead code: `MeshStatusSheet`, `AdventureChip`. Checked in the simulator: Map and Activity launch; the host crashed the first time (it used `useNavigationState` outside a navigator, which the mocked unit tests could not catch) and now takes the current tab from the shell. Not checked: a real arrival toast on a device.

Navigation redesign complete (steps 1 to 5).

## Device test log (template)

| Date | Phase | Devices (model, OS) | Scenario | Result | Notes / issue |
|---|---|---|---|---|---|

## UX pass (2026-11-02)

Audit in `docs/ux-audit.md`. Done: honest mesh status (map pill + explanation sheet, group header, group card; green only when someone is reachable), member presence age and ordering, Navigate as the primary meeting-point action, "Straight line · terrain not considered" label, configurable walking pace and metric/imperial units (Settings, stored in `kv`), Android fixes (spaces in file URIs, location tracking when services report off).

**Not verified on any device.** Covered by Jest only. Presence uses `Peer.lastSeenAt` and received group messages; there are no member positions yet (Phase 4). Not done and why: see the audit's "Not implemented" list (needs new native modules, a local schema change, or a new envelope kind).

## Share location from the group page (2026-11-09)

Meeting points are now shared from the group page, the way a chat app attaches a location: the organizer's bottom bar has **Share location** (and a map button). It opens a sheet with **Send your current location** (with the GPS accuracy; disabled while there is no recent fix, and asks for permission when it has not been given), **Choose on the map** (the Map's pin picker, with search, `pickMeeting` route param; the place comes back to the group page) and **Your saved places**; then the point is named (required), given an optional note and shared with `GroupService.publishPoint`. The long-press on the map no longer offers "Meeting point": it adds a checkpoint or a personal marker as before. Editing, moving and removing a point from its map sheet are unchanged. Still organizer-only, because only the organizer publishes points (star topology, `canPublishPoints`); letting members share would need a protocol change. Covered by Jest (`groupsScreens`, `pickLocation`). **Not checked on a device or in a simulator.**

## Trail UI redesign (2026-11-09)

What changed, per screen (UI only; ADR 0014):

- **Tab bar**: Map, Groups, Activity, Profile; opens on Map; active tab in a soft-green pill; no raised Map button; hidden while navigating or placing a pin.
- **Map**: 52 high search, dark status pill "Offline · N nearby" (N = mesh peers in range), offline and download buttons in one white vertical pill, "center on me" above any sheet, meeting points as orange flag pins with a label chip, "you" in blue with a halo, personal markers green.
- **Meeting point sheet**: orange flag tile, "Shared by … · time · group", close; Distance / Direction (16-point, e.g. NNW 339°) / On foot; the straight-line caption; Navigate; Compass, Edit (leader), More (Move, Details, Remove for the leader; Details for followers).
- **Set meeting point, step 1** (map): header "Set meeting point / Step 1 of 2", search, fixed orange pin with "Drag the map to move the pin", coordinates and "x km NNW of you", "Use this spot →", "Use where I'm standing". **Step 2** (sheet on the group page): STEP 2 OF 2 / Name and share, place row with Change, name with quick chips (Lunch stop, Campsite, Summit, Regroup here), optional note, who is in range, "Share with <group>".
- **Navigating (map)**: dark instruction card (arrow, big distance, "Head NNW · 339° · ~30 min"), amber "Straight line, not a trail route", dashed orange line, bottom panel with destination, Map \| Compass and a soft-red End navigation.
- **Navigating (compass)**: "Navigating to <name>" with Change, heading-up dial (letters move, stay upright, N red), facing marker, orange arrow and target dot, soft green arc between them, big distance, turn hint ("Turn right about 40°" / "Straight ahead"), On foot / Target bearing / Compass, same controls. Without a destination it is a plain compass.
- **Groups list**: Join (QR) and New in the header; cards with tile, name, "N members · You organize", chips (nearby / Nobody nearby, active meeting point with distance, Map saved offline), amber "Trip map not saved offline · size · Download" footer; dashed "Joining someone's trek?" card at the end.
- **Group page**: header with tile, name and a presence line ("Rohan is nearby"), info button; pinned dark card for the newest meeting point with Go (starts navigation on the map); compact amber trip-map banner with Save; Today divider, small centred system events, meeting point cards (stand-in mini map, name, note, Show on map, time); leader composer ("Only you can post here…", orange flag button to set a meeting point, "Share my location"). Followers see the same feed with no composer.
- **Group info**: More button; tile, name, "N members · You organize / You follow"; trip map card with a stand-in preview, "Not saved on this phone", "Save for offline" and the new locked caption; Members / Points / Trips; members with Leader badge, "Follower · nearby now" and a green dot; "Invite people with a QR code" row opens the invitation.
- **Elsewhere** (onboarding, join, profile, settings, offline maps, activity, sheets): new tokens through the shared components, soft-red destructive buttons, bordered cards, onboarding drawn in tokens with leader/follower copy.

**Skipped, because the data does not exist** (no data model change was allowed):
- "Share my location" shares where the leader stands as a meeting point; there is no live leader-location stream yet (Phase 4), so "Leader · sharing location" reads "Leader · shares updates with the group".
- "came into range" feed events (presence is not stored as events).
- "Meet by" time chips (meeting points have no time field).
- Compass accuracy Good/Calibrate (no heading accuracy is read); the third metric says whether the compass has a heading.
- A map-layers button (there are no layers to switch).
- Real map tiles in the feed and trip-map previews (stand-in drawings).
- "Paste coordinates" in the meeting point search: the placeholder says it, but parsing coordinates in the search is not built.
- Manrope is not bundled (system font; one line in the theme once the font files are added).

**Not verified**: none of this has been looked at in a simulator or on a device. In particular the flag pin anchoring (`Marker` offset), the fixed centre pin in step 1, the heading-up dial on a real compass and the hidden tab bar need a look.


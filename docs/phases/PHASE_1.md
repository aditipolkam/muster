# Phase 1: Offline Maps and GPS

## Scope

In:
- Bare RN 0.82 TypeScript project scaffold, lint/test/CI, import-boundary rules.
- MapLibre v11 map screen rendering **local PMTiles regions** with bundled style, glyphs, sprites, world base.
- `MapPackManager`: catalog, resumable download, SHA-256 verify, import from Files, delete, update, storage guard.
- GPS: permissions, current location, accuracy circle, heading/compass, GPS-lost handling.
- Local markers (personal waypoints, not yet shared): create/edit/delete, persisted in SQLite.
- SQLite foundation: `DbPort`, migrations, repositories, kv.
- Attribution control and About screen.

Out: any mesh code, groups, GPX, navigation line, background location.

## Dependencies

Decisions D-2 (appId), D-3 (hosting), D-4 (regions). No SDK needed. Toolchains: Xcode, Android Studio, Node LTS.

## Architecture considerations

- `TileSourceStrategy` interface isolates how tiles reach MapLibre (`PmtilesFileStrategy` first; fallbacks in `MAP_ARCHITECTURE.md` §3.4).
- Bundled style assets are copied to the documents directory at first launch (Android cannot byte-range APK assets).
- `LocationPort`/`HeadingPort` with `expo-location` adapter and a `FakeLocation` for tests.
- Domain geo functions in `src/domain/geo` (pure).
- Create the repo structure from `ARCHITECTURE.md` §3 and the ESLint boundary rules now; they are cheap now and expensive later.
- Reserve `src/mesh/` with an empty `MeshPort` interface only if needed for lint wiring; no SDK dependency yet.

## Spikes (time-boxed, first two weeks, go/no-go)

| ID | Question | Pass criteria | Failure action |
|---|---|---|---|
| S1-1 | RN MapLibre v11 renders `pmtiles://file://<path>` on a real iPhone and Android phone in airplane mode (A-14) | Region renders at z4-z14, pan/zoom/rotate at interactive frame rate, labels visible | Fallback order in `MAP_ARCHITECTURE.md` §3.4; record ADR |
| S1-2 | World base + up to 3 region sources with duplicated layers (A-13) | Sustained smooth pan on the oldest target Android | Merge regions at install; cap sources |
| S1-3 | op-sqlite vs expo-sqlite on target devices: 10k inserts, 1k-row reads, concurrent write queue | Choose by measured numbers and New Arch stability | Use the other behind `DbPort` |
| S1-4 | `expo-location` position + heading in bare RN 0.82 on both OSes (A-15) | Fix in < 60 s outdoors cold, heading stable, permission flows work | Evaluate community geolocation + `expo-sensors` |

## Implementation tasks

1. P1-1 Scaffold project (TypeScript strict, New Arch, Hermes), CI (typecheck, lint, test, build), pre-commit.
2. P1-2 Run spikes S1-1..S1-4; write ADRs with results.
3. P1-3 `DbPort` + migration runner + v1 schema subset (`app_profile`, `map_regions`, `kv`, local `meeting_points` table without `group_id` dependency, or a `local_points` table that Phase 3 migrates). Decision: use `local_points` and migrate in Phase 3.
4. P1-4 `tools/region-builder`: script that runs `pmtiles extract` from a Protomaps build for the D-4 regions, computes SHA-256, emits `catalog.json`; document hosting upload. Produce 2 test regions (small ~50 MB, larger ~200 MB) and one deliberately corrupt file for tests.
5. P1-5 `MapPackManager` state machine + UI (list, size, progress, pause/resume, delete, import).
6. P1-6 `StyleBuilder` + asset bootstrap (glyphs, sprites, world base) + attribution.
7. P1-7 Map screen: camera control, follow-me modes (free / follow / follow+heading), my-location layer, accuracy circle.
8. P1-8 Location permission UX and state machine (undetermined, denied, approximate, granted, services-off).
9. P1-9 Local waypoint markers (long-press add, edit sheet, list).
10. P1-10 Missing-data banner and region coverage index.
11. P1-11 Diagnostics v0 (storage, regions, GPS status).

## Acceptance criteria

- AC1: With airplane mode on and a region installed, the map renders vector tiles, labels and sprites on iOS and Android (no network request is made; verified by a proxy/log check).
- AC2: Downloading a region resumes after app kill and after network loss; a corrupted file (bad SHA-256) is rejected and removed; insufficient space is refused with a clear message.
- AC3: Import of a valid `.pmtiles` works; an invalid file is rejected with a specific reason.
- AC4: Current location appears with accuracy circle; heading arrow tracks device rotation; "GPS lost" state shows within 15 s of losing fixes and recovers automatically.
- AC5: Local markers survive app restarts and are shown on the map independent of tile availability.
- AC6: Outside installed coverage the app shows the banner and still shows my location and markers.
- AC7: OpenStreetMap attribution is visible on the map and in About.
- AC8: No fetch/XHR occurs in the app other than the user-initiated catalog/region download (checked by a test that fails on unexpected network calls).
- AC9: Cold start to interactive map < 3 s with a region installed on the reference mid-range device.

## Automated testing

- Unit: geo math (distance, bearing, bbox, coverage), `MapPackManager` state machine with a fake downloader (resume, corrupt, space), `StyleBuilder` output snapshot (valid style spec; source/layer counts), location permission state machine, migrations (v0 -> v1).
- Component: map screen with a mocked MapLibre module; settings; region list.
- Integration: `DbPort` against real SQLite on a device/CI emulator; repository tests.
- Static: style JSON validated with the MapLibre style spec validator; ESLint boundary rules; no-network lint for core folders.
- E2E (Maestro/Detox) on emulator for non-map flows (region list, permissions); map rendering itself is device-verified.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| Airplane-mode map render (AC1) | 1 iPhone, 1 Android | Renders; screenshot recorded |
| Cold GPS outdoors, walk 500 m | both | Track follows path; accuracy plausible |
| Compass calibration and rotation | both | Heading within +/- 15 degrees of reference |
| Interrupted download (kill app, toggle Wi-Fi) | both | Resumes; sha ok |
| Low storage | Android with small free space | Refused cleanly |
| Reduced/approximate location (iOS), denied permission | iPhone | Graceful degradation |
| Memory/FPS check with 3 regions | oldest Android | No crash; FPS acceptable |
| Binary size and install size measurement (A-11) | both | Recorded in PROGRESS |

## Deliverables

- Running app (internal build) with map, GPS, regions, local markers.
- ADRs: tile source decision (S1-1/S1-2), SQLite choice (S1-3), location lib (S1-4).
- `tools/region-builder` + sample `catalog.json` + hosted test regions.
- Updated `MAP_ARCHITECTURE.md` with measured sizes/performance; `PROGRESS.md` updated.

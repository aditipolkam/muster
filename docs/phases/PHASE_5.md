# Phase 5: Offline Navigation and GPX Trails

## Scope

In:
- Straight-line navigation to a target (meeting point, waypoint, member, trail point): distance, bearing, relative bearing arrow, ETA estimate from recent speed, arrival.
- Navigation HUD (compass rose / arrow, distance units, true vs magnetic note), screen keep-awake option, haptic/audio cue at arrival (local).
- GPX import (file picker and open-in), parsing, validation, persistence, visualisation (lines, start/end, waypoints), stats (length, ascent/descent), list/manage/delete.
- Follow-trail mode: distance along track, remaining distance, off-track distance and alert, nearest-point snapping.
- Waypoints in a GPX can be promoted to meeting points (shared via Phase 3).
- Offline elevation profile from GPX `ele` (if present).

Out: turn-by-turn or computed routing (assessed in `MAP_ARCHITECTURE.md` §10), sharing GPX files over BLE, terrain layers.

## Dependencies

Phase 1 (map, location, heading, DB). Phase 3/4 for member/meeting-point targets (the GPX/solo-navigation parts can ship earlier).

## Architecture considerations

- `NavigationService` consumes `Fix` and `Heading` and a `Target`; pure core in `src/domain/nav` (haversine/geodesic distance, initial bearing, relative bearing, along-track via Turf nearest-point-on-line, deviation, ETA smoothing).
- Heading source: prefer true heading when available; low-speed (< 1 m/s) use compass, higher use course over ground; blend with hysteresis to avoid arrow jitter.
- GPX pipeline on a background schedule (chunked): parse (`fast-xml-parser`) -> validate -> normalise -> compute bbox/length/ascent -> simplify into 3 zoom bands -> write GeoJSON files -> insert metadata rows. Hard limits: 25 MB file, 200k points; larger inputs are simplified at import with a warning.
- Elevation noise filter for ascent/descent (threshold ~3 m with smoothing).
- Targets of type "member" use the last-known position and show its age; the HUD flags stale targets.
- A future `RouterPort` is reserved but not implemented.

## Implementation tasks

1. P5-1 `domain/nav`: distance, bearing, relative bearing, destination point, along-track, deviation, ETA; table-driven tests with known coordinates (incl. antimeridian, poles, short distances).
2. P5-2 Heading fusion and smoothing; calibration prompt.
3. P5-3 Navigation UI: select target from map/list/member; HUD; line on map; arrival detection (reuse Phase 4 arrival service); stale-target banner.
4. P5-4 GPX parser + validator (tracks, routes, waypoints; namespaces; missing fields) with fixtures including large and malformed files.
5. P5-5 Import pipeline, storage, simplification bands, stats; import UI and progress; deletion.
6. P5-6 Trail layer on map; start/end, direction arrows, waypoints; zoom-dependent detail; fit-to-trail.
7. P5-7 Follow-trail mode (progress, remaining, off-track alert, nearest-point), elevation profile view.
8. P5-8 Promote GPX waypoint to meeting point; "navigate to trail start".
9. P5-9 Settings: units (km/mi), arrival radius default, off-track threshold, keep-awake.
10. P5-10 Performance pass on large GPX (50k+ points) on the oldest device.

## Acceptance criteria

- AC1: Distance and bearing match a reference geodesic tool within 0.5% / 0.5 degrees on a test table; displayed values update at >= 1 Hz while moving.
- AC2: The arrow points toward the target within +/- 15 degrees when walking and when stationary (device held flat), on both OSes, in field test.
- AC3: All of the above works in airplane mode, with and without map tiles installed.
- AC4: Valid GPX files from at least 5 real sources (Garmin, Strava export, Komoot, AllTrails, hand-made) import correctly; malformed files fail with a specific message and never crash.
- AC5: A 50k-point track imports without blocking UI for > 100 ms at a time, renders at interactive frame rate, and consumes bounded memory.
- AC6: Follow-trail shows remaining distance and raises an off-track alert within 10 s of exceeding the threshold, and clears when back on track.
- AC7: Stale target (member last heard > 5 min) is clearly labelled; the app never implies a live position.
- AC8: GPS loss during navigation shows last-fix-based info flagged stale and recovers automatically.

## Automated testing

- Unit/table tests for all `domain/nav` math and heading fusion (simulated sensor streams with noise).
- GPX fixtures corpus (valid, huge, no time, no ele, multiple segments, routes, waypoints-only, wrong namespace, BOM, malformed XML, XML bombs / entity expansion disabled).
- Property tests: simplification keeps endpoints and stays within tolerance; along-track distance is monotonic along the line.
- Performance tests in CI with synthetic 100k-point tracks (time budget on the JS side).
- Component: HUD states (acquiring, stale, arrived), trail list.
- Replay tests: recorded location/heading logs driving `NavigationService`.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| Walk 500 m to a known marker; compare distance/bearing with a second reference device | 2 per OS | AC1, AC2 |
| Follow a real GPX trail 2-5 km, deviate deliberately | 2 | AC6 |
| Airplane mode, no region installed | both | AC3 |
| Compass interference (near metal, car) and recalibration | both | prompt appears; recovers |
| Large GPX import and pan/zoom on oldest Android | 1 | AC5 |
| Navigate to a member who then goes out of range | 3 | AC7 |
| GPS drop in a building | 2 | AC8 |
| Battery with keep-awake + navigation 1 h | both | Record |

## Deliverables

- Straight-line navigation HUD and GPX import/visualisation/follow mode.
- `domain/nav` library with tests; GPX fixtures; performance numbers.
- Updated docs, `PROGRESS.md`, ADR on heading fusion if the design changes.

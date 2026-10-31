# Phase 6: Reliability, Synchronization and Production Hardening

## Scope

In:
- Background behaviour: iOS BLE background modes verified; Android foreground service types and (opt-in) background location sharing; Android mesh wake task (`registerMeshWakeTask`) decision; honest in-app state when backgrounded.
- Full reconnection and missed-event sync: SyncEngine v2 (catch-up summaries, convergence indicators, gap detection, health checks), outbox hardening, event dedupe at scale.
- Fault injection and chaos testing with `FakeMesh`, then field trials (A-03).
- Privacy and security audit (retention, logs, QR tokens, permissions, backups), data deletion, store compliance.
- Performance, battery and memory budgets; crash reporting that is **local-only** (exportable logs, no upload).
- Release engineering: CI for both SDK modes (local and npm), signing, store metadata, permission justifications, accessibility, localisation scaffolding, onboarding, crash-safe migrations.
- Licence compliance deliverables according to decision D-1 (source offer / NOTICEs / commercial agreement).

Out: new features (routing, terrain layers, GPX sharing over the mesh), unless recorded as backlog.

## Dependencies

Phases 1-5. Final decisions: D-1 (licence), hosting for maps. Larger device pool (>= 6 devices) and a real outdoor test site.

## Architecture considerations

- **Background:** platform-specific services behind `BackgroundPort`. iOS: bluetooth modes already required; location in background needs the background mode and Always/When-In-Use-with-indicator; justify in review notes. Android: combine `connectedDevice` (SDK) and `location` foreground service types; `ACCESS_BACKGROUND_LOCATION` flow; battery-optimisation exemption guidance; OEM kill lists.
- **Wake task:** SDK feature requires RN >= 0.76.5 with New Arch, durable inbound storage before `start()`, idempotency and prompt resolution (`SDK_INTEGRATION.md` §7). TrailMesh already persists in handlers; decide enable/disable by testing OEM kills.
- **Sync correctness:** convergence is defined as "for every member M and doc D, my projected state equals M's authoritative doc state as last received"; the UI shows per-member freshness rather than a global "synced".
- **Backpressure:** cap pending ops and flush rate; drop-oldest for Live, never for State.
- **Data safety:** DB integrity check at start, backup/restore of migrations, safe-mode on failure (read-only with export).
- **Observability without a backend:** local ring-buffer logs, exportable diagnostics bundle with redaction.
- **Supply chain:** pin dependency versions, audit licences (GPL/AGPL implications of each), SBOM.

## Implementation tasks

1. H-1 Background architecture and implementation for iOS/Android with feature flags; measurement harness for battery and wake behaviour.
2. H-2 SyncEngine v2 + convergence UI + catch-up summaries + gap diagnostics; handle `data_doc_size_warning`, `data_doc_unsyncable`, `native_event_gap`.
3. H-3 Fault-injection suite on `FakeMesh` (loss, duplication, reorder, partition, slow links, crash points between DB write and flush, clock skew, version skew).
4. H-4 Soak tests: 12 h mesh-on idle, 4 h walking; leak and growth monitoring (DB, docs, logs).
5. H-5 Privacy/security review: threat model update, QR token handling, log redaction audit, backup flags, screenshot/app-switcher privacy for location, permission copy, data deletion (`wipePersistedState`), reinstall identity behaviour (iOS Keychain persistence) handling.
6. H-6 Performance: startup, memory, map FPS, JS thread stalls, GPX; fix regressions.
7. H-7 Accessibility, localisation scaffolding, onboarding, empty/error states, field-use UX (gloves, sunlight themes, low-battery mode).
8. H-8 Release engineering: CI/CD, both SDK modes, signing, internal -> closed beta -> production tracks; store listings; privacy labels / data safety forms; export compliance review referencing SDK `EXPORT.md`.
9. H-9 Third-party notices screen (OSM/Protomaps attribution, dependency licences); no SDK licence work needed for the internal demo (D-1 closed).
10. H-10 Field trials F-1..F-3 (below) and fixes.
11. H-11 Switch default build to the published npm SDK once available (or document the pinned commit).

## Acceptance criteria

- AC1: Documented background behaviour per OS/OEM matrix, verified on devices; UI never claims live sharing when the OS has suspended it.
- AC2: Chaos suite: after any combination of loss/dup/reorder/partition for up to 4 h simulated, all online members converge (same meeting points, statuses, last-known positions) within the defined sync window after healing; no crashes; no unbounded growth.
- AC3: Kill the app at every crash point (after DB write before flush, mid-projection, mid-download): restart yields consistent data and no lost local edit.
- AC4: 12 h idle soak: no crash, memory growth < 20%, DB and doc sizes within budgets; battery within the budget recorded in B-1 (target <= ~6%/h foreground sharing, to be confirmed or revised with data).
- AC5: Field trial F-1 (6+ people, 3 h, real trail): >= 95% of members' last-known positions never older than their last in-range moment + sync window; join/leave works; no data loss.
- AC6: Privacy checklist passes (no coordinates in logs, no network calls except map download, backups exclude location data by default, deletion removes DB, files and SDK state).
- AC7: Both SDK modes (local and npm) build and pass CI.
- AC8: Store-review readiness: permission strings, background justification, privacy labels, licence artefacts per D-1.
- AC9: Accessibility basics (screen reader labels on core flows, dynamic type, contrast) pass an audit.

## Automated testing

- Chaos/fault-injection with seeded randomness (reproducible failures), run nightly; convergence invariant checks.
- Crash-point tests via injected failures in DB and lane layers.
- Migration matrix (every historical version to current).
- Static analysis: dependency licence audit, secret scan, network-call allow-list test, log-redaction test (fails on coordinate-like patterns at info level).
- Performance regression budgets in CI where feasible (JS-side microbenchmarks).
- E2E suite for core flows on emulators (with fake mesh) and on a device farm for non-BLE parts.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| F-1 Field trial: group walk on a real trail with signal dead zones | 6+ mixed | AC5; log issues |
| F-2 Event/festival-style dense crowd (20+ devices in 100 m) | 10-20 | No instability; forwarding counters healthy |
| F-3 Sparse linear trail (partitions) | 5-6 | Convergence after regrouping |
| Background/lock-screen matrix: iOS 16/17/18, Android 12/13/14/15, Samsung, Xiaomi, Pixel | 8 | Behaviour table |
| 12 h idle soak, 4 h active | 4 | AC4 |
| Cold install, reinstall (iOS Keychain identity persistence vs Android), delete-all-data | each OS | Documented behaviour |
| Airplane-mode full journey: install maps online, then go offline for a day | 4 | Everything core works |
| Low battery (<15%) behaviour | each OS | Sampling reduces; relay floor respected |

## Deliverables

- Release candidate builds for both stores (or internal tracks), with CI in both SDK modes.
- Background/OEM behaviour matrix, battery and performance report, field trial reports.
- Privacy and security review, threat model update, compliance artefacts (D-1).
- Final docs refresh (`ARCHITECTURE.md`, `MESH_PROTOCOL.md`, `SDK_INTEGRATION.md` assumptions all closed or explicitly carried), `PROGRESS.md` closed out, backlog (terrain layers, offline routing, GPX sharing, map sharing between devices).

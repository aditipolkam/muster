# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

Muster: a fully offline group navigation app (React Native) for hiking and outdoor events. Offline maps, GPS, meeting points, and live group positions shared over Bluetooth mesh using the Offline Protocol SDK. **No backend. No internet needed for core features.**

Status: architecture and plan complete (Phase 0). See `docs/PROGRESS.md` for what exists. **Do not start a phase unless asked.**

## Workspace

```
workspace/
  offline-protocol-sdk/   existing SDK. READ-ONLY. Never edit, commit to, or reformat it
  trailmesh/              this app
```

- The SDK is consumed as the **published npm package `@offline-protocol/mesh-sdk`**, pinned exactly (ADR 0012), never copied into this repo. It is pinned to `0.32.0`, which lacks the session-probe back-off fix; move to the first release that has it. In npm mode `node_modules/@offline-protocol/mesh-sdk` must be a real directory, not a symlink. Switch with `scripts/sdk-source.sh` only. See `docs/SDK_INTEGRATION.md` §2.
- Building SDK natives writes artifacts into the SDK tree. That is allowed; editing SDK source is not. Check `git status` in the SDK before and after.
- Only `src/mesh/sdk.ts` may import `@offline-protocol/mesh-sdk`. Everything else uses `MeshPort`. This keeps the local->npm switch a config change (`scripts/sdk-source.sh`).

## Read before changing behaviour

| Area | Read first |
|---|---|
| What the SDK does and does not do; guarantees; limits | `docs/SDK_INTEGRATION.md` |
| Layers, state, privacy, battery, edge-case behaviour | `docs/ARCHITECTURE.md` |
| Maps, tiles, GPS, GPX, licences | `docs/MAP_ARCHITECTURE.md` |
| Topics, lanes, envelopes, versioning, join flow | `docs/MESH_PROTOCOL.md` |
| SQLite schema, projections, retention | `docs/DATA_MODELS.md` |
| Scope and acceptance of the current phase | `docs/phases/PHASE_n.md` |
| Adventures, checkpoints, badges, celebration | `docs/GAMIFICATION_ARCHITECTURE.md`, `docs/MESH_PROTOCOL.md` section 10 |

## Rules that are easy to break

1. **Do not invent SDK APIs.** Every SDK call must be traceable to `bindings/react-native/src/index.ts` or the SDK docs. If unsure, read the source, then record the finding in `SDK_INTEGRATION.md`.
2. **State is canonical, events are hints.** Never make correctness depend on a group message arriving.
3. **Single writer per replicated key.** A member writes only its own `m.<addr>` document. Never write another member's doc. Never split lat/lon into separate keys.
4. **Persist in the handler.** The SDK ACKs before it emits `message_received`; persist inbound data keyed by id before doing anything else. Handlers are idempotent.
5. **SDK lifecycle:** register listeners before `start()`; call `DataStore.setInterest` before `start()` every launch; feed `setBatteryState`; never reuse a destroyed instance; reconcile `getState()` on foreground.
6. **No network in core paths.** No fetch in navigation, location, mesh, or storage code, and none in app code that renders the map. Only code under `features/maps-manager` (`MapPackManager`, `RegionExtractor`, `PlaceSearch`) may use the network, and only on user action. One owner-approved exception (development/testing): while no downloaded region covers the view, MapLibre streams the planet PMTiles directly (`StyleBuilder` `onlineUri`), shown to the user as "Online map · not saved". Core features still work with no internet.
7. **Never use public OSM tile servers for offline tiles** (policy forbids bulk/offline download). Attribution "© OpenStreetMap contributors" must be visible on every map.
8. **Never log coordinates** at info level or above. Positions are redacted unless the debug flag is set.
9. **No telemetry.** Never call the SDK's `enableTelemetry`.
10. **Domain code is pure.** `src/domain` imports nothing from React Native, the SDK or features.
11. **Do not claim device behaviour that has not been tested.** Mark assumptions `[ASSUMPTION A-nn]` and close them in `PROGRESS.md` with evidence.
12. **Simulators cannot test BLE.** Use physical devices for any mesh claim.

## Commands (once Phase 1 scaffolding exists)

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run lint           # includes import-boundary rules
npm test               # jest
npm run ios | npm run android
scripts/sdk-source.sh local            # use ../offline-protocol-sdk/bindings/react-native
scripts/sdk-source.sh npm <version>    # use the published package
```

Building the SDK natives (heavy; check `df -h` first, run one repo at a time):

```bash
cd ../offline-protocol-sdk/bindings/react-native && npm install && npm run build:all
```

## Conventions

- TypeScript strict; `zod` for all external data; `Result<T, AppError>` at service boundaries.
- Commits: conventional commits, all lowercase, no Claude co-author trailer.
- Docs: update `docs/PROGRESS.md` at the end of every work session; keep decisions in `docs/adr/`.
- Prefer small, tested, pure functions for geo, merge and sampling logic; property-test the merge/projection rules.
- Do not open PRs unless asked.

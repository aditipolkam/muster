# Muster docs

## Design and architecture

These describe how Muster works and the rules the code follows.

| Doc | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, state, privacy, battery, edge cases |
| [MESH_PROTOCOL.md](MESH_PROTOCOL.md) | Topics, envelopes, versioning, join flow over the mesh |
| [SDK_INTEGRATION.md](SDK_INTEGRATION.md) | What the Offline Protocol SDK does and doesn't do, and how the app uses it |
| [MAP_ARCHITECTURE.md](MAP_ARCHITECTURE.md) | Offline maps, tiles, GPS, routing, licences |
| [DATA_MODELS.md](DATA_MODELS.md) | SQLite schema, projections, retention |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Design tokens and UI components |
| [GAMIFICATION_ARCHITECTURE.md](GAMIFICATION_ARCHITECTURE.md), [GAMIFICATION_FEATURES.md](GAMIFICATION_FEATURES.md) | Adventures, checkpoints, badges |
| [adr/](adr) | Architecture decision records, one per decision |
| [phases/](phases) | Scope and acceptance criteria for each build phase |

## Design notes and development logs

These are working notes kept while building the app. They record what was built, what was tested on which devices, and open assumptions (`[ASSUMPTION A-nn]`). They are kept for transparency. They are not user documentation, and some entries are out of date.

| Doc | What it is |
|---|---|
| [PROGRESS.md](PROGRESS.md) | Running log of work sessions and device testing |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | The original phased plan |
| [GAMIFICATION_PROGRESS.md](GAMIFICATION_PROGRESS.md), [GAMIFICATION_TEST_REPORT.md](GAMIFICATION_TEST_REPORT.md) | Log and test report for adventures |
| [MESH_VERIFICATION.md](MESH_VERIFICATION.md), [GROUPS_VERIFICATION.md](GROUPS_VERIFICATION.md) | On-device verification notes |
| [ux-audit.md](ux-audit.md) | A UX review of an earlier version |
| [screens/](screens) | Screenshots from design passes |

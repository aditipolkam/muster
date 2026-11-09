# ADR 0015: Offline walking routes from the downloaded map tiles (experiment)

Status: Experiment (2026-11-09, owner-approved), branch `experiment/offline-routing`. Supersedes the "offline routing deferred" line of ADR 0010 **for this experiment only**. Not verified in a simulator or on a device.

## Context

Navigation is a straight line (ADR 0010, `MAP_ARCHITECTURE.md` §10). The owner asked whether a walking route can be plotted offline. The downloaded Protomaps PMTiles already hold every path, track and road as lines in the `roads` layer up to z15, so a route can be tried with no new download, no server and no native module.

## Decision

- **`RouterPort`** (`src/domain/routing/router.ts`): `route(from, to) -> Route | failure`. Pure domain code, no React Native, no network.
- **Graph from tiles.** For the box round both ends (plus a margin of 35% of the distance, at least 600 m) the router reads the z15 tiles (z14 when the box would need more than 600 tiles, or the region stops at z14) straight from the local PMTiles file, decodes the `roads` layer (own minimal MVT decoder, `mvt.ts`), and builds an undirected graph (`graph.ts`):
  - each line is clipped to its own tile square, so the buffer copy in the next tile is dropped;
  - vertices on the same 1/16 pixel become one node;
  - line ends left dangling are joined to the nearest node within 4 m, which joins lines across tile edges;
  - walking cost per metre: paths and tracks 1, steps 1.3, quiet roads 1.15, service/other 1.2, big roads 1.8, trunk roads 2.5; motorways, ferries and `access=private|no` are never used.
- **Ends join the same connected piece** (`snapEnds`): within 250 m of each end, the pair of nodes in one connected component with the smallest total gap. The gap is walked as a straight line and included in the distance.
- **A\*** with a straight-line heuristic (admissible: every cost factor is at least 1), capped at 500,000 expansions.
- **App adapter** (`features/map/trailRouter.ts`): picks the installed region that holds both ends (most detail first) and reads it with `FilePort.readRange`; `useTrailRoute` finds the route when navigation starts and again when you are more than 60 m off it (at most every 30 s), and tracks distance left along it.
- **UI.** A route is a solid orange line (meeting-point orange, white casing) and the chip reads "Via trail · X km". The big number is the distance left along the route, the arrow points at the route about 40 m ahead, and the ETA uses walking pace on that distance. If there is no route (no map, too far, more than 250 m from any path, not connected, error), the dashed straight line and "Straight line, not a trail route" stay. While it is being looked for: "Looking for a trail route…".

## Consequences

- Works only inside a downloaded region that holds both ends, up to 15 km apart.
- No elevation: times are still flat-ground estimates; no difficulty or exposure warnings.
- Tile lines are simplified per zoom and carry few tags (no `sac_scale`, no surface or width), so route choice is cruder than a real router. Where OSM has gaps, routes can detour or fail.
- The graph is built on the JS thread. Node measurements are in `PROGRESS.md`. Hermes has no JIT and will be slower; not measured.
- The compass view still points straight at the target.
- If the experiment is kept, the better long-term source is a compact per-area walking graph built from OSM by `tools/region-builder` (option 1 in the owner's discussion), behind the same `RouterPort`.

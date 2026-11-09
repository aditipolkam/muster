# Adventures and achievements: progress

Last updated: 2026-11-02

**Status: implemented, NOT accepted.** Code, automated tests, lint and typecheck are done. **Nothing has been run on a physical device**, no simulator screenshots were taken, and no UI automation was possible, so no screen has been looked at in a real renderer. The mesh behaviour is proven against `FakeMesh` only. See `GAMIFICATION_TEST_REPORT.md`.

## Stages

| Stage | Scope | State |
|---|---|---|
| 1. Foundation | Domain model, migration 4, `AdventuresRepo`, lifecycle, creation, local persistence, Adventures list / editor / details | Done, tested |
| 2. Checkpoints | Checkpoint CRUD, map layers and long-press add, arrival detection (radius, accuracy, dwell), manual confirmation, progress, route and distance | Done, tested |
| 3. Achievements | 13 definitions, pure evaluator, engine, unlock storage, collection screen, reveal / pulse / progress animation with reduced motion | Done, tested |
| 4. Group adventures | `adv` channel, authorization, merge rules, participation, relayed arrivals, "everyone reached", timeline, reconnection sync, orphan handling | Done, tested against `FakeMesh` |
| 5. History | Recap, journal, route sketch, "view on map", notes, delete | Done, tested |
| 6. QA | UI consistency pass, mutation checks, edge cases, regression of all earlier suites, docs | Done for what can be done without a device; see "Remaining" |

## Numbers

468 tests pass (343 before, 125 new in four suites: `adventuresDomain` 46, `adventuresService` 27, `adventuresMesh` 26, `adventuresScreens` 26). `tsc --noEmit` clean. ESLint: 0 errors (11 pre-existing warnings). Two older tests that hard-coded the schema version were changed to read `LATEST_VERSION`; no other existing test or behaviour was altered. The SDK repository was not touched.

## Decisions taken (and why)

| ID | Decision | Reason |
|---|---|---|
| AD-1 | One additive `adv` channel on the existing group service, several keys | No new service; one follow per group per direction (SDK limit of 16 per subscriber). ADR 0009 |
| AD-2 | Organizer is the only writer of shared adventure state; members write their own arrivals; organizer relays | Same single-writer rule as meeting points; one place to refuse forgeries |
| AD-3 | Time is stored as closed segments plus `resumedAt`, not ticked | Survives a kill with no timer or background task |
| AD-4 | Arrival = good fix inside the radius on two readings >= 3 s apart; weak fix never marks; manual always possible | False arrivals are worse than a button press |
| AD-5 | "Qualifying" adventure (a checkpoint reached, or 20 min and 300 m) | Start-then-finish must not earn badges; distance is a gate, never a reward |
| AD-6 | Badges are computed from local facts and labelled as not independently verified | Brief section 12 |
| AD-7 | "No network used" = Muster made no request and did not stream the online map | The app cannot know whether the phone had signal; the copy says so |
| AD-8 | Solo adventures use the fixed address `local` | Valid whether or not the mesh ever started |
| AD-9 | A group adventure whose group has ended is closed locally | Otherwise a member's clock would run forever |
| AD-10 | Checkpoint "icon" is its kind, from the existing glyph set | One consistent icon style; the icon-family decision stays open |
| AD-11 | Members cannot create or edit group adventures | Avoids a two-owner conflict story; they can plan their own |

## Assumptions (all unverified until a device test closes them)

| ID | Assumption | Test |
|---|---|---|
| A-26 | The SDK accepts service keys of the form `a-<ULID>`, `c-`, `r-`, `p-`, `m-`, `sync` (charset `A-Za-z0-9_-`, existing keys already use it) | D3 |
| A-27 | A follower receives the provider's updates for keys it wrote itself (the organizer's relay of a member's own arrival comes back to that member); this is the only "organizer has it" confirmation | D3 |
| A-28 | The accuracy limit (`max(radius, 20)`), two readings 3 s apart, the 15 m/s jump filter and the 8 m step suit real GPS on both OSes | D1, D2 |
| A-29 | `AccessibilityInfo.isReduceMotionEnabled` and its change event are reliable on iOS and Android | D8 |
| A-30 | MapLibre RN 11.5.1 evaluates `['case', ['==', ['get','id'], <string>], ...]` for `circle-radius` and `circle-opacity`, and draws a `line` layer over PMTiles; only a mocked map was exercised | D4 |

## Known limitations

1. **Foreground only.** Location is read only while the app is open (CLAUDE.md, AD-8 of the architecture). Arrival detection and the route stop when the phone is locked or the app is backgrounded; the clock does not stop. The route can show a straight segment across such a gap, and an arrival made while locked is detected when the app comes back and you are still inside the radius, or by manual confirmation. This is the largest gap between this feature and a trail app people expect.
2. Arrivals cannot be undone. A mistaken manual confirmation stays (it can be removed only by deleting the adventure).
3. The starting location can be set from the current GPS fix or from a saved place, not by dropping a pin; checkpoints can be placed from the map.
4. Members cannot propose checkpoints to a group adventure, and an invitation goes to the whole group (no subset).
5. A member's clock opens when their phone learns the adventure is active, not when the organizer started it. Late news shortens their time, never lengthens it.
6. Only one solo adventure may run at a time.
7. Notices ("Sam reached the falls") live in memory and are not kept across restarts; the timeline, which is built from stored state, is.
8. "Rally Point" for a member rests on having received the point and acknowledged it locally; delivery of the acknowledgment to the organizer is not required, and not claimed.
9. Banners are announced to screen readers as alerts. That may be chatty on a busy group adventure; not tuned.
10. No local notification or haptic: arrival feedback appears only while the app is open.
11. Route sketch is drawn from plain views (about 150 segments); a very long route is thinned.
12. Performance figures in the test report are from Node SQLite and say nothing about a phone.

## Remaining manual verification

The device checklist is in `GAMIFICATION_TEST_REPORT.md` (D1 to D12). Nothing there has been run.

## Log

| Date | Entry |
|---|---|
| 2026-11-02 | Stages 1 to 6 implemented. Migration 4, `adv` channel, 13 achievements, screens, map overlay, docs. 125 new tests, all earlier tests unchanged and passing. Not accepted: no device verification |

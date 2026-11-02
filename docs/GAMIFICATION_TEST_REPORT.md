# Adventures and achievements: test report

Date: 2026-11-02. Environment: Node (Jest 29, `@testing-library/react-native`), in-memory radio (`FakeMesh`), Node SQLite. **No simulator, no emulator, no physical device, no Bluetooth, no real GPS.** Everything below proves application logic; nothing here is evidence of device behaviour.

## Results

| Check | Result |
|---|---|
| `npm test` | 27 suites, **468 tests, all pass** (343 existed before; 125 new) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors; 11 warnings, all in files this work did not write (`no-bitwise` in `pmtilesDir.ts`, `consistent-this` in `FakeSdk.ts`, `no-shadow` in `components.test.tsx`) |
| Prettier | all of `src` and `__tests__` conforming |
| SDK repository | `git status` empty before and after; nothing in it was edited |
| Existing suites | all unchanged and passing. Two assertions that hard-coded schema version `3` (`groupsPersistence`, `components`) now read `LATEST_VERSION` |

New suites: `adventuresDomain` (46), `adventuresService` (27), `adventuresMesh` (26), `adventuresScreens` (26).

## Coverage of the brief's test list (section 14)

| Required | Where | What is asserted |
|---|---|---|
| Adventure state transitions | `adventuresDomain` lifecycle; `adventuresService` lifecycle | Every legal move, every illegal one refused, cancel separate from complete, final states final, one solo adventure at a time, delete only when planned or final, time excludes pauses |
| Checkpoint arrival calculations | `adventuresDomain` arrival; `adventuresService` arrival | Inside / approaching / far, radius clamp and configurability, two readings >= 3 s apart, a spike never counts, streak resets, hint shown on approach, confirmed arrival stored once, no detection while paused |
| GPS accuracy handling | same | Weak fix never inside (even on top of the target), weak fix far away is far, stale / missing / non-finite / future fix says nothing, drift while standing records nothing, jumps and weak fixes dropped, new leg after pause does not join the gap |
| Achievement unlock conditions | `adventuresDomain` achievements; `adventuresService` achievements; `adventuresMesh` | Each of the 13 badges from the facts that earn it and the facts that do not (non-qualifying, cancelled, solo "expedition", same-weekend, weekday, wrong group, network used, too short, no saved maps); unlock stored once with a timestamp; badge survives deleting the adventure; Mesh Connected needs a *received* message, not a publish; Rally Point needs another member's acknowledgment |
| Duplicate event processing | `adventuresMesh` | Every update delivered twice: one row, one notice; replayed arrival under a new envelope id: unchanged; earliest report of an arrival wins; merge outcome identical over all 120 orders of a five-step history |
| Reconnection synchronization | `adventuresMesh` | Member away through a pause, a new checkpoint and an arrival converges on return; arrival made out of range is sent and confirmed when the organizer follows again; messages dropped by the radio are repaired by sync plus the retry; checkpoint arriving before its adventure; restart keeps joined state |
| Group membership authorization | `adventuresDomain` authorization; `adventuresMesh` authorization | Members cannot publish adventure state, checkpoints or lifecycle; cannot report an arrival for someone else; unknown checkpoint, planned or cancelled adventure refused; removed and non-members ignored; older, equal or illegal header ignored, a completed adventure stays completed; forged author, wrong group, wrong role |
| Adventure statistics | `adventuresDomain` progress; `adventuresService` distance; `adventuresScreens` summary | Individual versus group progress, removed checkpoints ignored, a participant who left does not hold back "everyone", distance sums real steps, none while paused, recap shows "Not recorded" and no route when nothing was recorded, "Time moving" excludes pauses |
| Local persistence | `adventuresService` restart | Running adventure, checkpoints, arrival, route points, distance, unlock and the running clock survive a real file-database restart; migration 4 keeps earlier data |
| App restart recovery | same, `adventuresMesh` | Clock continues from the stored segment; finishing after restart totals correctly; group state and participation intact |
| Reduced-motion support | `adventuresScreens` | With reduced motion no `Animated.timing` starts and the pulse has no animated ring; with full motion both animate; nothing animates until the platform has answered; `motionDuration` is 0 |
| Offline behavior | `noNetwork` (existing, passes), `adventuresService`, `adventuresScreens` | No new network code (lint rule and the existing source scan pass); every flow above runs with no HTTP client at all; coverage by installed regions decided locally; network use is *recorded*, never required |

Other behaviour covered: the worst-case header and checkpoint (4-byte characters everywhere) fit one 2 KB envelope; arrival payloads contain no `lat` / `lon`; a member cannot run or edit a group adventure; a group adventure is closed on a phone whose group ended (clock stops, record kept); the map draws checkpoints with reached state, shows the progress card, keeps the attribution, offers "Checkpoint: <name>" on long-press and still drops a plain marker when there is no adventure; a weak GPS fix near a checkpoint shows the hint and "I am here" works; the arrival radius is configurable and stored; group page entry; all 13 badges render with locked requirement and progress.

## Mutation checks (do the tests bite?)

Each change was made, the adventure suites were run, then the change was reverted (suites back to 120 of 120).

| Mutation | Tests that failed |
|---|---|
| Authorizer allows everything | 6 |
| Header merge accepts illegal transitions | 2 |
| GPS accuracy ignored in arrival detection | 3 |
| Latest instead of earliest arrival wins | 1 |

## Indicative performance (Node SQLite, **not a phone**)

20,000 route points: insert in one transaction 133 ms, load 35 ms, thin to 400 points under 1 ms, one extra `appendTrack` under 1 ms. The map redraws the route at most every 15 s from the thinned set. These numbers only show the queries are not accidentally quadratic.

## Defects found and fixed by the tests

1. The tracker did not notice a pause or resume that happened between two fixes and joined the two legs with a straight line (fixed: a new running segment starts a new leg).
2. A member's own arrival stayed "unconfirmed" forever because the organizer's relay of the same record was treated as a no-op (fixed in the repository: the same record arriving as confirmed marks it confirmed; same for participation).
3. A member's clock was clamped to zero when the organizer's clock lagged theirs (test used separate clocks per phone; the clamp is deliberate and now documented; the test uses one clock).
4. A group adventure would stay active forever on a phone whose group had ended (fixed: closed locally, clock stops).
5. Reduced motion could start one animation for a frame before the platform answered (fixed: nothing animates until the preference is known).

## Not tested (and so not claimed)

Bluetooth, two-hop delivery, real GPS accuracy, MapLibre rendering of the new layers (the map is mocked in Jest), the `case`/`get` expressions for `circle-radius`, iOS and Android differences, dynamic type and small screens, dark mode, VoiceOver and TalkBack, haptics, background behaviour, battery, thermal state, key length and charset accepted by the SDK, and the echo of a relayed record back to its originator. All of these are in the checklist below.

## Remaining manual verification (physical devices)

Use real phones with mobile data and Wi-Fi off. At least one iPhone and one Android phone; D6 to D7 need three. Record results in the table at the end.

| # | Test | Steps | Pass when |
|---|---|---|---|
| D1 | Arrival detection | Plan an adventure with a checkpoint 100 m away; start; walk to it | "Approaching" at about 4 radii; "Reached" within the radius after a few seconds; not earlier; none when standing 60 m away for 5 minutes. Repeat between buildings or trees: a weak fix gives "Near ..., GPS too weak" and "I am here" works |
| D2 | Route and distance | Walk a known 1 km loop with the app open; stand still for 10 minutes | Distance within about 10% of 1 km; standing still adds no distance; route follows the loop; pause for lunch then resume leaves no straight line across the gap |
| D3 | Group sync | Phones A (organizer), B, C in one group. A plans with 3 checkpoints and starts; B and C join; B reaches a checkpoint | C shows "B reached ..." and the timeline line; B shows "The organizer has it" (this closes A-26 and A-27); everyone reaching one shows "Everyone has reached ..." |
| D4 | Map rendering | Active adventure with checkpoints and a recorded route | Checkpoint circles fill when reached, labels readable, route line over downloaded tiles, tap opens checkpoint, long-press offers "Checkpoint: ...", marker swell is brief (closes A-30). Online map streaming still works and the pill still shows |
| D5 | Airplane mode | Download a region; airplane mode; plan, run and finish an adventure for 35 minutes | Whole flow works; Local Explorer and Off the Grid unlock; repeat once opening the online map mid-way: Off the Grid does not unlock |
| D6 | Reconnection | B turns Bluetooth off for 10 minutes while A pauses, adds a checkpoint and resumes and C reaches a checkpoint; B turns it on | B converges without any action; time to converge recorded |
| D7 | Unauthorized | From a modified build, publish an arrival for another member, an adventure update as a member, and follow `adv` as a non-member | Rejected; no change on any phone; log shows reason without coordinates |
| D8 | Reduced motion | Turn on "Reduce Motion" (iOS) / "Remove animations" (Android); reach a checkpoint, earn a badge, finish an adventure | No pulse, no fade, no easing; everything still appears (closes A-29) |
| D9 | Accessibility and layout | Largest text size, smallest phone, dark mode, VoiceOver / TalkBack through list, details, checkpoint, recap, achievements | No clipped text or overlap with map controls; every control labelled; banners announced once, not repeatedly |
| D10 | Battery | One hour with screen on, mesh on, adventure running versus the same hour with no adventure | Difference small and recorded; no extra GPS watch in the OS location indicator |
| D11 | Backgrounding | Lock the phone for 10 minutes mid-adventure, unlock | Clock continued; route has a gap; arrival detected when back inside the radius; manual confirmation works (known limitation 1) |
| D12 | Restart | Kill the app mid-adventure on both OSes and relaunch | Same status, same elapsed time continuing, arrivals and route kept |

| Date | Device (model, OS) | Test | Result | Notes |
|---|---|---|---|---|

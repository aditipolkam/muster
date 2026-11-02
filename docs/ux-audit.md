# UX audit

Date: 2026-11-02. Source: reading the code on `feat/design-system-and-custom-map-areas`. **Nothing here was observed on a physical device**; findings are from code, not field use.

Persona: a tired hiker, one hand free, in sunlight, patchy signal, draining battery.

## What exists today (constraints on the brief)

| Brief assumes | Reality in the repo | Consequence |
|---|---|---|
| Live member positions on the map | **Not built** (Phase 4 not started, `PROGRESS.md`). Members are a roster only: name, role, state, `updatedAt` of the roster event. No per-member location is sent or stored | "Age of every location" and stale member markers have nothing to attach to. Only *mesh presence* (`Peer.lastSeenAt`) exists. Do not invent a position lane in a UX pass |
| Routing along trails | **Not built** (Phase 5). Navigation is a straight line | The honest label is "Straight line"; "Via trail" is not reachable yet |
| Notifications, haptics | No dependency (`expo-notifications`, `expo-haptics` absent) | Needs a new native module, manifest entries and a rebuild. Needs owner approval |
| Internet vs mesh | No connectivity library (no NetInfo) | The internet half of the pill needs a new native module. The core-path rule forbids probing with `fetch` |
| "Always" location / background updates | `expo-location` foreground only (ADR 0005) | The pre-trip item cannot claim background support that does not exist |
| Arrival broadcast | No such message kind. Closest is the meeting-point ack | New envelope kind = protocol change (`MESH_PROTOCOL.md`). Call out, do not slip in |
| "Meeting point moved 180 m" | DB keeps only the latest revision (`MeetingPointsRepo`) | Needs the previous position at the moment a newer revision is applied. Local data change only, no wire change |
| Quick status buttons ("On my way") | No such message kind | Protocol change |

## Per screen

### Map (`features/map/MapScreen.tsx`)
- Goal: see where I am, see the meeting point, get to it.
- Gaps:
  - Top pill shows GPS only. Mesh state is on other tabs; "Online map · not saved" is the only network hint. No place says how many group members are reachable.
  - Meeting point is a pin plus a bottom sheet that opens only on tap. A newly received point does not announce itself.
  - Sheet's primary button is *Acknowledge*, not *Navigate*. Navigation is a different tab and picks `live[0]` unless a param is passed.
  - Recenter button was silent without a fix (fixed 2026-11-02).
- Applies: P0 connectivity, P0 meeting point, P1 pre-trip card, P2 empty states.

### Navigate (`features/navigate/NavigateScreen.tsx`)
- Goal: which way, how far, how long.
- Good: states "Straight-line direction, not turn-by-turn" in small caption text; ETA at fixed 4 km/h; heading-relative arrow.
- Gaps:
  - The honesty caveat is the smallest text on the screen, below the fold. Should be a label next to the distance.
  - Pace fixed at 4 km/h, not configurable; no elevation, so no uphill adjustment (no elevation source exists offline yet).
  - Heading accuracy is not read; a wrong magnetometer gives a confident arrow. `expo-location` heading exposes `accuracy`, currently dropped in `watchHeading`.
  - Distance is `metric` hard-coded (`formatDistance`); no unit setting anywhere.
  - Compass is the screen itself, not a toggle. Acceptable: it is one screen, there is no separate "hunt".
- Applies: P0 navigation clarity, P1 compass, P2 units.

### Groups list / Group details / Meeting point (`features/groups/GroupsScreens.tsx`)
- Goal: who is here, are they near, what did the leader share.
- Gaps:
  - Member row shows a green "Connected" pill when `connected(addr)`; otherwise nothing, so "not in range" and "never seen" look the same. No "last heard" age.
  - Members are listed in roster order, not by reachability.
  - Header pill says "Mesh connected" whenever the mesh is *running*, even with zero peers. **This violates the brief's "never show green Connected with zero reachable peers".**
  - The updates feed exists (`buildFeed`) but only covers point shared/updated and joins/leaves; no tap-through to the map.
  - Join errors exist as banners; wording not audited against the brief's list.
- Applies: P0 connectivity honesty, P0 age, P1 joining, P2 feed.

### Join / create
- QR scanner and invite link exist (`QrScanner.tsx`). Not audited on device. Leader QR size/contrast not checked.

### Downloaded maps / Download (`features/maps-manager`, `features/map/AreaDownloadSheet.tsx`)
- Pause/resume, size, free-space guard exist. Per-region "covers my location" and date are not shown. Background survival of a download is **unverified** (Phase 1 report lists it as not tested).

### Onboarding (`features/onboarding/OnboardingScreen.tsx`)
- One screen, no permission prompts; says location is asked "later, when you open the map". Bluetooth / nearby / notification permissions are requested by other code paths with no in-context reason.

### Settings, More
- Permission card and storage exist. No units, pace, share-interval or outdoor-mode settings. Dark mode follows the system theme.

## State matrix

| State | Today | Verdict |
|---|---|---|
| No peers in range | Group pill still says "Mesh connected" | Wrong. Fix (P0) |
| No map for this area | Coverage banner + first-run banner | Present |
| Location denied / blocked / services off | Banner with action | Present; fixed tracking when OS misreports |
| GPS without fix | "Acquiring" chip | Present |
| Stale data | Not represented | Missing |
| Low battery | Battery state is fed to the SDK only | No user-facing behaviour |
| First launch | One splash screen | Partial |

## Plan

Implemented in this pass (each is local, pure-logic-first, no new native dependency, no protocol change):

1. Connectivity status model + map pill + honest group header (P0).
2. Presence age for members + ordering (P0, presence only; positions do not exist).
3. Meeting point card: Navigate as primary action, nav opens that point (P0).
4. Navigation clarity: visible "Straight line" label, configurable pace, units (P0 / P2).

Not implemented, with reason (needs a decision or new capability):

- Internet half of the pill, notifications, haptics, background/"always" location: new native modules and permissions. Needs approval.
- "Moved N m", arrival auto-broadcast, status buttons: need a local schema change or a new envelope kind.
- Live member marker staleness: no member positions exist (Phase 4).
- "Via trail" routing: Phase 5.
- Compass calibration prompt: needs heading accuracy plumbed from `expo-location`; small but device-dependent, so it is not guessed at here.
- Pre-trip checklist, onboarding permissions flow, outdoor mode, battery-aware share interval, feed tap-through: P1/P2, not started.

# ADR 0013: A group's trip map, sent in the welcome and locked once someone joins

Status: Accepted (2026-11-09). Logic covered by `__tests__/groupsTripMap.test.ts`, `groupsScreens` and `pickLocation`; not verified on devices.

## Context

People in a group almost always forget to download the map of where they are going. Nothing told them which area to fetch: meeting points arrive over Bluetooth, usually at the trailhead, where there is no internet to download anything. The organizer wanted every person who joins the group to learn, at that moment, which area to download.

The owner asked for this without a protocol change: no new message type, topic or sync step.

## Decision

- **The group has an optional trip map**: one area (`MapArea`: bounds, name, zoom 8 to 15), chosen by the organizer on the map (Group info, Trip map, Choose on map; the Map's pick mode with a 1 to 20 km square, starting at 10 km). It is named after the group and stored on the organizer's group row (`groups.trip_area`, migration 7).
- **It travels in the welcome**, the message the organizer already sends to a person it admits: `{g, name, o, mrev, rg?}`, where `rg` is the same `MapAreaWire` an activity uses (`{b: [w, s, e, n], n, z: [min, max]}`). The joiner stores it on its group row.
- **It is locked once someone else is in the group** (`canChangeTripArea`). People get the trip map only in their welcome, so a later change would never reach those already in. Locking keeps everyone on the same area without a new message. If everyone else leaves, the organizer can change it again.
- **An invalid `rg` never fails a join**: it is parsed apart from the welcome and dropped (`welcomeArea`). The same span and zoom limits as any area apply (at most 0.5 degrees on a side, zoom at most 16).
- **Members are nudged until they have it**: a card in Group info (Download, progress, "Downloaded · works offline"), a banner on the group page ("Download the trip map … Get it while you have internet") and a "Map not downloaded" badge in the groups list. Downloading is the existing area download (`planArea` / `startArea`), only on the person's tap (CLAUDE.md rule 6).
- `MapArea` and its helpers moved from `domain/adventures` to `domain/maps/mapArea.ts`, since groups are not part of the optional adventures mode (ADR 0010). The old paths re-export them. The download logic is one hook, `useAreaDownload`, used by both the trip map and an activity's map region.

## Consequences

- **Compatibility, both ways.** An older app ignores `rg` (its `WelcomeSchema` is a plain `z.object`, which drops unknown keys; tested). A newer app joining an older organizer gets no trip map and shows nothing.
- **The organizer must set it before inviting.** A new group's "Group created" banner says so, and the Trip map card sits above the tabs. A group whose first member joined before a trip map was set cannot get one.
- **Members who joined before this release** have no trip map for that group.
- The welcome grows by about 80 to 250 bytes, well within the 2 KB envelope (tested with a worst-case multi-byte name).
- The trip map is at most 20 km on a side, the limit of the map's region picker. A larger trip needs a later change (the 0.5 degree cap allows up to about 55 km near the equator, less towards the poles).
- Not verified: the round trip on two phones over Bluetooth, and the real size of an area (A-34, the size shown is an estimate).

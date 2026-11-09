# ADR 0014: Trail UI redesign: four tabs, compass inside navigation, strict colour roles

Status: Accepted (2026-11-09, owner-approved redesign). UI only. Covered by Jest; **not checked in a simulator or on a device**.

## Context

The owner approved a redesign of the whole app (warm ground, white bordered cards, soft-green secondary actions, one primary action per screen). TrailMesh is pub/sub: only the group leader publishes (meeting points, their location); followers subscribe. The old UI still had a follower **Acknowledge** button and a raised Map button in a five-tab bar with Compass as its own tab.

## Decision

- **Tokens in one file.** `src/ui/theme.tsx` holds every colour, radius, size, the type scale and the one floating shadow. Screens read `useTheme()`; no screen hard-codes a colour (exceptions: the white QR plate, which must be white to scan).
- **Colour roles are strict.** Green = actions, selection and "nearby". Orange (`meeting*`) = meeting points only. Blue (`self`) = you on the map only. Amber (`warning*`) = warnings only. Red (`danger*`) = destructive actions and errors only, always as a soft red button.
- **Four tabs**: Map (the app opens on it), Groups, Activity, Profile. The active tab is the icon in a 56x30 soft-green pill with a bold label. No raised centre button.
- **Compass is not a tab.** The `Navigate` route stays (deep links and params unchanged) but has no tab button. It is the second view of active navigation: a **Map | Compass** segmented control switches between the two. Both read one UI store, `runtime/navSession.ts` (destination, plus a `picking` flag), so the switch keeps the destination. Nothing in it is stored or sent.
- **The tab bar hides** while navigating and while placing a pin on the map.
- **Meeting points are an orange flag teardrop pin** with a white label chip (a MapLibre `Marker` with a React Native view; the GeoJSON source stays as the invisible tap target). The selected pin is larger. The navigation line is dashed orange.
- **Followers read only.** The UI no longer offers any follower-to-group action: the Acknowledge button is gone from the map sheet and the meeting point screen, and followers have no composer on the group page. The acknowledgment code in `GroupService` is untouched (no protocol change).
- **Fonts.** Manrope is the design font; until its files are bundled, `fontFamily` in the theme is `undefined` and the system font is used. Numbers use tabular figures.

## Consequences

- Tests that named the old copy or the `+` sheet were updated; the follower-acknowledge tests now check that the action is absent.
- Data the design shows but the app does not have was left out (see `PROGRESS.md`, "Trail UI redesign"): live leader location, "came into range" feed events, meeting times, compass accuracy, a map-layers switch and real mini-map tiles.
- A simulator or device check is still needed for the pin anchoring, the heading-up dial and the hidden tab bar.

# Muster Design System

> **2026-11-10, pill system.** Every interactive control is a full pill (`radius.pill`); cards, banners and menus use `radius.card` (24), sheets `radius.sheet` (32); nothing is square or slightly rounded. No shadows: surfaces separate by a 1px border or background contrast. Icons: SF Symbols on iOS via `expo-symbols`, Ionicons outlines elsewhere (`src/ui/glyphs.ts`), sizes from `iconSize`, never inside a tinted box. Detail screens use a centred title between two 44pt slots. Text fields use the shared `Input`.

> **Superseded in part, 2026-11-09 (trail redesign, ADR 0014).** The live tokens are in `src/ui/theme.tsx` and win over the tables below: ground `#F6F5F0`, surface `#FFFFFF`, ink `#15201A`, muted `#5B665F`, hairline `#E4E2DA`, primary `#1D5C3B` / soft `#E6EFE8` / dark text `#14432A`, meeting orange `#D9622B` / soft `#FCE9DF` / text `#8E3A12` / stroke `#C2531F`, you `#2563EB` with a 16% halo, warning `#FFF4DE` / `#6A4400` / `#7A4F00` / border `#F3E3C2`, danger soft `#FBE7E4` / `#A3261B`, success dot `#2E9E5B`, dark card `#15201A` / `#C9D3CC`. Radii: cards 20, buttons and inputs 14 to 16, chips 999, sheets 28. Type: titles 24 to 30/800, card titles 16 to 19/800, captions 12 to 13/600. Font Manrope (system font until bundled). Colour roles: orange only for meeting points, blue only for you, amber only for warnings, red only for destructive actions. Four tabs (Map, Groups, Activity, Profile); Compass lives inside navigation.

Version 1.0 · Reference: approved eight-screen Muster concept (onboarding, map, group, meeting point, compass, offline maps, updates, settings).

## 1. Design direction

Muster is a calm, trustworthy outdoor utility: **topographic landscapes, forest-green actions, warm off-white surfaces, and clear location status**. The map is the hero; controls should feel lightweight and immediately understandable. Prioritize legibility outdoors, offline confidence, and one obvious primary action per screen.

Principles:
- **Map first.** On map screens, use compact floating controls and a bottom group sheet; avoid large persistent headers.
- **Clarity over decoration.** Icons communicate a function; color communicates meaning.
- **Consistent hierarchy.** Same heading scale, icon treatment, buttons, paddings and cards across tabs.
- **Trustworthy state.** Distinguish offline availability, mesh connection, GPS availability, and stale peer locations.
- **Accessible in sunlight.** Keep text and controls high-contrast; don't rely on color alone.

## 2. Color tokens

The values below are implementation targets sampled conceptually from the mockup, not exact pixel samples. Define tokens centrally; do not use one-off hex colors in screens.

| Token | Hex | Usage |
|---|---|---|
| `brand.primary` | `#176438` | Primary buttons, selected tabs, main accents |
| `brand.primaryPressed` | `#104D2B` | Pressed primary actions |
| `brand.primarySoft` | `#E7F2E8` | Subtle green cards, icon surfaces |
| `brand.deep` | `#103F29` | Brand text and strong headings |
| `surface.base` | `#FAFAF7` | App background |
| `surface.card` | `#FFFFFF` | Sheets, cards, inputs |
| `surface.subtle` | `#F2F5EF` | Secondary buttons and grouped rows |
| `text.primary` | `#18231D` | Main text |
| `text.secondary` | `#66716B` | Supporting text |
| `text.muted` | `#87918A` | Metadata and disabled text |
| `border.default` | `#E2E8E1` | Dividers and input outlines |
| `status.connected` | `#248B43` | Confirmed connected / available |
| `status.warning` | `#B7771C` | Limited GPS, pending sync |
| `status.error` | `#BE4C45` | Failures, destructive actions |
| `map.self` | `#3989F5` | Own location and accuracy halo |
| `map.member` | `#236B42` | Group-member markers |
| `map.meeting` | `#9858CA` | Meeting point pin and icon |
| `map.trail` | `#2A9C9A` | Highlighted trail line |

Never use green to imply an internet connection. Prefer explicit labels such as `Offline · 4 nearby` and `Mesh connected`.

> Update 2026-11-03: icons are Ionicons (`@expo/vector-icons`) rather than Lucide, and the bottom bar has the Map as a raised centre button (ADR 0010, `PROGRESS.md`).

## 3. Typography

Use **Inter** where bundled/licensed; otherwise use the native system sans-serif consistently. Do not mix unrelated typefaces across tabs. Respect dynamic text sizing.

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Hero / onboarding | 30 | 700 | 36 |
| Screen title | 22 | 700 | 28 |
| Section title | 18 | 650/700 | 24 |
| Card title | 16 | 600 | 22 |
| Body | 15 | 400 | 22 |
| Button | 15 | 600 | 20 |
| Supporting | 13 | 400 | 18 |
| Caption / metadata | 12 | 400/500 | 16 |
| Navigation metric | 34 | 700 | 40 |

Use sentence case for UI copy. Prefer short, concrete labels: `Share meeting point`, `Download region`, `Location sharing on`.

## 4. Spacing, sizing and shape

- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40` dp.
- Screen horizontal gutter: **20 dp**; card-to-card gap: **12 dp**; section gap: **24 dp**.
- Minimum interactive target: **44 × 44 dp** (prefer 48 × 48).
- Primary button: **52 dp** tall, radius **14 dp**, horizontal padding **20 dp**.
- Secondary button: **48–52 dp** tall, radius **14 dp**, subtle fill or border.
- Text input: **52 dp** minimum height, radius **12 dp**, border 1 dp.
- Cards: radius **16 dp**, padding **16 dp**; large map sheets: radius **24 dp** at top corners.
- Pills / status chips: radius **999 dp**, vertical padding **8 dp**, horizontal **12 dp**.
- Icon-only map controls: **48 × 48 dp**, radius **14 dp** with white surface.
- Avatar: **36 dp** in lists; map peer marker **40–44 dp** including label treatment.
- Dividers: 1 dp `border.default`, inset to content when appropriate.
- Shadows: subtle only on floating map elements and sheets; prefer borders on standard cards.

## 5. Icons

Use one icon family throughout (Lucide or a single consistent outlined icon set). Standard sizes: **20 dp** inline, **24 dp** actions/navigation, **18 dp** compact metadata. Default stroke width: **2**.

Rules:
- No arbitrary circular border around some icons while others are bare.
- Use a soft-green rounded-square icon background **only** for feature rows or special actions; never randomly.
- Active bottom-tab icon and label use `brand.primary`; inactive use `text.secondary`.
- Reserve purple exclusively for meeting-point identity; blue for current GPS position.
- Do not rely on an icon alone when the action is unfamiliar.

## 6. Core components

### PrimaryButton
Solid `brand.primary`, white label, 52 dp height, 14 dp radius, optional leading icon. Disabled state uses muted surface and text; loading state preserves width and height.

### SecondaryButton
`surface.subtle` background with `text.primary` label. Same geometry as primary button.

### IconButton
48 × 48 dp; white surface on map; outline icon centered. Consistent radius and shadow across all map controls.

### StatusPill
White or near-white pill with a small colored dot, concise text, and optional count. Examples: `Offline · 4 nearby`, `GPS unavailable`, `Sync pending`.

### ListRow
Minimum 60 dp, leading 36 dp icon/avatar, title and one optional supporting line, trailing status or chevron, optional inset divider.

### BottomSheet
White, top radius 24 dp, safe-area aware, draggable when appropriate. Used for active group summary and meeting-point composition.

### MapMarker
- Self: blue circle, white stroke, translucent accuracy ring.
- Member: forest-green person/avatar marker with name label.
- Meeting point: purple flag pin with clear touch target.
- Stale member: subdued marker plus timestamp; never imply live presence.

### GroupCard
Leading group icon, group name, member count and connection state, trailing chevron. Tappable as a single 64–76 dp row.

### FormField
Label above input, helper/error below. Do not use placeholder as the only label. Use keyboard-aware layouts.

## 7. Navigation and screen templates

Bottom tabs: **Map · Group · Navigate · More**. Use the same tab bar height, icon size, text size, spacing and selected state on every main screen. Detail screens use a consistent top bar with back arrow, centered/left title according to one chosen convention, and optional trailing action.

**Onboarding:** brand mark, simple headline, scenic illustration, three concise benefits, single `Get started` CTA. Avoid unnecessary permission requests before users understand the feature.

**Map:** full-bleed topographic map, top-left connectivity pill, top-right layers/location controls, markers, lower group card, bottom navigation. The map should remain usable with no peers connected.

**Group:** landscape header image (optional), group name, member count, mesh status, segmented tabs (`Members`, `Updates`, `Meeting point`), member rows, single contextual CTA.

**Share meeting point:** map preview, place name, optional note, primary `Share with group` CTA. Show coordinates as secondary information.

**Navigate:** destination summary, large compass arrow, distance as primary metric, bearing and estimated walking time as supporting metrics. Label guidance as straight-line, not turn-by-turn.

**Offline maps:** storage usage bar, downloaded region rows, `Download new region` CTA, progress/cancel/retry states.

**Updates:** chronological activity feed with recognizable event icons and relative timestamps. Indicate queued/unsynced events.

**More:** grouped settings rows, location sharing toggle, downloaded maps, GPX trails, mesh diagnostics, settings and help.

## 8. Map visual style

Use a soft, natural topographic basemap: muted sage land, pale-blue water, subtle contour lines, legible trails and restrained road labels. Map styling must be packaged/downloadable for offline use. Avoid saturated terrain imagery that competes with markers.

Marker and trail contrast must remain sufficient across light and dark terrain. Provide a scale indicator and recenter control. Never assume downloaded map coverage exists outside the saved region.

## 9. Interaction and motion

- Press feedback: subtle opacity/scale, 100–160 ms.
- Sheet enter/exit: 220–300 ms, gentle easing.
- Marker updates: smooth transitions where reasonable, but do not animate stale data as live movement.
- Loading: skeletons for lists; determinate progress for map downloads.
- Respect reduced-motion settings.
- Never block critical navigation behind decorative animation.

## 10. States that every screen must handle

- Initial loading, empty, success, error, permission denied, and offline/mesh-disconnected states.
- Map not downloaded; GPS fix unavailable or low accuracy.
- Bluetooth off, no nearby peers, peer reconnecting.
- Location sharing off, last-known location stale.
- Message queued, sent, acknowledged (only if supported), failed.

Do not conflate `published locally` with `received by every group member`.

## 11. Accessibility

- Minimum 44 × 44 dp hit targets; use 48 dp for primary touch controls.
- Maintain WCAG AA contrast targets (4.5:1 normal text, 3:1 large text and meaningful UI boundaries).
- Support font scaling and screen readers with descriptive labels.
- Announce important connectivity and meeting-point changes without excessive interruptions.
- Use text/icons alongside status colors.
- Keep map actions usable one-handed and with gloves where feasible.

## 12. Implementation rules for Claude / contributors

1. Define all tokens in a centralized theme module (`src/theme/` or equivalent). Do not scatter raw values through screens.
2. Create shared `Button`, `IconButton`, `StatusPill`, `ListRow`, `Card`, `BottomSheet`, `ScreenHeader`, and `MapMarker` components.
3. All four main tabs must use the same layout, font scale, icon style and bottom navigation.
4. Reuse shared components before introducing a new variant.
5. Do not introduce new colors, radii, shadows, or font sizes without updating this file and the theme tokens.
6. Use safe-area insets and responsive layouts; test small screens and large text.
7. Screenshot-review every screen against the approved mockup, including empty/error states.
8. Treat this document as the visual source of truth. Where the mockup conflicts with accessibility or technical reality, preserve usability and document the deviation.

## 13. Visual QA checklist

- [ ] All screen headers use the same type scale and placement rules.
- [ ] All primary buttons match in height, radius, fill, font and icon spacing.
- [ ] Icons share one family, stroke weight and background convention.
- [ ] Cards use consistent padding, radius, border and shadow treatment.
- [ ] Main tabs share identical navigation geometry and typography.
- [ ] Map markers are visually distinct and correctly labeled.
- [ ] Offline, mesh, GPS and sync statuses are independently understandable.
- [ ] Text remains readable at accessibility sizes and in sunlight.
- [ ] No hard-coded style values duplicate existing tokens.
- [ ] iOS and Android screens are visually consistent without violating native interaction conventions.

## 14. Adventures, badges and celebration (added with Phase 7)

No new colour, radius, shadow or font size was introduced. Everything is built from existing tokens and shared components; the only new components are `BadgeMark`, `Reveal`, `PulseRing` and `AnimatedProgress` in `src/ui/`.

- **Navigation.** Superseded 2026-11-03 by five tabs (Compass, Activity, Map, Groups, Profile; ADR 0010). Adventures live in the Activity tab (`Activity > Adventures`, with Achievements and the journal inside), with three shortcuts: a compact progress card on the map while one is in progress, an Adventures card on the group page, and "Navigate here" on a checkpoint (the existing straight-line screen).
- **Map.** Checkpoints are white circles with a `brand.primary` outline that fill solid when reached by this person; the recorded route is a `map.trail` line. Purple stays reserved for meeting points and blue for the current position. The adventure card sits above the group card and never covers the status pills, the controls or the attribution (the controls and attribution move up to make room).
- **Badges.** `BadgeMark` draws mountains, pines, a tent, a compass, a trail, a flag, a mesh and a map from plain shapes in `brand.primary` on `brand.primarySoft`, one stroke weight and one palette. Locked badges use `text.muted` on `surface.subtle`. No gradients, no neon, no cartoon art. (The wider icon-family decision, Lucide with react-native-svg, is still open; badges do not depend on it.)
- **Copy.** Sentence case. Never "Hurry", "Fastest", "Streak", "Rank". Locked badges state exactly what unlocks them. Achievements always carry the note that they are recorded on the phone and not independently verified. Straight-line guidance keeps its label.
- **Celebration, by moment.**

| Moment | Treatment | Reduced motion |
|---|---|---|
| Arrival at a checkpoint | One-line banner (6 s), marker swells in three steps on the map, a soft ring on the checkpoint screen | Banner only |
| Progress changes | Bar eases over 320 ms | Jumps |
| Badge earned | One-line banner on the map; the badge fades and rises into the collection with a "New" marker | Appears in place |
| Adventure finished | The recap sections fade in one after another, 90 ms apart | Appears at once |

  Rules: nothing animates until the platform has said motion is allowed; nothing covers the position, GPS or mesh status; nothing large appears on the map or while navigating (large reveals live only on screens opened on purpose); all animation uses opacity and transform on the native driver except the short progress width.
- **States covered on each new screen:** loading (first frame is empty, no spinner flash), empty (adventures, journal), error (inline banner with the reason), no GPS (waiting text, manual path), permission denied (map banner unchanged), mesh off (group adventures show state as of last contact; solo ones are unaffected), paused, finished, cancelled, removed checkpoint.

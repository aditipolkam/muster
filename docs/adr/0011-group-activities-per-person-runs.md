# ADR 0011: Group activities with per-person runs

Status: Proposed (2026-11-03). Not implemented.

## Context

ADR 0009 made the organizer the owner of a group adventure's lifecycle: one shared `active`/`paused`/`completed` status drives every member's clock. The new product wants a draft the organizer edits privately, a publish that makes the activity live, with each member pressing Start on their own phone, a per-person timer, optional place verification per phase, and a downloadable map area bundled with the activity.

## Decision

- Reuse the `adv` channel and the organizer-as-single-writer star. Add a local-only `draft` status; publish is also start: `draft -> active` at `rev 1`.
- For activities, the header `active` means live. A member's start and finish are their own `participant` records (they write only their own key, relayed by the organizer). Pause is not offered; the organizer can cancel or close it.
- A published activity is immutable. A change is cancel plus a new publish. This removes the need to reconcile members' progress against edited phases.
- Phases may lack a location (`task`). `lat`/`lon` become optional, in pairs. Ordered or any-order is a flag on the activity header, enforced on the member and checked again at the organizer.
- The map area travels as a bounding box, name and zoom range on the header. Tiles are fetched by the member through `maps-manager` on a button press, so rule 6 still holds.
- Photos are local files, never in an envelope. The completion image is rendered on the device and contains no position.
- Group page cards derive from state, not from messages.

## Alternatives considered

- *Keep the organizer-driven shared clock and add per-person offsets*: simpler wire change, but members would have to wait for the organizer to start, which the product rejects.
- *Allow edits to published activities with a revision bump*: members already mid-run could lose or gain phases and the "ordered" rule becomes ambiguous. Rejected; cancel and republish is clear.
- *Send the region as a list of tile ids or a pre-built file*: far larger than the 2 KB envelope, or needs hosting. A box is about 60 bytes.
- *In-app camera now*: adds a permission and a native module for a feature the owner postponed.
- *Send photos over the mesh*: exceeds BLE budgets and breaks the rule that the journal stays on the device. Photos will go over the internet via chat.

## Consequences

- Wire format gains optional fields only; old builds drop the new participant states and optional fields unharmed but will not show place-less phases. There is still no `minAppVersion` gate (open since Phase 3).
- The organizer must enforce order for ordered activities; a modified client could still lie about its own arrivals, the same trust level as ADR 0009 and stated in the copy ("recorded on this phone").
- The large-area guard (0.5° per side) is a policy limit, adjustable.
- Needs one new native dependency for the photo picker and one for image capture. Pick them at implementation time; prefer Expo modules already compatible with SDK 54 (ADR 0001), and record the choice here. If capture proves unreliable (A-32), fall back to a precomposed image drawn with a canvas library.
- Assumptions A-31 to A-33 are open until device tests run.

## Update 2026-11-03: dependencies chosen

- Photo attach: `expo-image-picker ~17.0.10` (matches Expo SDK 54), behind `PhotoPort`. Installed with `--legacy-peer-deps` because the repo already has an unrelated peer conflict (`@babel/plugin-transform-export-namespace-from` 8 against `@babel/core` 7). Needs `pod install`; not built here.
- The completion image is still open: an image-capture library has not been chosen (A-32).
- The activity's map area is the union of the phases' own regions, not a separate organizer choice (section 12 of the phase document).

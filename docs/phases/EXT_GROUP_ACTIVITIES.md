# Extension: group activities

Status: **domain, data layer, service and all screens of the reference design done (2026-11-03); completion PNG and group cards not started. Nothing checked on a device.** Not accepted; nothing verified on a device. Extends Adventures (`GAMIFICATION_ARCHITECTURE.md`, `MESH_PROTOCOL.md` section 10, ADR 0009). Decisions: ADR 0011. Do not start until asked.

"Activity" is the product word for a group adventure; "phase" is the product word for a checkpoint. Code keeps the existing names (`Adventure`, `Checkpoint`) to avoid a rename; the UI says Activity and Phase.

## 1. Goal

The organizer builds an activity in private (draft), publishes it to one group, and each member runs it on their own phone with their own timer. Location phases are verified against the member's position; task phases are self-confirmed. Everything works offline once the map area is downloaded.

## 2. Product decisions (owner, 2026-11-03)

| # | Decision |
|---|---|
| 1 | A member who opens it late starts from phase 1 |
| 2 | The organizer chooses per activity: **ordered** (phase n unlocks after n-1) or **any order** |
| 3 | A published activity cannot be edited. To change it: cancel and publish a new one |
| 4 | Timer is **per person**: starts when that person opens the live activity and presses Start, stops when their last phase is done |
| 8 | **Publish means start**: publishing makes the activity live for the group at once |
| 5 | The map-area definition travels with the activity; tiles do not |
| 6 | Photos stay on the device. **Attach from library only**; no in-app camera in this extension |
| 7 | Photos reach other people only via the future chat, over the internet. Never over the mesh |

## 3. Scope

1. **Groups as the start screen**, with a list of groups that have something waiting (a live activity this person has not started, or one in progress) and a plus button for create or join.
2. **Draft** activities: organizer-only, local, editable, never replicated. **Publish is also Start**: it writes revision 1 to the group as `active`. There is no separate `planned` step for group activities.
3. **Phases** of type `place` (a searched, selected location) or `task` (text only, e.g. "collect a yellow flower"). A phase may be a place and also carry a task text. Location is optional.
4. **Verification**: a place phase completes when the fix is within the arrival radius (existing `arrival.ts`), with the existing manual confirm as fallback. Task phases complete on the person's confirmation.
5. **Optional photo per phase**, attached from the photo library, copied into app storage, local only.
6. **Map area**: attached automatically at publish as the padded bounds of all phase places (and the start), zoom 8 to 15. If the places are more than 0.5 degrees apart there is no area and no download button; the activity still publishes. A manual picker is a later option. Members get a one-tap "Download map area" on the activity details page.
7. **Completion image**: a trail-themed PNG generated on the device when the person finishes.
8. **History**: the existing journal lists finished activities, the image and the phase photos.
9. **Group page updates**: published, started (by whom), phase reached, finished, cancelled, shown as system cards. Members cannot type (chat is next).

## 4. Data and protocol changes

Additive only. Old builds ignore what they do not know (`PubSub` stores unknown types).

**Status.** Add `draft` before `active`. `draft` rows are never sent. Publish: `draft -> active` at `rev 1` (the existing `planned` status stays for solo adventures).

**`adventure` payload** gains: `act?: 1` (a group activity: per-person runs), `ord?: 1` (ordered), `rg?: { b: [w, s, e, n], n: string, z: [min, max] }` (map area: bounding box at 4 decimals, name, zoom range).

**`checkpoint` payload** changes: `lat` and `lon` become optional (both or neither); new `tx?: string` (task text, max 140). A phase is a place when `lat`/`lon` are present and a task when `tx` is present; either or both. A phase with neither a place nor a task text is invalid.

**Run state is per person.** The organizer's status says whether the activity is live; each person's clock is their own.
- Publish sets the header `active`. A member's **Start** (a button on the live activity) is a `participant` record (`state: joined`, same pub/sub key as today), relayed by the organizer. Joining stays opt-in.
- A member's **finish** is a new `participant` state `done`, relayed the same way.
- The organizer can `cancel` (stops everyone) and later `completed` (closes it for the record). `paused` is not offered for activities.
- Elapsed time is computed locally from the person's own start and end, shown to them, and in the group card as a plain fact ("Asha finished in 2 h 14 m"), never as a rank.

**Ordered rule.** Enforced on the member's device when completing (UI) and by the organizer on `reached` (drop and log if the previous phase has no arrival from that person). Any-order activities accept any phase.

**Map area (`rg`) validation.** Bounds are valid lat/lon, west < east, the area is at most 0.5° on a side (guard against a whole-country download), and the zoom range is within `MAX_REGION_ZOOM`. Reject otherwise.

**Limits** unchanged (20 phases, 12 members, 2 KB envelope). The worst-case 4-byte-character test is extended to the new fields.

**History and badges.** The shared status stays the organizer's. A person's own finish is stored locally as `progress.finishedAt` (never sent; a header from the organizer cannot change it). For that person the activity is *completed* in the journal, the recap and the badge facts, with their own duration, and stays so if the organizer cancels or closes it later. Someone who never finished gets nothing from a cancel. A finished participant still counts as taking part for "everyone reached" and the participant lists.

## 5. Downloading the map area

- The details page shows the area name, estimated size and a single button. It starts a normal region job through `maps-manager` using the area's bounds (extract from the planet PMTiles, as `RegionExtractor` does for user-drawn areas). Resumable, pausable, free-space guarded.
- This is user-initiated network use, allowed by CLAUDE.md rule 6. No other new network code.
- The button shows "Downloaded" when an installed region covers the whole `rg` box.
- If the area is already covered by an installed region, no download is offered.

## 6. Completion image

- Rendered from a React view on the phone to a PNG in app storage (needs an image-capture library; ADR 0011 covers the choice and the fallback).
- Content: activity name, group name, date, phase count, the person's elapsed time. **No map, route or coordinates.** A small stylised trail icon set, local assets only.
- Sharing is a system share sheet on user action. No upload.

## 7. Photos

- Library picker only. The file is copied into app storage under the phase id, with the original left alone. A thumbnail is generated for lists.
- Deleted with the activity record or on user request. Never added to any envelope.
- Permission: photo library, requested at first use, with an explanation. Denial leaves the feature off with no crash.

## 8. Group page cards

Rendered from adventure state (header, participants, arrivals), not from received messages, so a member who was out of range sees correct cards after reconnecting (CLAUDE.md rule 2). Cards are ordered by the event's own timestamp, capped at 200 per group.

## 9. Acceptance

1. Draft is invisible to members, survives restart, and becomes live only after Publish.
2. A published activity has no edit path; cancel works and shows on all members' pages.
3. Place phase completes inside the radius and not outside it; manual confirm works; task phase completes on confirm.
4. In an ordered activity phase n+1 is locked until n is done, on the device and at the organizer.
5. Two members start at different times; each timer is independent and survives an app kill.
6. A late joiner starts at phase 1.
7. The map-area download works in one tap, resumes after interruption, and shows Downloaded afterwards. Works offline once downloaded.
8. Photos attach, show in history, and appear in no stored or sent envelope (tested).
9. The completion PNG is produced offline and contains no coordinates.
10. Group cards agree with state after a reconnect.
11. Merge tests: header, phase and participant records applied in every order reach the same state (extend the existing property test).
12. **Device tests on two or more phones before any mesh claim** (rule 12). Until then the status stays "Implemented, NOT accepted".

## 10. Out of scope

Chat and sending photos (next phase; photos over the internet), editing a published activity, in-app camera, leaderboards or ranking, live positions (Phase 4), route sharing.

## 11. Open assumptions

| ID | Assumption | Closes with |
|---|---|---|
| A-31 | A photo-library picker works without a camera permission on both OSes | iOS and Android device run |
| A-32 | A view-to-PNG capture renders custom fonts and local images identically on both OSes | Device run |
| A-33 | A 0.5° area at the allowed zoom extracts in a reasonable size and time from the planet source | Real extract and size measure |

## 12. Reference design (2026-11-03)

`Muster Checkpoint and Activity Flow.png` is the reference for flow and component placement. It adds, beyond sections 1 to 11:

- **Phase types:** Location Checkpoint, Collect Item, Take a Photo, Custom Task (`type`, wire `ty`). Only a location checkpoint needs a place.
- **Per phase:** completion radius 15 to 150 m (wire `rd`; unset uses the person's own setting), Require Photo (wire `rp`; a photo phase always requires one), and a map region chosen on the map (organizer's draft only, never sent per phase).
- **Publish:** the activity's one map area is the union of its phases' regions. Publishing is refused if the union is wider than 0.5 degrees.
- **Only a plain location checkpoint (no photo rule) completes by itself near its place.** Others are completed by the person, who gets a hint when close.
- **Person's own note and photo per phase** are stored on the phone only (`phase_records`).
- **Region size** shown on the organizer's screens is an estimate (A-34); the exact size is shown when a download starts.
- **Select Location** is a mode of the Map tab, so it reuses the map, the offline style and place search.
- **Participant side (built):** overview with one-tap Download Map Region, in-progress page (timer, participants, Progress / Updates, phase timeline), phase page (photo, location status, note, Mark as Complete), Activity Completed, Activity History.
- **Photos:** `expo-image-picker` through `PhotoPort` (`platform/`), copied into the app's documents folder, never sent. Requires `pod install` on iOS.
- **Still open from section 6/8:** the completion PNG and the group-page cards.

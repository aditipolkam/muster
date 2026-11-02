# ADR 0009: Adventures on the existing group service

Status: Accepted (Phase 7, 2026-11-02). Not yet verified on devices.

## Context

The adventure brief asks for shared checkpoint progress, arrival acknowledgments, a shared timeline, reconnection sync, event deduplication and authorization, through the existing pub/sub layer, without a new networking layer and without breaking the mesh protocol contracts.

## Decision

- Reuse service `tm.group.1` and the star around the organizer (ADR 0007). Add **one** channel, `adv`, per direction, with several keys on it (header, checkpoint, arrival, participation, milestone, sync), instead of one channel per record type. Subscription budget matters: the SDK allows 16 follows per subscriber and each channel costs one per group.
- The organizer is the single writer of shared adventure state; members write only their own arrivals and participation; the organizer relays them. A relay is an attestation, and its return to the originator is the originator's confirmation.
- Lifecycle belongs to the organizer for group adventures. Each person's own clock, distance and route are derived locally from the shared status and their own participation, and are never published.
- Merge is by revision (header, checkpoint), earliest report (arrival, grow-only) or per-participant sequence (participation), with a transition check on the header so a higher revision cannot reopen a finished adventure.
- Arrivals carry no position. Joining is opt-in.
- Achievements are computed from local records only; definitions are code, unlocks are rows; copy never calls them verified.

## Alternatives considered

- *A separate service or topic family (`tm.adv.1`)*: cleaner separation, but doubles registration, policy and subscription handling and adds a second place to get authorization wrong.
- *Every member publishes to every member*: breaks the star, multiplies subscriptions (12 members would exceed the per-subscriber limit), and loses the single place that can refuse a forged arrival.
- *Members create group adventures too*: needs a conflict story for two owners; deferred. Members can plan solo adventures.
- *Per-checkpoint channels*: n subscriptions per adventure. Rejected for the same budget reason.
- *Using the system clock to tick an elapsed timer*: needs a background task and drifts on restart. Rejected for stored segments.

## Consequences

- The organizer remains a single point of failure for shared changes; members keep the last state and their own records. Same trade-off as ADR 0007.
- A member in four or more groups with the same organizer reaches the 16-follow limit. Unlikely for this product; documented.
- Old builds refuse the `adv` subscription and are unaffected; they simply cannot take part in adventures. No `minAppVersion` gate exists yet (still open from Phase 3).
- Assumptions A-26 to A-30 (see `GAMIFICATION_PROGRESS.md`) are unverified until the device tests in `GAMIFICATION_TEST_REPORT.md` are run.

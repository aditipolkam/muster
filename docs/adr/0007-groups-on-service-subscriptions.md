# ADR 0007: Groups and meeting points on service subscriptions

Status: Accepted (Phase 3, 2026-11-01). Not yet verified on devices. The join step is amended by ADR 0012: the SDK admits a valid join subscription at once and the organizer's approval is the welcome, not the SDK accept.

## Context

PHASE_3.md planned groups on SDK MLS groups, `DataStore` documents (`ReplicatedDocs`) and group messages. The Phase 3 brief instead says to use the existing mesh communication layer (the Phase 2 `PubSub`), to define group topics, not to assume wildcards, retained messages or replay, and to make sure unauthorized peers cannot publish accepted group updates. The SDK has no group-scoped topics (SDK_INTEGRATION.md section 4); a topic belongs to one provider's service.

## Decision

- One service per device, `tm.group.1`; the group id is the scope inside the topic (MESH_PROTOCOL.md 2.3).
- A star around the organizer: members follow the organizer, the organizer follows each member. The organizer is the only writer of roster and meeting points, so no CRDT, no LWW and no per-key writer rule are needed; the documented `rev` plus author tie-break is kept for ordering.
- Authorization is local: the organizer address recorded at create/join time, and the roster, decide what is accepted (and who may follow). The SDK `provider` is the only trusted identity.
- Joining rides on the subscription handshake: the join token is part of the topic the joiner subscribes to; the organizer's accept/reject is the approval.
- State is persisted in SQLite and re-published by the provider when a follower becomes active; `sync_request` is a member-initiated fallback. Nothing depends on SDK snapshots or replay.
- A second `PubSub` instance, filtered by service id, keeps groups apart from the diagnostics service. `PubSub` gained `owns`, `onRequest` and `onSubscriptionEvent` (additive; Phase 2 behaviour and tests unchanged).

## Consequences

- Works with the SDK as it is; no SDK change. DataStore/MLS-group assumptions A-05, A-06, A-07 are not exercised in Phase 3 and stay open for later.
- Members cannot see each other's acknowledgments (only the organizer does) and the organizer is a single point of failure for new meeting points: if it is out of range, members keep the last state but get no updates. This is accepted for the demo and noted in the device tests.
- Members are not cryptographically separated from each other beyond the 1:1 sessions: a modified client could still lie to the organizer in its own hello/ack, but cannot publish accepted group state.
- Revisit DataStore (state lane) if Phase 4 or 6 field tests show the star is too fragile when the organizer is out of range.

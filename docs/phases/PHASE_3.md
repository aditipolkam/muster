# Phase 3: Groups and Meeting Point Sharing

## Scope

In:
- Group create, join (QR + connection request), leave, rename, roles (admin / promote co-admin), member list.
- State lane: `ReplicatedDocs` over `DataStore`; member documents, group document, projectors to SQLite.
- Meeting points / waypoints shared via lat/lon with multi-author edit rules (`MESH_PROTOCOL.md` §3.3).
- Event lane (basic): `point` change nudges, `joined`/`left`.
- `MeshBus` v1 mapping logical topics to lanes.
- Migration of Phase 1 `local_points` into the group-aware `meeting_points` model (personal waypoints stay local).
- Version gating (`minAppVersion`, `protocolV`).

Out: live positions, status/arrival (Phase 4), GPX.

## Dependencies

Phase 1 (map, DB), Phase 2 (mesh adapter). Decision D-5 (group size). (D-1 licence is closed: company-owned SDK, internal demo.)

## Architecture considerations

- Single-writer docs: write only `m.<myAddr>` and (if admin) `group`.
- Winner rule, tombstones and Lamport `rev` implemented as pure functions in `src/domain/merge` with property tests.
- `setInterest` before `start()` on every launch; docs flushed with throttling.
- Persist-in-handler for events; projectors idempotent; roster-gated.
- Join tokens: random 128-bit, hash stored in the group doc, expiry; consent UI on both sides.
- Treat SDK facts as unverified until tests: A-05 (invite over BLE only), A-06 (doc id limits), A-07 (group replication without relay).
- Fallback if address-based doc ids are rejected (A-06): `m.<short hash of address>` with a roster lookup table.
- Fallback if group DataStore replication proves unreliable over BLE (A-07): reduce to 1:1 spaces per pair is **not** acceptable at scale; instead escalate: use Event lane to carry full member-doc snapshots on join/reconnect (small docs) and record an ADR.

## Implementation tasks

1. P3-1 Domain: models + zod schemas for member doc, group doc, point version, envelope; merge/projection pure functions + property tests (order independence, idempotence, monotonicity).
2. P3-2 DB migrations: groups, group_members, meeting_points, point_versions, events, outbox_ops; migrate `local_points`.
3. P3-3 Group creation (`meshCreateGroup`), invite (`meshInviteToGroup`), join flow from `MESH_PROTOCOL.md` §6 incl. QR render/scan (camera permission), approvals, error states. Record the exact joiner event sequence (A-05).
4. P3-4 `ReplicatedDocs` adapter: create docs, `setInterest`, `mapSet/mapGet/docJson`, `flush` throttle, `data_changed` handling. Verify doc id constraints (A-06).
5. P3-5 Verify group-space replication over BLE-only without internet between >= 3 devices (A-07); measure convergence time for a point add.
6. P3-6 Projectors + SyncEngine v1 (project on `data_changed`, on start, on `neighbor_discovered`).
7. P3-7 Meeting point UI: create at map centre/long-press/current location, edit, move, delete (tombstone), list, details sheet, "navigate to" stub for Phase 5, edited-by label.
8. P3-8 Event lane basic + notifications (local notification when a point changes while the app is open; background notifications deferred to Phase 6).
9. P3-9 Roles and membership UI; leave group (local purge options); remove member (admin).
10. P3-10 Version gate and incompatible-member warning; roster gating of docs.
11. P3-11 Evaluate `enforceAdminCommits` (SDK config) for the trusted-group model; ADR.

## Acceptance criteria

- AC1: Admin creates a group, 3 joiners join in person via QR in < 60 s each; roster is identical on all devices (compare `memberIds`).
- AC2: A meeting point created on any device appears on all connected members' maps within 10 s (direct link) and within 60 s over a 2-hop path.
- AC3: A member offline for 10 minutes receives all points added/edited/deleted meanwhile after reconnect, with no manual action.
- AC4: Two members edit the same point concurrently (including offline-then-merge); all devices converge on the same winner (highest `rev`, tie by author) with no crash, and the same final lat/lon pair (never mixed).
- AC5: Delete + concurrent edit resolves deterministically (higher `rev` wins) and identically everywhere.
- AC6: A device with an invalid or tampered record (fuzzed) does not crash projectors; invalid records are counted in diagnostics.
- AC7: Non-members' docs are ignored; removed members stop appearing.
- AC8: Joiner on an older `appVersion` is refused with an explanation.
- AC9: After kill/restart, local state is intact and unflushed outbox ops are re-sent exactly once logically (idempotent).
- AC10: D-1 licence route is decided and recorded in PROGRESS.

## Automated testing

- Property-based tests for merge/projection (random interleavings, duplicates, reorderings, clock skew irrelevance).
- Unit: join token generation/validation/expiry, version gating, roster gating, schema bounds, outbox replay.
- `FakeMesh` scenarios: N peers, partition and heal, delayed and duplicated messages, a peer on an old version.
- Integration: DB migrations with data; projector against a captured `docJson` corpus.
- Component: group creation/join screens, point sheet.
- E2E (emulator, fake mesh): create group, add point, restart app, point persists.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| Join by QR, 3 joiners (mix of OS) | 4 | AC1 |
| Point propagation: direct, 2-hop (A-B-C chain) | 3-4 | AC2 |
| Offline member returns after 10 min and after 2 h | 3 | AC3 |
| Concurrent edits, one side offline | 3 | AC4, AC5 |
| Kill app mid-edit | 2 | AC9 |
| Admin leaves; promoted co-admin invites a new member | 4 | works |
| Old-build member present (build N-1) | 3 | A-gating behaviour recorded, SDK group-sync impact recorded |
| Event inbox dedupe with duplicates | 2 | no double notifications |

## Deliverables

- Working group + shared meeting points across iOS and Android.
- `ReplicatedDocs`, `MeshBus` v1, projectors, merge library with tests.
- ADRs: doc ids (A-06), BLE-only replication (A-07), admin-commit enforcement, licence decision.
- Updated `MESH_PROTOCOL.md` / `DATA_MODELS.md` with confirmed behaviour; `PROGRESS.md`.

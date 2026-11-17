# ADR 0016: Co-leaders edit the plan through the organizer

Status: Accepted (2026-11-17). Implemented on branch `feat/co-leaders`. Not verified on a device.

## Context

A group has one organizer, who alone shares meeting points and plans the group adventure (ADR 0007, ADR 0009). On a real trip the planning is shared: a sweeper at the back, a second guide who knows the route. The owner asked for the organizer to make an existing member a leader, and for the leaders to edit the plan together.

The mesh layout is a star (MESH_PROTOCOL.md 2.3): every member follows the organizer and the organizer follows every member. Members do not follow each other, and each member already costs the organizer 3 of the SDK's subscription slots.

## Decision

- **A co-leader is a roster role.** The organizer can make any active member a leader and take it back (`GroupService.setLeader`). It is a roster event like a rename: a new member `rev`, published on `member`. Locally the role is `leader`; on the wire it is `role: 'member'` plus `lead: true`, so a build without co-leaders, whose schema has no `lead` and strips unknown keys, still accepts the event and simply sees a member.
- **The organizer stays the hub.** A co-leader does not publish group state. An edit made on a co-leader's phone is applied there and sent to the organizer on a channel the organizer already follows:
  - meeting points: `point_edit` / `point_remove_edit` on the co-leader's `member` topic, key `e-<pointId>`, the same payloads as `point` / `point_removed`;
  - checkpoints of the organizer's group adventure: `checkpoint_edit` on the co-leader's `adv` topic, key `e-<checkpointId>`, the same payload as `checkpoint`.
  The organizer checks the sender is an active co-leader, merges the edit by the usual rule and, if it wins, publishes it as its own `point` / `checkpoint`. Every member, the co-leader included, gets the result the way it always has.
- **Authorship.** A relayed meeting point keeps the co-leader as `by` (and as `createdBy` for a point they created). Members accept a point from the organizer whose author is the organizer or anyone in the roster, so points a co-leader wrote stay valid after they are demoted or leave. Checkpoints carry no author.
- **Conflicts.** Meeting points: highest `rev`, then the greater author address (MESH_PROTOCOL.md 3.3), the same everywhere, so two leaders editing at once converge with no extra step. Checkpoints have no tie-break, so when the organizer receives a different version at the revision it already has, it keeps its own and republishes it one revision higher; every phone ends on the organizer's version.
- **Out of range.** When the organizer starts following a co-leader again, the co-leader re-sends its own meeting point versions and the checkpoints of the organizer's open adventures. The organizer ignores anything it already has (merge is idempotent).
- **What stays the organizer's.** Inviting and removing people, choosing leaders, the trip map, creating a group adventure or activity, its name and details, starting, pausing, finishing or cancelling it, and activity drafts (they exist only on the organizer's phone). A published activity stays fixed for everyone (ADR 0011).

## Alternatives considered

- *Every leader publishes; members follow every leader.* No hub, so a leader's edit reaches people the organizer cannot. But each extra leader costs every member three more subscriptions and every leader up to 33 (12 members), multiplies the reconnection traffic, and needs multi-writer merge for the roster too. Rejected for now; revisit if the organizer being out of range turns out to matter on real trips.
- *Hand the group over (change the organizer).* Members would have to re-follow a new provider and the old organizer's state moves with it. Larger change, different need (the organizer leaving early). Not done here.
- *DataStore documents for the plan.* CRDTs would give multi-writer editing directly, but group replication over BLE is unverified (A-06, A-07) and Muster does not use DataStore yet (ADR 0007).

## Consequences

- A co-leader's edit reaches the group only through the organizer. If the organizer is out of everyone's range, the edit waits on the co-leader's phone and is re-sent when the organizer follows again.
- Builds without co-leaders accept the roster event (they show the co-leader as a member) but **drop meeting points authored by a co-leader** (their rule is "author = organizer"). Checkpoint edits reach them normally. There is still no `minAppVersion` gate.
- No new subscriptions, topics or SDK calls.
- Unverified on devices: the same open items as groups (A-19 to A-24).

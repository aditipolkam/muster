# Phase 4: Live Location and Group Coordination

## Scope

In:
- Periodic location sharing to a group via the Live lane, with the adaptive `SamplingPolicy`.
- Group member markers on the map, last-known positions with age and staleness, member list with distance.
- Status updates (`moving | resting | arrived | help | offline`) and arrival detection/notification at meeting points.
- Privacy controls: per-group share on/off/until, precision rounding, pause on arrival, relay-duty toggle, retention settings, "stop sharing" semantics and honest copy.
- Basic reconnection handling: "last heard" tracking, catch-up summary after returning to range.
- Live lane spike S4-1 and the decision.

Out: background location, GPX, navigation line, full sync hardening (Phase 6).

## Dependencies

Phase 3 (groups, docs, projectors, events). Phase 1 location. At least 4 test devices.

## Architecture considerations

- **Live lane = per-person service subscriptions** (`MESH_PROTOCOL.md` §2.1): each member registers `tm.live.1.<g>` and publishes `pos`/`status` (`latest`); others subscribe to that member with pattern `*`. Follow/Unfollow UI per member; admission policy `rules` (auto for group members) or `restricted` (ask each time). Receivers project updates into `member_positions` with `(seq, fix)` monotonicity.
- **Fallback:** `pos` key in the member document (State lane), behind the same `LiveLane` interface, used only if S4-1 shows a blocking SDK defect.
- Instrument everything the demo should show: `publishServiceUpdate` returns `{subscribers, sentLive, queued, coalesced, failed}`; record these per publish in a debug panel ("1 publish -> N frames").
- Ages use both clocks: receiver `received_at` for "last heard", sender `fix` for "fix time".
- Rounding/precision applied before publishing; full precision only in local breadcrumbs.
- Arrival detection runs locally on each device on its own fixes (radius + hysteresis + dwell), then writes `status` and sends an `arrived` event (hint). Others also derive arrival of members from positions only if desired (off by default to avoid false alarms).
- Presence is derived from `last_heard_at`, never from a single transport event.
- Rate and size budgets from `MESH_PROTOCOL.md` §5.

## Spike S4-1: validate subscriptions on devices (start early, 3 days)

Run as soon as Phase 2 passes; do not wait for the rest of Phase 4. 4 devices (one 2-hop), 10 minutes walking, 15 s sampling. Pass criteria for adopting subscriptions as the live lane (resolves A-02):

| Check | Pass |
|---|---|
| Subscribe, first update, snapshot catch-up, renew across several lease periods | Works on iOS and Android, all pairs |
| First subscription between never-paired devices (1:1 MLS session creation) | Active within 120 s (`pending_timeout_ms`) |
| Provider restart (kill app) | Followers show `stream_reset` / resume and get current state within a lease |
| 30 min partition then heal | Follower gets latest snapshot, no stale value shown as current |
| Policy `rules` auto-admit group members; `restricted` prompt flow | Both work |
| Stability: no unexpected `service_subscription_changed` reasons (`renewal_unanswered`, `no_reply`) | Under walking conditions |
| Metrics recorded | Median/p95 age, frames per publish, battery/h |

If a check fails because of an SDK defect, fix it in the SDK (you own it) rather than working around it in the app; only fall back to the member-doc `pos` lane if the fix is not feasible for the demo.

## Implementation tasks

1. P4-1 `SamplingPolicy` (pure) + tests; `LiveLane` interface; baseline implementation.
2. P4-2 Publishing loop with lifecycle (start/stop with sharing state, foreground only), seq counter, rounding, GPS-lost handling.
3. P4-3 Receiver projection to `member_positions`; staleness model (fresh < 2 min, aging < 10 min, stale beyond; thresholds configurable).
4. P4-4 Map member layer (colour, initials, age badge, accuracy ring for coarse precision), member sheet, member list screen sorted by distance with "last heard".
5. P4-5 Share controls UI and `share_settings`; "until" timers; stop-sharing flow writes `sharing:false`; honest-limitation copy.
6. P4-6 Status UI and `status` doc; arrival detection service; notifications (local, foreground) and Event lane hints.
7. P4-7 Catch-up summary on return to range (`last_seen_at` bookkeeping).
8. P4-8 Run S4-1; implement the chosen lane for production; ADR.
9. P4-9 Retention jobs (positions, events) and "delete my data from this group".
10. P4-10 Diagnostics: per-member last doc/event times, live-lane stats.

## Acceptance criteria

- AC1: With sharing on, each member's marker updates on all other members' maps per the sampling policy; median age <= 20 s at one hop and <= 45 s at two hops while moving (targets; adjust with evidence from S4-1).
- AC2: Last-known position persists with correct age after a member goes out of range or the viewing app restarts; a stale position is visibly different and never presented as live.
- AC3: Toggling sharing off stops all future publishes immediately; peers show "not sharing" after the next sync; toggling "until 1h" auto-stops on time (also after app restart).
- AC4: Precision `~100 m` / `~1 km` publishes only rounded coordinates (inspect document contents in a test build).
- AC5: Arrival at a meeting point triggers exactly one notification on others (dedupe) and sets status `arrived`; GPS jitter at the boundary does not retrigger (hysteresis).
- AC6: GPS loss: the member shows "GPS lost", no fabricated positions are sent; resume on recovery.
- AC7: A member returning after 1 h sees all other members' last-known positions and statuses within 60 s of reconnecting, plus a summary of what changed.
- AC8: Position records in logs are redacted by default.
- AC9: S4-1 decision recorded with data.

## Automated testing

- Unit: `SamplingPolicy` across a table of scenarios (speed, battery, accuracy, app state), arrival hysteresis/dwell, staleness classification, precision rounding (including near poles/antimeridian), seq/fix monotonicity filter.
- `FakeMesh` sims: partition/heal, duplicates, reordering, a member with skewed clock, 10-member group message volume.
- Property tests: projector never regresses position `(seq, fix)`.
- Component: map member layer snapshot, share sheet states.
- Privacy tests: serialised `pos` never contains more than the selected precision; sharing-off record contains no coordinates.

## Physical-device testing

| Test | Devices | Pass |
|---|---|---|
| 4 people walk, 2 of them 40-100 m apart (out of BLE range at times) | 4 | Markers update, ages honest, reconnect catch-up |
| S4-1 comparison (above) | 4 | Data recorded |
| Share toggle / until / app kill | 2 | AC3 |
| Arrival at a meeting point with GPS jitter (urban canyon and open) | 2 | AC5 |
| GPS loss (indoors / airplane GPS off) | 2 | AC6 |
| Battery: 2 h foreground sharing, screen dim | 2 per OS | Record %/h (feeds B-1) |
| Heterogeneous clocks (set one phone's time off by 10 min) | 2 | Ages and ordering remain correct |
| Peer returns after 1 h | 3 | AC7 |

## Deliverables

- Live location, member markers, statuses, arrival notifications, privacy controls.
- Chosen Live lane implemented; ADR with S4-1 data.
- Updated `MESH_PROTOCOL.md`, `ARCHITECTURE.md` privacy section, `PROGRESS.md`.

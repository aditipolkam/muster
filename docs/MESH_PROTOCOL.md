# Mesh Protocol (application layer)

This is TrailMesh's own protocol, carried by the Offline Protocol SDK. The SDK has no group-scoped pub/sub (`SDK_INTEGRATION.md` §4), so TrailMesh defines logical topics and maps each to an SDK primitive ("lane").

Everything here is application convention. It is versioned so devices on different builds can detect incompatibility.

## 1. Lanes

| Lane | SDK primitive | Delivery | Use |
|---|---|---|---|
| **State** | `DataStore` documents in space `group:<uuid>` (spaceId = group id) | Eventually consistent, anti-entropy, catches up after any absence | Everything a late or reconnecting member must know |
| **Event** | `meshSendGroupMessage` -> `group_message_received` | At-least-once, <= 7-day outbox, per-member fan-out, no replay for late joiners | "Arrived", "Need help", "Meeting point changed" nudges |
| **Live** | **Service subscriptions.** Each member registers a per-group service and publishes `latest` topics; other members subscribe to that member (§2.1). Fallback only: `pos` key in the member document (State lane) | Newest value wins, ephemeral over a live link, one superseding queued value per key across hops | Live position, status |
| **Direct** | `sendConnectionRequest`, `sendMessage` to one address | At-least-once | Join request, invite handshake |

**Rule: state is canonical, events are hints.** Every fact carried by an Event must also be derivable from State after the fact. Losing every event must not lose any information (only immediacy).

## 2. Topics

Logical topic grammar (documentation and `MeshBus` routing key; not an SDK concept):

```
tm/<v>/<groupShort>/<channel>[/<detail>]
```

- `<v>`: protocol major, `1`.
- `<groupShort>`: the group uuid (the SDK group id minus the `group:` prefix). Topic charset in the SDK is `A-Z a-z 0-9 . _ - /`, so no colon. [SDK payloads.rs]

| Topic | Lane | Publisher | Payload |
|---|---|---|---|
| `tm/1/<g>/member/<addr>` | State | that member only | Member document (§3) |
| `tm/1/<g>/group` | State | admins | Group document (§3.2) |
| `tm/1/<g>/event` | Event | any member | Event envelope (§4) |
| `tm/1/<g>/live/<addr>` | Live | that member | Service `tm.live.1.<g>` on provider `<addr>`, topics `pos`/`status` (§2.1) |
| `tm/1/join` | Direct | joiner -> admin | Join request (§6) |

### 2.1 Live lane: subscribe to a person

The pub/sub model being demonstrated: **a person publishes their live state; interested people subscribe to that person.**

- **Provider (every member, for themselves):** `registerService('tm.live.1.<g>', ...)`, then `publishServiceUpdate(serviceId, topic, body, key)`. One service per group, so privacy is per group.
- **Topics (mode `latest`, one key each):**

| Topic | Key | Body |
|---|---|---|
| `pos` | `pos` | Position record (§5) |
| `status` | `status` | `{state, note?, targetId?, ts}` |
| `track` (optional, demos `log` mode) | none | Compact breadcrumb point; checkpoint = last N points |

- **Consumer:** `subscribeService(providerAddr, serviceId, '*', 'latest')` follows `pos` and `status` in one subscription (pattern `*`, up to 64 topics). `log` topics need a separate subscription because a subscription has one mode. Updates arrive as `service_update_received` (`topic`, `key`, `seq`, `body`, `snapshot`); lifecycle as `service_subscription_changed`.
- **Who subscribes to whom:** the UI has **Follow / Unfollow** per member. Default "Follow everyone in the group" subscribes to each roster member; the user can narrow to one person (e.g. the leader). Roster comes from `meshGetGroupInfo().memberIds` [ASSUMPTION A-18: ids are the `off1…` addresses subscriptions need].
- **Admission policy (provider):** `rules` with `allow_groups: [groupId]` so group members are admitted automatically; setting "Ask me each time" switches to `restricted`, and the app answers `service_subscribe_received` with `acceptServiceSubscription` / `rejectServiceSubscription`. This showcases the policy model.
- **Kill switches:** `endServiceSubscription(subId)` removes one follower; `unregisterService` ends every subscription for the group.
- **Catch-up:** on subscribe and on each renewal (half lease, default lease 120 s) the provider sends a snapshot if the digest differs, so a returning follower gets current state with no app code. A provider restart yields a new `stream`; the consumer resets and reports `stream_reset`.
- **Provider restart:** subscriptions are not persisted (SDK invariant 3). On app start the provider re-registers the service and republishes current `pos`/`status` from SQLite; followers renew and resync.
- **Limits that shape the design:** provider <= 256 subscriptions, <= 16 per subscriber; consumer <= 64; lease 30 s - 10 min; `latest` coalesced to one update per 50 ms; a first subscription needs a confirmed 1:1 MLS session (may take time on first meeting; pending times out at 120 s). Target group size <= 12 (11 subscriptions each with the `*` pattern). [SDK ADR 0035, `payloads.rs`]
- **Known SDK-side items to confirm (you own the SDK):** ADR 0035 status "Proposed", and the 64 KiB (ADR) vs 128 KB (`MAX_SERVICE_PAYLOAD_SIZE`) body limit.

### 2.2 Diagnostic scope (Phase 2)

Groups arrive in Phase 3, so the `<groupShort>` position carries the reserved scope `diag` for the developer screen: provider service `tm.live.1.diag`; SDK topics `tm/1/diag/event` (mode `log`, publish without a key) and `tm/1/diag/state` (mode `latest`, key `state`); a consumer subscribes with pattern `tm/1/diag/*` in one mode. The logical topic string is used verbatim as the SDK topic (charset `A-Z a-z 0-9 . _ - /`). Bodies are the section 4 event envelope (`tm:1`, ULID `id`, `t`, `a`, `ts`, `p`, at most 2048 bytes); the default admission policy is `restricted` (the provider approves each follower). Received envelopes are stored in the `events` table (`group_id` = `diag`) before being handed to handlers, and deduplicated by envelope `id` in memory and by that primary key across restarts. Implemented in `src/mesh/` (`envelope.ts`, `topics.ts`, `PubSub.ts`).

### 2.3 Group pub/sub (Phase 3, implemented)

Phase 3 carries groups and meeting points on the same service-subscription layer as Phase 2 (`PubSub`, ADR 0035), **not** on `DataStore` or MLS groups (ADR 0007). Sections 1, 3 and 6 describe the earlier plan; where they differ from this section, this section is what the app does.

**Roles and shape.** A group has one *organizer* (its creator) and members. The topology is a star: every member follows the organizer, and the organizer follows every member. Members do not follow each other.

**Service.** Every device provides one service, `tm.group.1`, for all its groups (policy `restricted`; the app answers each `service_subscribe_received` itself, see "Admission"). The group id is the scope inside the topic. A second `PubSub` instance (`owns: serviceId === 'tm.group.1'`) keeps it separate from the diagnostics service.

**Topics.** `tm/1/<groupId>/<channel>[/<detail>]`, each explicit. No `*` pattern, retained message or replay is used or assumed. All group topics are `latest` mode with a key, so the SDK *may* also send a snapshot to a late subscriber, but nothing depends on that: the provider pushes current state itself when a follower becomes `active`, and members can ask (`sync`).

| Topic | Publisher | Key | Types | Payload |
|---|---|---|---|---|
| `tm/1/<g>/member` | organizer | member address | `joined`, `left`, `removed`, `closed` | `{addr, name, role, rev}`; `closed`: `{rev}` under key `_group` |
| `tm/1/<g>/point` | organizer | point id | `point` | `{id, rev, name, note?, lat, lon, by, createdBy, createdAt, ts}` |
| `tm/1/<g>/point-removed` | organizer | point id | `point_removed` | `{id, rev, by, ts}` |
| `tm/1/<g>/member` | member | own address | `hello`, `leave` | `{name, appV}`; `leave`: `{addr}` |
| `tm/1/<g>/ack` | member | point id | `ack` | `{pointId, rev}` |
| `tm/1/<g>/sync` | member | `sync` | `sync_request` | `{mrev, points: [{id, rev}] (<= 15)}` |
| `tm/1/<g>/j/<token>` | organizer (reply) | `welcome` | `welcome` | `{g, name, o, mrev}` |
| `tm/1/beacon` | organizer | `beacon` | `beacon` | `{g, n, o, until}` |

`member` is one topic name used in both directions; direction is decided by the receiver's role for that group (an organizer reads `hello`/`leave`, a member reads `joined`/`left`/`removed`/`closed`). All envelopes are the section 4 envelope (<= 2 KB). A meeting point name is <= 60 characters and its note <= 280, so a worst-case multi-byte point still fits (tested).

**Authorization (the rule that makes an update "accepted").** The only identity trusted is the SDK's `provider` (the 1:1 session peer, [ASSUMPTION A-20: authenticated by the session]). The envelope's `a` must equal it. Then:

- `member` (organizer to member), `point`, `point_removed`, `welcome` are accepted only if the sender is the **organizer recorded locally** when this device created or joined the group, the group is `active` (`joining` for `welcome`), and any author field in the payload (`by`, `createdBy`, `addr` for the organizer entry) names the sender. A member can therefore never publish an accepted meeting point or roster change, and an organizer ignores such messages about its own group.
- `member` (member to organizer), `ack`, `sync` are accepted only by the organizer, only from an **active roster member**, and `hello`/`leave` may only name the sender.
- Everything else is dropped and logged without coordinates. Payloads are schema-validated (zod) with bounds on size, ranges and counts before anything is stored.
- The same rules gate **subscription requests**: the organizer accepts `member`/`point`/`point-removed` follows only from active members; a member accepts `member`/`ack`/`sync` follows only from its organizer. Anyone else is rejected, so a non-member never receives group state either.

**Versioning and ordering (meeting points).** Only the organizer edits, so `rev` is a simple counter (`max seen + 1`). The documented section 3.3 winner rule is kept anyway: highest `rev` wins, a tie goes to the greatest `updatedBy`. A removal is a version with a higher `rev` (a tombstone row is kept), so an older update arriving late cannot bring the point back and a removal that arrives first is not undone. Merge is idempotent and independent of arrival order (property-tested over all permutations). Roster entries are ordered per address by the organizer's `rev`.

**Duplicates.** `PubSub` drops a repeated envelope id (memory and the `events` table, so also after a restart). A re-sent identical version under a new envelope id is a no-op in the merge.

**Joining.** The join request *is* a subscription request, so no extra primitive is needed.

```mermaid
sequenceDiagram
  participant J as Joiner
  participant O as Organizer
  O->>O: invitation QR: trailmesh://join?v=1&g=GROUP&o=ADDR&t=TOKEN&n=NAME
  J->>J: scan (or paste) the link; enter name
  J->>O: subscribeService(O, tm.group.1, tm/1/GROUP/j/TOKEN)
  O->>O: service_subscribe_received: check token hash, expiry, single use (or nearby window)
  O->>J: acceptServiceSubscription at once (the SDK would reject it after 60 s unanswered)
  O->>O: card "wants to join" (skipped if the invitation was created with auto-approve)
  O->>O: Approve: capacity check, roster entry added (rev n)
  O-->>J: welcome on that topic; Decline ends the subscription instead
  J->>J: active; unsubscribes the join topic
  J->>O: subscribe to member, point, point-removed
  O->>J: subscribe to member, ack, sync (joiner accepts only its organizer)
  O-->>J: current roster and points; J sends hello (name) and, on activation, sync_request
```

- The SDK admission and the organizer's approval are separate (ADR 0012). A valid request is admitted by the SDK straight away, which gives the joiner nothing: only the welcome is ever published on its token topic. The request then waits for the organizer for as long as the joiner keeps renewing, instead of the SDK's 60 s approval timeout. If the joiner cancels or its lease lapses, the provider-side `ended` event removes the card.
- Token: 128 random bits (base32, 26 characters), single use, 24 h. Only its SHA-256 is stored. A used token admits only the device that used it (retry). The default is organizer approval; the organizer can choose auto-approve per invitation (the QR is shown face to face).
- Capacity: 12 active members (each costs the organizer 3 subscriptions; ADR 0035 limits).
- **Nearby discovery.** The organizer can open the group for 10 minutes. Every subscription to a device's `tm/1/beacon` is accepted, but a beacon `{g, n, o, until}` is published only while a group is open, so a follower learns nothing until then and hears it the moment the group opens. A joiner follows the beacon of each nearby peer (up to 8) once, lists open groups, and can ask to join with the reserved token `open`; this **always needs approval**. When the window closes the organizer publishes a beacon with `until` in the past and refuses further `open` requests.
- Leaving: a member sends `leave` and deletes the group locally; the organizer marks it `left`, drops its follows and tells the others. The organizer "leaving" ends the group (`closed`); members keep the group read-only, its points leave the map. The organizer can remove a member (`removed`); the removed device purges the group.

**Reconnection.** Subscriptions are not persisted by the SDK, so on every mesh start, on mesh state changes and every 30 s the app re-checks that each group has its subscriptions (retries per provider limited to once a minute because a pending subscription times out after 120 s). When a follower becomes active the provider re-publishes current state for that topic; a member also sends `sync_request` when it becomes active. An acknowledgment that could not be delivered is kept (`ack_published = 0`) and sent when the organizer follows the member again.

### Scoping: who can read a topic?

- State/Event lanes: only MLS group members; the SDK seals them. Non-members cannot decrypt even if they relay the ciphertext.
- Live (subscription variant): only peers admitted by the provider's policy, over the 1:1 session.
- Relays forward ciphertext and can observe size, timing and hop metadata. [ASSUMPTION A-17: metadata exposure to forwarders is acceptable; documented to users]

## 3. State lane documents

DataStore: `docId` per document; collections of types `map | list | text | counter`; a `map` value is one of null/bool/int/float/text/bytes/attachment. TrailMesh stores **JSON in `text` values** validated by zod on read.

Flush rules: after local edits, `flush(spaceId, docId)` throttled to <= ~2/s and once when editing stops; `data_changed` fires after durability. `setInterest(spaceId, ['m.*','group'])` is called before `start()` each launch (<= 32 patterns). [SDK data.md]

### 3.1 Member document `m.<addr>` (single writer = that member)

| Collection (map) | Key | Value (JSON text) |
|---|---|---|
| `profile` | `v1` | `{name, color, appVersion, minGroupV}` |
| `status` | `v1` | Last-known status snapshot (also published live via §2.1): `{state:'moving'\|'resting'\|'arrived'\|'help'\|'offline', note?, targetId?, ts, rev}`. Written at low frequency so a late joiner has something when the member is out of range |
| `share` | `v1` | `{sharing:boolean, precision, until?, ts, rev}` |
| `pos` | `v1` | Last-known position (§5), written at coarse cadence (every ~5 min, on stop-sharing, on arrival); live updates travel via subscriptions. `null` when not sharing |
| `points` | `<pointId>` | Meeting-point version authored by this member (§3.3) |

Because every key is written only by its owner, no two devices ever write the same key and DataStore's last-writer-wins never decides anything.

### 3.2 Group document `group` (admins)

`{name, createdAt, minAppVersion, protocolV:1, joinTokenHash?, joinTokenExpires?, defaults:{precision, interval}}`. Concurrent admin edits are rare; LWW is acceptable here and the group name is also in the SDK (`meshRenameGroup`).

### 3.3 Meeting points (multi-author, conflict-free by construction)

A meeting point `P` has a stable `pointId` (ULID, created once). Any member may edit it. Each edit is written **into the editor's own member doc** under `points/<pointId>`:

```json
{ "v":1, "id":"01J…", "rev":7, "author":"off1…", "ts":1761830000000,
  "name":"Lake junction", "lat":46.8123, "lon":8.2271, "radiusM":30,
  "note":"…", "kind":"meeting|waypoint|hazard|camp", "deleted":false }
```

Rules:
- `rev` for a new edit = (max `rev` of any version of this point seen locally) + 1 (Lamport style; no clock needed).
- **Winner** on every device = highest `rev`; ties broken by lexicographically greatest `author`. Deterministic, identical everywhere, independent of arrival order.
- Delete = a version with `deleted:true` (a tombstone with a higher `rev`), never a CRDT key deletion; a later edit with a higher `rev` can resurrect it.
- A member's older versions of the same point are overwritten in their own doc (key `points/<pointId>`), so growth is bounded by (#points authored).
- Lat/lon travel in a single JSON value: **never** split into separate keys (a concurrent merge could mix one author's lat with another's lon).

The "loser" of a concurrent edit is not silently dropped: both versions exist in separate docs, the UI can show "also edited by Sam" for a short period (optional, Phase 3 stretch).

## 4. Event lane

Envelope (JSON, UTF-8, sent as the group message `content`):

```json
{ "tm":1, "id":"01J…", "t":"arrived", "a":"off1…", "ts":1761830000000,
  "p":{ "pointId":"01J…" } }
```

| Field | Meaning |
|---|---|
| `tm` | Protocol major (1). Receivers ignore envelopes with a higher major and show "update the app" once |
| `id` | ULID, the dedupe key (also dedupe by SDK `message_id`) |
| `t` | Event type |
| `a` | Author address (informational; the SDK's `sender` is authoritative) |
| `ts` | Sender clock ms (display only, never used for ordering decisions) |
| `p` | Type-specific payload, unknown fields ignored |

Types (v1): `status` (state change nudge), `arrived` (reached a point; also reflected in member `status`), `point` (a meeting point changed; pointId only, the data comes via State), `help`, `left` (member leaving), `ping`. Size budget <= 2 KB.

Receiving: validate (zod) -> dedupe (`events` table PK `id`) -> persist -> notify. Unknown `t` is stored and ignored (forward compatibility).

Ordering: events are shown ordered by receive time within a sender-`ts` window; no correctness property depends on order.

## 5. Position record (Live lane)

```json
{ "v":1, "lat":46.81234, "lon":8.22711, "acc":8, "alt":1450, "spd":1.2,
  "hdg":87, "fix":1761830000000, "seq":412, "bat":63, "prec":"exact" }
```

- 5 decimals (~1.1 m) for `exact`; rounded grid for `~100m`/`~1km`.
- `fix` = GPS fix time (GPS clock is reliable offline). Receivers also store `receivedAt` from their own clock. UI shows both "last heard 3 min ago" (receiver clock) and fix time.
- `seq` monotone per sender per boot; receivers drop `seq` lower than the stored one for the same sender (and `fix` older than stored).
- Budget <= 512 bytes; sent at most per the `SamplingPolicy` (`ARCHITECTURE.md` §10).
- `null` or `{"sharing":false}` means "not sharing".

## 6. Join protocol (Direct lane)

```mermaid
sequenceDiagram
  participant J as Joiner
  participant A as Admin
  A->>A: show QR: trailmesh://join?v=1&a=ADDR&t=TOKEN&n=NAME
  J->>J: scan QR (verifies admin address out-of-band)
  J->>A: sendConnectionRequest(recipient=ADDR, senderName, initialMessage={t:TOKEN, name, appV})
  A->>A: validate token (hash, expiry, single group), appV >= minAppVersion
  A->>A: UI "Alex wants to join" -> Approve
  A->>J: acceptConnectionRequest ; meshInviteToGroup(groupId, joinerAddr)
  J->>J: Welcome processed -> group_created/member events (A-05: confirm sequence)
  J->>J: setInterest(group space) ; anti-entropy pulls all member docs
  J->>A: writes own member doc (profile) ; Event 'joined' (hint)
```

- Token: 128-bit random, only its hash stored in the `group` doc; expires (default 24 h) and revocable by admin.
- Reverse flow (admin scans joiner QR containing the joiner address) skips the token and goes straight to `meshInviteToGroup`.
- Consent: the joiner sees the group name and admin before sending; the admin approves each joiner (or toggles "auto-approve with token" for the trip).
- Failure surfaces: `connection_request_undeliverable`, timeout -> "Move closer to the group leader".

## 7. Versioning and compatibility

- `tm` (wire major) in events; `v` in each stored record; `protocolV` and `minAppVersion` in the group doc.
- Additive changes (new optional fields, new event types) do not bump `tm`.
- Breaking change -> new major, new topic prefix `tm/2`, new doc ids; v1 docs stay readable.
- One old member breaks group replication for everyone (SDK limitation), so admins refuse invites to builds below `minAppVersion` and the app warns when a member reports an older `appVersion`.
- Records carry unknown fields through unchanged on re-write (read-modify-write preserves them).

## 8. Reliability, ordering and idempotency summary

| Aspect | Guarantee |
|---|---|
| State | Eventually consistent; a member away for any duration converges on reconnect (as long as replicas hold the history) |
| Event | At-least-once, unordered, may be lost if senders die; never required for correctness |
| Live | Latest-wins, monotone by `(seq, fix)`; gaps are normal |
| Idempotency | All handlers keyed by `id`/`rev`/`seq` |
| Duplicate suppression | `events.id`, SDK `message_id`, point winner rule |

## 9. Security notes

- Confidentiality/integrity of group content: MLS via the SDK.
- No per-author authentication inside the group space; a member could write another member's doc. Mitigation: readers only accept a member doc's `author` fields that equal the doc's address; mismatches are logged and ignored. This is a consistency check, not a security boundary.
- Join tokens are bearer secrets over a face-to-face QR; short expiry; admin approval default.
- Inputs from the mesh are untrusted: schema-validate, bound sizes, bound counts (max points per member 200, max members 32 shown), rate-limit event processing.

## 10. Adventures (Phase 7, implemented, not device-verified)

Adventures ride on the group service of section 2.3 (`tm.group.1`) and its authorization model. **Nothing existing changes**: no topic is renamed, no payload field is repurposed, the service id and policy are unchanged, and a build without this channel keeps working (it refuses the one extra subscription; `authorizeSubscription` for the channel is the only addition). Design reasons: `GAMIFICATION_ARCHITECTURE.md` section 4, `adr/0009`.

### 10.1 Channel

`adv` is added to both channel lists (`ORGANIZER_CHANNELS`, `MEMBER_CHANNELS`), so it is subscribed and reconciled with the same code as `member`. It is one topic per direction with several keys (mode `latest`, one value per key). Direction is decided by the receiver's role, as for `member`.

| Direction | Topic | Key | Type | Payload |
|---|---|---|---|---|
| organizer -> members | `tm/1/<g>/adv` | `a-<advId>` | `adventure` | `{id, rev, name, desc?, status, st?:{lat,lon,n?}, ca, sa?, ea?, ts}` |
| organizer -> members | same | `c-<checkpointId>` | `checkpoint` | `{adv, id, rev, ord, name, desc?, kind, lat, lon, del?, ts}` |
| organizer -> members | same | `r-<completionId>` | `reached` (relay) | `{adv, cp, id, at, m, addr}` |
| organizer -> members | same | `p-<pid>` | `participant` (relay) | `{adv, pid, state, seq, ts, addr, name?}` |
| organizer -> members | same | `m-<checkpointId>` | `milestone` | `{adv, key:'all_reached', cp, ts}` |
| member -> organizer | same | `r-<completionId>` | `reached` | `{adv, cp, id, at, m}` |
| member -> organizer | same | `p-<pid>` | `participant` | `{adv, pid, state, seq, ts}` |
| member -> organizer | same | `sync` | `adv_sync` | `{advs:[{id, rev, cc}]}` (<= 6) |

- Envelope as section 4 (<= 2 KB). The worst case (4-byte characters in every free-text field) is tested to fit. Keys use `A-Za-z0-9_-` only (the existing keys already do) [ASSUMPTION A-26: the SDK accepts these keys; same charset as `_group` and point ids].
- `status` is one of `planned | active | paused | completed | cancelled`. The events requested by the product map to this: *adventure created* = `adventure` with `rev 1`; *started / paused / completed* = `adventure` with the new status; *checkpoint reached* = `reached`; *participant status updated* = `participant`; *group milestone unlocked* = `milestone`.
- `m` is `auto` or `manual`. `at` is the arriving person's clock and is capped at the organizer's receive time. **No `reached` or `participant` payload carries a position.**
- `pid` is a ULID the participant chooses once per adventure; it is only the key. Identity always comes from the SDK `provider` (members) or from the organizer's attestation `addr` (relays).

### 10.2 Who may publish what

Enforced by `domain/adventures/authorize.ts`, on top of the group rules (envelope `a` equals `provider`; group `active`).

| Message | Accepted when |
|---|---|
| `adventure`, `checkpoint`, `milestone`, relayed `reached` / `participant` | This device is a member and the sender is the organizer recorded for the group. Relays must name `addr` |
| `reached` | This device is the organizer; sender is an active roster member and names no one else; the adventure belongs to this group and is owned here; it is `active`, `paused` or `completed`; the checkpoint exists and is not removed; the sender has not left it |
| `participant` | As above, adventure not completed or cancelled |
| `adv_sync` | Organizer, from an active roster member |
| subscription to `adv` | Same as the other channels: the organizer accepts active members; a member accepts only its organizer |

Only the group organizer can *create* a group adventure or change its status or checkpoints; members plan their own solo adventures, which never touch the mesh. Anything else is dropped and logged without coordinates.

### 10.3 Ordering, conflicts and deduplication

| Record | Winner | Notes |
|---|---|---|
| Header | Highest `rev` | A higher `rev` is still refused if it leaves `completed`/`cancelled`, returns to `planned`, or names another group. Skipping states (a lost `active`) is accepted |
| Checkpoint | Highest `rev` | Removal is `del: true` at a higher `rev`; a late older version cannot resurrect it |
| Arrival | Earliest `at`, then smaller id | Grow-only; one row per (adventure, checkpoint, person) |
| Participation | Highest `seq` | Only that person bumps it |

Every handler is idempotent. `PubSub` drops repeated envelope ids (also after a restart); the rules above make a re-sent record under a new envelope id a no-op. Applying in any order gives the same state (tested over all 120 orders of a five-step history).

### 10.4 Reconnection

Subscriptions are not persisted by the SDK, so the existing 30 s reconcile re-creates them. Then:

1. A member's `adv` subscription to the organizer becomes active -> the member sends `adv_sync` with `{id, rev, cc}` per adventure of the group (`cc` = completions held).
2. The organizer answers by re-publishing the shared state of every adventure whose `rev` or `cc` differs (header, checkpoints, participants, arrivals). The same push happens when any follower becomes active, with no request needed.
3. The organizer following a member again triggers the member to re-send what was never confirmed (its own arrivals and participation). The organizer's relay of a member's record comes back to that member, which is the confirmation (`published`). A 30 s timer repeats this while anything is unconfirmed.

Nothing depends on SDK snapshots or replay. Finished adventures are pushed for 7 days only.

### 10.5 Limits and subscription budget

20 checkpoints, 240 arrivals, 12 members per adventure. The channel adds **one** subscription per group per direction (a member holds 4 follows on its organizer per group; the SDK allows 16 per subscriber, so a member of 4 groups with the same organizer is at the limit). A group adventure that is closed because its group ended stops all traffic for it.

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

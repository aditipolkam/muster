# ADR 0012: The published SDK 0.32.0, and join requests admitted by the SDK at once

Status: Accepted (2026-11-08). Logic covered by `__tests__/groupsJoin.test.ts`; not yet verified on devices. Supersedes the `file:` dependency of ADR 0006 and amends the join step of ADR 0007.

## Context

Joining a group did not work on devices: the request did not show up on the organizer's phone. Four causes were found, one in the build and three in the app.

1. **The app did not run the published SDK.** `package.json` named `^0.32.0`, but the lockfile still held the `file:` link (`"link": true`), so `npm install` kept `node_modules/@offline-protocol/mesh-sdk` as a symlink to the SDK checkout. That checkout's natives (`ios/libs`, `android/.../jniLibs`) were built on 2026-10-31, before the 0.32.0 release and its Bluetooth LE fixes. Its tracked `ios/Generated` glue was at a later commit.
2. **The SDK rejects an unanswered request after 60 s** (`approval_timeout_ms` under the `restricted` policy). The app held the SDK request until the organizer pressed Approve, so a card that sat for a minute was already dead, and its `ended` event removed it.
3. **The organizer's job queue was flooded.** Every mesh snapshot change (each SDK diagnostic, RSSI reading and link refresh) queued a full resume (SQLite reads, a subscription check per member and channel). A `service_subscribe_received` waited behind them, often past the 60 s.
4. **Retries never left the phone, and discovery crowded the link.** `PubSub.subscribe` returned the id of an ended subscription instead of subscribing again, so a second "Join" after a failed one sent nothing. The organizer refused beacon subscriptions while closed, and the joiner subscribed again on every reconcile, a stream of sealed subscribe frames over the same Bluetooth link the join needs.

The SDK calls themselves matched the 0.32.0 API, docs and native bridges.

## Decision

- Depend on the published package, pinned: `"@offline-protocol/mesh-sdk": "0.32.0"`, installed from the registry (no symlink; `metro.config.js` then overrides nothing). Switch with `scripts/sdk-source.sh`, which rewrites the lockfile, never by editing `package.json` alone.
- A valid join request (known token, or nearby window open) is **accepted at the SDK at once**. The organizer's decision is the app's: Approve publishes the welcome on the request's token topic; Decline calls `endServiceSubscription`. The topic carries nothing but the welcome, so admission gives the joiner nothing.
- The organizer keeps the admitted, undecided requests; one whose subscription ends (joiner cancelled, lease lapsed) is dropped, and approving it adds no one (`groups.request_expired`).
- Resume runs only when the lifecycle, the local address or the set of nearby peers changes, and triggers that arrive while one is queued share it.
- `PubSub.subscribe` subscribes again when the tracked subscription has ended. A joiner unsubscribes its join topic once it is in, and forgets an attempt that ended.
- A join attempt the SDK ends for want of an answer (`session_timeout`, `no_reply`, `provider_unreachable`) is asked again, for up to 10 minutes from the first try; the organizer keeps one card per person, the newest. On devices, an Android joiner reaching an iPhone organizer took 3-4 minutes, longer than the SDK's 120 s pending timeout, because the Android-to-iPhone direction delivers each Bluetooth indication with no confirmation (`Notification flushed` never logged, so every fragment waits for the 250 ms watchdog) and the first MLS handshake is several KB. The session the first attempt built survives, so the retry's small subscribe frame gets through quickly. The slow direction itself is an SDK defect, not fixed here.
- Beacon subscriptions are always accepted; the beacon is published only while open. `ensureSub` never re-subscribes a nearby provider within 10 s of the last try, a far one within 60 s.

## Consequences

- A request waits for the organizer as long as the joiner stays and renews; the 60 s limit no longer applies.
- An admitted join subscription counts against the SDK caps (16 per peer, 256 per provider) until it is decided or ends. Accepted beacon followers count too (one per nearby joiner).
- A new SDK version is a deliberate bump of the pin, then `pod install` and a native rebuild.
- The orphaned untracked files from the 2026-11-04 stashes (`__tests__/groupsHandshake.test.ts`, `src/features/mesh-diagnostics/report.ts`, and others) still depend on stashed code and do not compile; they are not part of this change.

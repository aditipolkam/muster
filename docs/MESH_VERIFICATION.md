# Verifying the mesh on two physical devices

Simulators and emulators cannot do Bluetooth LE. Nothing below has been run yet; the results table at the end is empty on purpose. Do not describe mesh behaviour as working until a row is filled in.

## Setup

1. Two phones with the TrailMesh debug build (any OS pair). Record model and OS version.
2. Install, then open the app once per phone **with internet on** so Metro can serve the bundle, or use a release build. After the JS bundle has loaded, enable **airplane mode, then switch Bluetooth back on** (airplane mode turns it off). Wi-Fi stays off.
3. iOS: accept the Bluetooth prompt the first time you start the mesh. Android 12+: accept Nearby devices; on Android 11 and lower accept Location. Android 13+: allow notifications so the foreground-service notification is visible.
4. Open the **Mesh** tab on both phones. Keep both in the foreground, screens on, 1-3 m apart.

## Procedure

| # | Step | Expected | Record |
|---|---|---|---|
| 1 | Both: **Start mesh** | Badge `Running`, Bluetooth `on`, an `off1…` address. Note the address; kill and relaunch, start again: same address | address stable? |
| 2 | Wait up to 30 s | Each phone lists the other under *Nearby devices* (`Nearby`, then `Connected` once the SDK reports a link), with RSSI | time to discovery |
| 3 | Move one phone away until it is lost (or switch its Bluetooth off) | Peer flips to `Lost`; returns to `Nearby` when back | loss distance / time |
| 4 | A: **Start publishing**, policy *Ask me* | A shows `Publishing` | |
| 5 | B: tap **Subscribe to this device** on A's row | B shows the subscription `pending`; A shows an *wants to subscribe* request (first contact may wait for the 1:1 session, up to 120 s) | time to request |
| 6 | A: **Accept** | B's subscription becomes `active` | |
| 7 | A: type `one`, **Publish event** | A: `Handed to mesh` with live/queued counts. B: *Received* shows `ping: one` exactly once | delivered? latency |
| 8 | A: **Publish event** three times quickly | B receives three, none flagged `Duplicate` | |
| 9 | A: **Publish state** twice (`a`, `b`); B subscribed in *State (latest)* mode | B ends with `b`; `a` may be skipped (latest wins) | |
| 10 | B: **Unsubscribe**; A publishes | B receives nothing; B's subscription row is gone | |
| 11 | B backgrounds the app 30 s, A publishes, B returns | Message arrives once or is absent; never twice. Note which | |
| 12 | A: **Stop** mesh, then **Start** again, republish | B resubscribes (watch state), then receives | does re-subscribe work after provider restart? |
| 13 | Android only: swipe the notification's **Stop** | Badge `Stopped from notification`, peers `Lost`; **Start mesh** recovers | |
| 14 | Toggle Bluetooth off then on while running; return to the app | State reconciles (badge / Bluetooth status correct, no stuck `Running`) | |
| 15 | Deny the permission prompt, then retry | Clear message, no crash, recoverable through system settings | |

Also confirm offline: with internet disabled the run above must work identically. Check the *Errors and SDK diagnostics* card for `native_event_gap` warnings and note them.

## Results

| Date | Devices (model, OS) | Steps passed | Observations / failures |
|---|---|---|---|
| | | | |

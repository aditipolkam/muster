# Phase 3 verification on physical devices

None of this has been run. The automated tests use `FakeMesh` (an in-memory radio) and prove the application logic, not Bluetooth. Run on real phones with Wi-Fi and mobile data **off**. Use at least one iPhone and one Android phone; one test needs four devices.

Preparation: build and install the app on every device, grant Bluetooth, location and (for scanning) camera. Open the **Groups** tab; if the banner says "Mesh is off", tap **Start mesh**. Note the build id on each device. Record results in the table at the end.

| # | Test | Devices | Steps | Pass when |
|---|---|---|---|---|
| G1 | Create a group | 1 | Groups > Create group, enter names | Group listed as Organizer; roster shows you; survives app kill and relaunch |
| G2 | Join by QR (approval) | 2 | A: Group Details > Show invitation QR. B: Join group > Scan QR code > Join. A approves | B reaches Group Details within 60 s; both rosters list both people with the same names |
| G2b | Late approval (ADR 0012) | 2 | As G2, but A waits 2 minutes before approving | The card stays on A; B still shows "Waiting"; after Approve B joins. Cancel on B instead removes the card on A |
| G3 | Join by QR (auto-approve) | 2 | As G2 with the auto-approve switch on | No prompt on A; B joins |
| G4 | Three joiners, mixed OS | 4 | Repeat G2 for three phones | Rosters identical on all four |
| G5 | Reuse and expiry | 3 | After G2, scan the **same** QR on a third phone. Separately wait past expiry (or set the clock forward on A) | Third phone is refused and never appears in A's roster; expired code refused |
| G6 | Nearby discovery | 2 | A: switch on "Let people nearby ask to join". B: Join group, wait on the Nearby list, Ask to join. A approves. Switch off on A and retry from a third phone | Group appears on B within ~30 s; join needs approval; after closing, no beacon and requests are refused |
| G7 | Camera permission | 1 | Deny camera on B, tap Scan | Clear explanation, paste-link field still works; no crash |
| M1 | Share a meeting point | 2 | A: group page > Share location > Send your current location (also try Choose on the map and a saved place), name + note, Share with the group | Appears on B's map at the same place within 10 s (direct link); B's sheet shows the name, note, "shared by A" |
| M2 | Update and move | 2 | A: Edit name/note; then Move | B shows the new values and position; details screen says "Updated by A (version n)" |
| M3 | Remove | 2 | A: Remove | Gone from B's map and list |
| M4 | Acknowledge | 3 | B and C: Acknowledge | A's Meeting Point screen lists B and C as Acknowledged; B does not see C's acknowledgment (by design) |
| M5 | Two hops | 3 | Place A and C out of range of each other, B between | Point reaches C within 60 s (record actual time) |
| M6 | Offline member returns | 3 | B turns Bluetooth off 10 minutes; A adds, edits, removes points; B turns it on | B converges without any action (record time; also try "Sync now") |
| M7 | Acknowledge while out of range | 2 | B acknowledges while out of A's range, then walks back | Shown as "not delivered yet", then delivered; A lists B |
| M8 | Unauthorized | 2+ | From a modified build or a second app on the same service, try to publish a point as a member, and to follow a group's `point` topic as a non-member | Not displayed by members; the request is refused (log line, no coordinates) |
| M9 | Kill mid-update | 2 | A: kill the app right after Share | After relaunch the point is still on A; B gets it once A is back in range |
| L1 | Leave | 3 | B: Leave group | B's group and points gone; A and C show B as Left |
| L2 | Remove | 3 | A: Remove C | C is told and its group disappears |
| L3 | End group | 3 | A: End group | B and C show "Ended by organizer"; its points leave the map |
| L4 | Limits | 13 | (optional) join 12 members, then try the 13th | 13th refused |
| P1 | Permissions/battery | 2 | Background the app for 5 min, return | Mesh reconciles (Mesh tab), subscriptions come back, no duplicate notifications |

## Things to record (they close assumptions)

- A-19: when A accepts a subscription, does A's app receive `service_subscription_changed` with `role: provider, state: active`? (The welcome and state push depend on it; if not, the join stalls at "Waiting".)
- A-20: is `provider`/`sender` always the real peer (try two devices with the same display name)?
- A-21: does subscribing work to a provider two hops away? How long does a first subscription take?
- A-22: is `service_subscribe_received` raised for every new subscription and for a renewal after a lease lapses (a member that stays away > 2 min)?
- A-23: `registerService('tm.group.1', '1')` accepted on both OSes?
- A-24: QR of ~200 characters scans reliably on both OSes at arm's length in sunlight and at night.
- Does the SDK send a snapshot to a new `latest` follower by itself (then the first state arrives twice and is deduplicated)?

## Results

| Date | Test | Devices (model, OS, build) | Result | Time | Notes |
|---|---|---|---|---|---|

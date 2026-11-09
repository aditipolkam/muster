# Adventures and achievements: features

What a person can do, screen by screen. Everything works with no internet. **Nothing in this document has been run on a physical device**; see `GAMIFICATION_TEST_REPORT.md` for what was tested and what is still open.

## Where it lives

- **More > Adventures**: the list (planned and active) and the Journal (finished), plus the Achievements entry.
- **Map**: while an adventure is in progress, a compact card shows its name, "N of M checkpoints", distance and the clock; tapping it opens the details. Checkpoints and the recorded route are drawn on the map. Long-press the map and choose "Checkpoint: <adventure>" to add one where you pressed.
- **Group > group page**: an Adventures card (and, for the organizer, "Plan a group adventure").
- **Navigate**: "Navigate here" on a checkpoint opens the existing straight-line screen.
- **Settings > Adventures**: the arrival radius.

The four tabs are unchanged and the map remains the main screen.

## Screens

| Screen | What it does |
|---|---|
| Adventures | Planned and active adventures with status, "N of M checkpoints" and Solo/Group; Journal tab for finished ones; "New adventure"; entry to Achievements ("3 of 13 earned") |
| New / edit adventure | Name, optional description, optional starting location (use my location, or one of your saved places; add a label), and, if you organize an active group, "Just me" or the group |
| Adventure details | Status; **your progress** (elapsed, distance, remaining, "3 of 5 checkpoints explored", animated bar); for groups, how many checkpoints everyone has reached; start, pause, resume, finish, cancel; checkpoint list with Reached / Next; badges earned on this adventure; for groups: current meeting point, participants (joined / left), activity timeline; Edit, Show on map |
| Checkpoint editor | Name, kind, description, position (use my location, or the map point it was opened from), safety note |
| Checkpoint details | Kind, status ("Reached 10:42, detected by GPS" or "confirmed by you"), straight-line distance and direction, who reached it (groups), "Navigate here", "I have arrived" (manual confirmation), edit and remove (organizer / owner) |
| Recap (Adventure summary) | Name, date, time moving, distance (or "Not recorded"), checkpoints, people, route sketch and "View on map", checkpoint list, for groups who took part and how many checkpoints everyone reached, group meeting points, milestones unlocked, a personal note, delete from journal |
| Achievements | 13 badges in three groups. Unlocked: description and date. Locked: exactly what unlocks it, with progress where it is a count |

## Lifecycle

`Planned -> Active <-> Paused -> Completed`, and `Cancelled` from any open state.

- Solo: you control it. Only one solo adventure runs at a time (pause one to start another).
- Group: the organizer controls it; everyone else *joins* (and may *leave* any time). The adventure's clock runs for you only while it is active **and** you have joined.
- Finishing or cancelling early is always fine; the record stays in the journal. Time spent paused is never counted and never counted against you.
- If the group ends or you leave it, the group adventure is closed on your phone (the clock stops, the record stays).

## Checkpoints and arrival

- Kinds ("icons"): Trail entrance, Viewpoint, Waterfall, Campsite, Rest stop, Summit, Final destination, Other. At most 20 per adventure.
- Arrival is automatic when you are inside the radius with a good GPS fix on two readings at least 3 seconds apart. A weak fix never marks it; you get "Near <name>. GPS is too weak to confirm" and an "I am here" button. You can always confirm by hand while the adventure is running; from far away you are asked once.
- A quiet banner says "Approaching <name>" (about four radii out) and "Reached <name>". There is no countdown, no timer and no prompt to hurry.
- Safety: the editor and details screens say a checkpoint is only a place you chose and that Muster cannot know about closures, private land, weather or terrain.
- The radius (15 to 150 m, default 30 m) is in Settings.

## Milestones (13)

| Group | Badge | Unlocks when (recorded on this phone) |
|---|---|---|
| Exploration | First Adventure | Complete your first adventure |
| | Trail Starter | Complete three |
| | Explorer | Complete ten |
| | First Summit | Complete an adventure in which you reached a Summit checkpoint |
| | Trail Collector | Reach ten different checkpoints |
| | Weekend Wanderer | Complete adventures on three different weekends |
| Together | First Expedition | Complete an adventure that two or more people took part in |
| | Together We Go | Complete five group adventures |
| | Rally Point | A meeting point you shared was acknowledged by another member, or you acknowledged one shared with you |
| | Trail Companions | Complete two or more adventures with the same group |
| Off the grid | Off the Grid | Complete a 30-minute adventure on downloaded maps during which Muster used no network |
| | Mesh Connected | During an adventure, receive a message from a group member over the mesh |
| | Local Explorer | Complete an adventure whose places are all inside your downloaded map regions |

"Complete" means *completed and qualifying*: you reached a checkpoint, or ran at least 20 minutes and 300 m. Starting and immediately finishing earns nothing, and cancelled adventures never count. Distance alone is never a reward. There are no streaks, no ranking and no comparison with other people. Badges are computed on your phone from your own records and are **not independently verified**; the screen says so.

Not claimed: that a message was delivered because it was sent (Mesh Connected needs one *received*), or that the phone had no signal (Off the Grid means Muster itself used no network).

## Group adventures

- The organizer plans it (name, checkpoints, start/finish). Members see it when in range and choose to join. Nobody is enrolled automatically and no position is shared.
- Progress is shown two ways: yours ("3 of 5 explored") and the group's ("2 of 5 reached by everyone who joined").
- When someone reaches a checkpoint the others get "<name> reached <checkpoint>" and the timeline gains a line. When everyone who joined has reached one: "Everyone has reached <checkpoint>".
- Your arrival shows "The organizer has it" only once the organizer's relay of it came back; until then "Waiting to reach the organizer".
- A shared activity timeline (planned, started, joined, reached, finished) is built from stored state, so every phone with the same state shows the same list. If you were out of range you see a shorter list until you reconnect; the screen says a missing line means "not received yet".
- Reconnection: when you come back in range your phone asks the organizer for what you missed and the organizer pushes it; your own unconfirmed arrivals are re-sent.

## Celebration (small, optional, never in the way)

| When | What |
|---|---|
| Checkpoint reached | One-line banner; the marker swells for under a second; a soft ring on the checkpoint screen |
| Progress changes | The bar eases |
| Badge earned | One-line banner on the map; on the Achievements screen it fades in with a "New" marker |
| Adventure finished | The recap fades in section by section |

Everything is skipped when the system asks for reduced motion. Nothing animates on the map beyond the three-step marker swell, and nothing covers your position, GPS or mesh status.

## Privacy

Your route, distance, notes and journal stay on the phone. Nothing is shared except what a group adventure needs: the organizer's plan (name, checkpoints, status) goes to members, and each person's arrivals (checkpoint and time, never a position) and joined/left go to the organizer, who relays them to the people who joined. There is no public sharing, no leaderboard and no cloud backup. "Delete from journal" removes an adventure from the device; badges stay.

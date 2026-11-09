# 0010. General offline location sharing, five tabs

Status: accepted (2026-11-03)

## Context
Muster was framed as a hiking app. The mesh, maps, GPS, group state and meeting points are not hiking specific, and the unique value is "see your people with no internet", which applies to festivals, convoys and travel as well.

## Decision
- Architecture and domain naming stay purpose-agnostic. Hiking remains the marketing story and the first audience. Adventures, checkpoints and badges are an optional mode, not part of the core group model.
- Tabs: Compass, Activity, **Map** (centre, launch tab), Groups, Profile. Settings is an icon on Profile.
- Identity (name, photo) lives only in Profile. Group create and join read `profile.name` and never ask for a name.
- The profile photo is local to the device and is not replicated over the mesh.
- Deferred by decision: offline routing (navigation stays straight line) and short text messages (group Updates stay events only).

## Consequences
- Deep links `muster://maps`, `saved`, `mesh`, `settings` now resolve under Profile; `adventures`, `achievements` under Activity.
- BLE range still limits this to nearby people; user-facing copy must not promise remote tracking.
- A stronger consent model (visible sharing state, easy leave) matters more for a general audience.

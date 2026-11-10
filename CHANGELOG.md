# Changelog

All notable changes to Muster are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [0.1.0] - Unreleased

The first public version.

### Added
- Offline maps: download a region from a catalog, or cut a custom area on the map, and use it with no connection. Development builds stream a map while no region is downloaded.
- Groups over the Offline Protocol Bluetooth mesh. Join face to face with a QR code. The leader publishes meeting points and updates, and followers receive them.
- Live positions of group members in mesh range, with stale positions marked.
- Meeting points, saved places and dropped pins, each with a sheet to start navigation.
- Navigation with a map view and a compass view, distance and bearing, and offline walking routes along paths in downloaded maps, with a straight-line fallback that says why.
- Place search (needs internet, only when the user searches).
- Group trip map: the leader can attach an offline map area that members download.
- Adventures with checkpoints and badges. Group activities (phases and per-person runs) are built but switched off.
- Mesh diagnostics screen.
- Pill design system: shared tokens and components, SF Symbols on iOS, no shadows.

### Notes
- Uses `@offline-protocol/mesh-sdk` 0.32.0, which lacks an unreleased session-probe back-off fix.
- Release builds need a self-hosted map catalog.

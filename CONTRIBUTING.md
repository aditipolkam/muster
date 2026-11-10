# Contributing to Muster

Thanks for helping. Muster is an offline group navigation app. Its core features must work with no internet, so read the rules below before you change behaviour.

## Setup

Follow [Getting started](README.md#getting-started) in the README. In short:

```bash
npm install --legacy-peer-deps
cd ios && pod install && cd ..
npm run ios   # or: npm run android
```

The app uses the published `@offline-protocol/mesh-sdk`, pinned to an exact version. To work against a local SDK checkout at `../offline-protocol-sdk` instead, run `scripts/sdk-source.sh local`, and `scripts/sdk-source.sh npm <version>` to go back. Metro detects the local link by itself. `MUSTER_SDK=local|npm` forces a mode, and `TRAILMESH_SDK` is a legacy alias for it.

## Checks

Run these before you open a pull request. CI runs them too.

```bash
npm run typecheck
npm run lint
npm test
```

## Testing on devices

Simulators and emulators have no Bluetooth, so they can't test the mesh. Anything that touches groups, live positions or meeting points needs at least two physical phones. In your pull request, say what you tested and on which devices. If you couldn't test something on a device, say that too.

## Rules that are easy to break

- **No network in core paths.** Navigation, location, mesh and storage code never call the network. Only `src/features/maps-manager` may, and only when the user asks.
- **Only the leader publishes.** A group's leader shares meeting points and updates. Followers only receive them, so don't add share, post or acknowledge actions for followers.
- **State is the truth, messages are hints.** Don't make correctness depend on a group message arriving.
- **One writer per key.** A member writes only its own `m.<address>` document.
- **Only `src/mesh/sdk.ts` imports the SDK.** Everything else uses `MeshPort`. Don't invent SDK APIs: every call must exist in the SDK's published types.
- **Domain code is pure.** `src/domain` imports nothing from React Native, the SDK or features.
- **Privacy.** Never log coordinates at info level or above, and never enable the SDK's telemetry.
- **Maps.** Never use the public OpenStreetMap tile servers for downloads, and keep "© OpenStreetMap contributors" visible on every map.
- **UI.** Use the tokens and components in `src/ui` (see [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)) instead of one-off colours or sizes.

[CLAUDE.md](CLAUDE.md) has the full list. It is written for contributors and AI coding agents alike.

## Commits and pull requests

- Use [conventional commits](https://www.conventionalcommits.org), all lowercase: `fix(groups): ...`, `feat(map): ...`, `docs: ...`.
- Keep pull requests small and focused. Add or update tests for logic changes.
- Record lasting design decisions as an ADR in `docs/adr`.

## Forks

If you ship your own build, change the mesh `meshAppId` and the place-search `userAgent` in `src/shared/config.ts`, the bundle ID `app.muster` (Xcode project and `android/app/build.gradle`), and the Apple `DEVELOPMENT_TEAM` in `ios/Muster.xcodeproj/project.pbxproj`. Otherwise your app will share a mesh network with Muster and fail to sign.

## Licence

By contributing, you agree that your contributions are licensed under the [AGPL-3.0-only](LICENSE) licence.

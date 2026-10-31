# ADR 0002: Style assets and world base embedded as generated base64 modules; world base is z0-3

Status: Accepted (Phase 1)

## Context

`MAP_ARCHITECTURE.md` 3.2 requires glyph PBFs, sprites and a world base archive on the filesystem (`file://`), because MapLibre Native must read them and Android cannot byte-range APK assets. They have to be shipped inside the app and copied out on first launch.

Options: (a) Metro assets + `expo-asset`, (b) native bundle folders (Xcode folder reference, Android `assets/`) with a native copy step, (c) generated TypeScript modules holding base64 and written out with the file system API.

(a) behaves differently between debug (served by Metro) and release (embedded resources) and differs between iOS and Android; it could not be verified on Android in this environment (no emulator/device). (b) needs custom native code on both platforms.

## Decision

(c). `scripts/gen-style-assets.mjs` reads Protomaps `basemaps-assets` (Noto Sans OFL fonts, sprites) and a world PMTiles and emits `src/assets/generated/{styleAssets,worldBase}.ts`. `ensureStyleAssets` decodes and writes them to `documents/style/`, keyed by a version stored in `kv`, repairing missing files on later launches. The modules are `require`d lazily, only when a copy is needed.

Glyph ranges are limited to Latin, Latin-extended, combining marks, Cyrillic, extra Latin, general punctuation and letterlike symbols. Labels in other scripts (CJK, Arabic, Devanagari, ...) will not render offline until more ranges are added.

World base is **z0-3, 2.4 MB**, not the z0-5 the doc assumed. Measured: z0-5 is 15 MB, z0-4 is 6 MB, z0-3 is 2.4 MB. Base64 inflates it to 3.2 MB of JS string. World layers stop at zoom 6 (overzoomed), so above z4 outside an installed region the map is a plain background with coarse context and the "No offline map for this area" banner.

## Consequences

- One code path on both platforms; unit-testable with an in-memory file system.
- ~6.4 MB of generated source in the JS bundle (loaded lazily). If this proves heavy on device, move to option (b).
- Update `MAP_ARCHITECTURE.md` 6 ("world base z0-5 (a few MB)") with the measured numbers.

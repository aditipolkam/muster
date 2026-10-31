# ADR 0005: Location via expo-location, foreground only (provisional)

Status: Provisional. Spike S1-4 / A-15 needs devices.

## Decision

`LocationPort` with an `expo-location` adapter (`watchPositionAsync`, High accuracy, 2 s / 1 m filter; `watchHeadingAsync` throttled to ~5 Hz / 2 degrees). Foreground permission only; no background modes.

## Known limits

- expo-location does not report iOS "reduced accuracy" authorization. Phase 1 infers "approximate" from a fix accuracy of 1000 m or worse (`effectivePermission`). A native check of `accuracyAuthorization` would be exact.
- Android coarse-only is read from `android.accuracy === 'coarse'`.
- "GPS lost" is derived: no fix newer than 15 s. The OS may simply not deliver updates while the device is stationary with a distance filter; the 1 m filter plus 2 s interval keeps this unlikely outdoors, but confirm on devices.
- Cold-start time to first fix is unmeasured.

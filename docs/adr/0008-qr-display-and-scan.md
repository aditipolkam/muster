# ADR 0008: QR invitations (qrcode-generator, expo-camera)

Status: Accepted (Phase 3). Scanning not verified on devices.

- **Display:** `qrcode-generator` (pure JavaScript, no dependencies) draws the matrix as React Native views, error correction M. No native module, works offline.
- **Scan:** `expo-camera` (`CameraView`, QR only) as an Expo module on the existing bare app (SDK 54 line, ~17.0.10). iOS gets `NSCameraUsageDescription`; Android declares `CAMERA` and removes the `RECORD_AUDIO` permission the library also declares. The camera is opened only on the Join screen, after the user taps "Scan QR code".
- **Fallback:** the Join screen also accepts a pasted `trailmesh://join?...` link and the app registers the `trailmesh://join` deep link, so a failed scan does not block joining.
- Nothing is recorded or sent; the scanner reports the first code and stops.

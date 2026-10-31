# ADR 0004: Resumable downloads implemented with expo/fetch streaming and an append-only .part file

Status: Accepted (Phase 1); device behaviour unverified.

## Context

The download must survive app kill and network loss (AC2). `expo-file-system`'s `createDownloadResumable` keeps resume data only in memory on iOS, so a killed process cannot resume. Native background `URLSession` downloads would work but need native code.

## Decision

`MapPackManager` streams the response from `expo/fetch` (`ReadableStream`) and appends each chunk to `maps/<id>.pmtiles.part` through `File.open()` / `FileHandle.writeBytes`. Resume sends `Range: bytes=<size of .part>-`, expecting `206` with a matching `Content-Range`; a `200` restarts from zero, a `416` discards the part. Progress is persisted to SQLite every ~1 MiB. On launch, rows left in `downloading`/`verifying` become `paused` (code `interrupted`) with the `.part` file kept. After download: size check, streaming SHA-256 (1 MiB reads, `@noble/hashes`, pure JS), PMTiles header validation, atomic rename.

Space guard: refuse if free space < 1.2 x remaining bytes.

## Consequences

- Same code path on iOS and Android; fully unit-testable with fake HTTP and file system (including mid-stream failures, ignored Range, corrupt payloads).
- Foreground only: iOS suspends the app in the background, so a download pauses until the app returns (it resumes via the interrupted state). True background transfer is a Phase 6 item.
- JS hashing is slow on Hermes (no JIT). Measure on the reference device; if verifying a 200 MB region takes too long, replace `sha256File` with a native hash module.
- Throughput through the JS bridge for ~200 MB is unmeasured on a device.

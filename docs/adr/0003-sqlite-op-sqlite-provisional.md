# ADR 0003: SQLite driver is op-sqlite behind DbPort (provisional)

Status: Provisional. Spike S1-3 benchmark **not run**.

## Context

`ARCHITECTURE.md` lists `@op-engineering/op-sqlite` (preferred) and `expo-sqlite` (alternative), with the final pick to be made from a device benchmark (10k inserts, 1k-row reads, concurrent writes).

## Decision

Ship Phase 1 on `@op-engineering/op-sqlite` 19.0.3. All access goes through `DbPort`; `createSerialDb` adds the single write queue (so a driver swap changes one file, `src/data/opSqliteAdapter.ts`). Migrations, repositories and the write queue are tested against real SQL using Node's built-in SQLite (`src/testing/nodeSqlite.ts`), not against op-sqlite itself.

## Evidence so far

- op-sqlite compiles and links into the iOS app (debug, simulator). Behaviour on device is exercised by the Maestro/simulator run recorded in `PROGRESS.md`.
- No benchmark numbers exist. S1-3 stays open until run on the device matrix.

## Consequences

If the benchmark or New Architecture stability favours `expo-sqlite`, write a second adapter and flip it in `bootstrap.ts`.

# SQLite Storage Pass — 2026-03-12

## Scope

This pass was limited to implementing SQLite behind the existing storage interface for the active DOM collection path.

Non-goals:

- no new backend beyond SQLite
- no storage redesign for the legacy snapshot commands
- no attempt to migrate every historical artifact in `data/`

## What Changed

- Added `src/storage/sqlite-storage.js` as the active storage implementation.
- Switched `src/storage/storage.js` to instantiate SQLite by default.
- Added explicit schema bootstrap via SQL migrations under `src/storage/migrations/`.
- Set the DOM storage database path to `data/storage/nyc-housing-scout.sqlite`.
- Kept raw artifacts on disk and stored only artifact references plus metadata in SQLite.
- Preserved the existing storage interface methods:
  - `getOrCreateSource(...)`
  - `beginRun(...)`
  - `recordObservationBatch(...)`
  - `recordListingsBatch(...)`
  - `appendRunStep(...)`
  - `finishRun(...)`

## SQLite Schema

The first migration creates tables for:

- `sources`
- `crawl_runs`
- `crawl_run_steps`
- `stable_posts`
- `post_observations`
- `listing_records`
- `artifact_refs`
- `storage_counters`
- `schema_migrations`

Design choices in this pass:

- source-scoped stable post identity is keyed by `(source_id, platform_post_id)`
- listing rows keep a few queryable columns plus full `payload_json`
- observations keep full `payload_json` plus parsed metadata columns
- raw payload blobs remain on disk; SQLite stores `relative_path`, `sha256`, `byte_size`, and metadata
- database bootstrap enables foreign keys and WAL mode

## Behavior Preserved

- source registration and update semantics
- run start / finish tracking
- fresh / seen / unidentified observation classification
- source-scoped seen-post tracking
- durable run-step checkpoints
- listing persistence only for the caller-provided batch
- collected/listing export artifact references attached to the run

The legacy snapshot path remains unchanged and still uses its older flat-file behavior.

## Tests

Updated `test/storage-interface.test.js` to assert SQLite-backed behavior directly.

Coverage added in this pass:

- source / run / observation / listing / artifact persistence in SQLite
- migration bootstrap
- persisted seen-post state across database reopen
- source-scoped identity semantics for the same `postId` across different sources

## Follow-Up

Recommended next work:

1. Add small read/query helpers for recent runs, observations, and listings so debugging stops depending on raw SQL.
2. Decide whether the old file-backed placeholder should be deleted once the DOM path has soaked on SQLite.
3. Add fixture-backed tests that run the DOM commands end-to-end against captured inputs and assert DB state plus exported artifacts.

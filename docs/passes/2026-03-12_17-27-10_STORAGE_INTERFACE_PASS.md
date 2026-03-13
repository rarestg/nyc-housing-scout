# Storage Interface Pass — 2026-03-12

## Scope

This pass was intentionally limited to the storage interface layer.

- no SQLite implementation yet
- no new backend preparation beyond the interface boundary
- focus on the active DOM collection path

## What Changed

- Added a narrow storage layer under `src/storage/`.
  - `src/storage/storage.js` now exposes the storage factory used by the app.
  - `src/storage/file-storage.js` is a pragmatic file-backed placeholder implementation.
- Defined domain-shaped storage operations instead of generic repositories.
  - source registration / lookup
  - run start / finish
  - collected-post observation persistence
  - source-scoped stable seen-post tracking
  - listing persistence
  - run-step checkpoint persistence
  - artifact reference persistence
- Rewired the active DOM commands to use the storage interface.
  - `capture:dom`
  - `crawl:dom`
- Switched DOM artifact layout from capture-method-scoped paths to source-scoped paths.
  - raw: `data/raw/facebook/<sourceKey>/<runId>/...`
  - collected exports: `data/collected/facebook/<sourceKey>/...`
  - listing exports: `data/listings/facebook/<sourceKey>/...`
- Added artifact metadata capture for stored references.
  - relative path
  - byte size
  - sha256
- Extended collected-post and listing source metadata with `sourceKey`.
- Added tests that lock the storage contract for fresh / seen / unidentified observation handling and file-backed persistence.

## Storage Interface Shape

The implemented boundary is intentionally small:

- `getOrCreateSource(...)`
- `beginRun(...)`
- `recordObservationBatch(...)`
- `recordListingsBatch(...)`
- `appendRunStep(...)`
- `finishRun(...)`

This keeps the next pass focused. SQLite only needs to replace the implementation behind these operations.

## Current Placeholder Implementation

The temporary implementation is a single JSON catalog:

- `data/storage/catalog.json`

It stores:

- sources
- runs
- run steps
- artifact refs
- stable posts
- collected-post observations
- listing rows

This is not the intended long-term store. It exists so the application has one coherent persistence boundary before the SQLite pass lands.

## Integration Notes

- Raw artifacts are still written to disk first.
- The storage layer records references to those files rather than inlining raw payload blobs.
- DOM crawl checkpoints are now persisted during the run instead of only appearing in final console output.
- The legacy snapshot commands remain debug/fallback tools and still use their older ad hoc persistence path.

## Deliberate Non-Goals

- no SQLite schema or migrations
- no `node:sqlite` wiring
- no change to the legacy snapshot path beyond keeping it compatible
- no extractor redesign beyond the small `sourceKey` metadata addition

## Next SQLite Pass

The next pass should implement a SQLite-backed version of the same storage interface and migrate the DOM path to it without changing command behavior.

Concrete work for that pass:

1. Add a SQLite storage implementation behind `src/storage/storage.js`.
2. Create the SQLite schema for sources, crawl runs, run steps, artifact refs, stable posts, observations, and listing records.
3. Preserve the existing interface semantics for fresh / seen / unidentified classification.
4. Keep raw artifacts on disk and store only references + metadata in SQLite.
5. Replace the file-backed catalog as the active implementation for the DOM path.

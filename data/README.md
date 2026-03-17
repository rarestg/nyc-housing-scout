# `data/`

This directory holds local runtime artifacts and the SQLite store.

The important split is:

- `data/storage/nyc-housing-scout.sqlite` is the canonical system of record.
- JSON files under `raw/`, `collected/`, and `state/` are inspectable local artifacts.
- `listings/`, `normalized/`, and older `facebook-dom` trees are historical outputs from earlier collector shapes.

## Current Write Path

1. Collection reads Facebook from the attached authenticated browser tab.
2. Raw browser payloads are written under `raw/facebook/<sourceKey>/<runId>/...`.
3. Those payloads are normalized into canonical collected posts, including identity/provenance fields and `derivedLocation`.
4. Collection persists runs, run steps, observations, and artifact refs in SQLite.
5. Collection exports collected-post bundles under `collected/facebook/<sourceKey>/...`.
6. `ingest:loop` writes local runtime state under `state/ingest-loop/`.
7. Queue, processing, evidence, resolution, and review stages all read and write through SQLite:
   - `processing_jobs`
   - `processed_payloads`
   - `listing_records`
   - `evidence_fragments`
   - `resolved_fields`
   - `manual_overrides`
   - `audit_events`

There is intentionally no active `data/processed/` directory and no active collection-time `data/listings/` write path.

## Naming

- `capture-<runId>.json` — one visible feed slice, no scrolling loop
- `crawl-<runId>.json` — multi-step crawl with stop conditions and step metadata
- `runId` — ISO timestamp with `:` and `.` replaced by `-`
- raw artifact filenames usually look like `<postId>-<captureIndex>.json`
- if the collector cannot recover a stable `postId`, raw artifact filenames fall back to author/dedupe text such as `Grace-Ahn-010.json`

## Current Layout

### `cache/`

- `cache/gemini/gemini.env`
  - local env file for `GEMINI_API_KEY` / `GOOGLE_API_KEY`
  - auto-discovered by `process:jobs` and `gemini:extract` if you do not pass `--env-file`
- `cache/gemini/sample-response.json`
  - saved Gemini envelope for schema/debug work
  - useful for inspection, not canonical state
- `cache/seen-post-ids.json`
  - legacy freshness cache from older collectors
  - not the active freshness mechanism for the DOM + SQLite path

### `raw/`

Current active path:

- `raw/facebook/<sourceKey>/<runId>/<artifact>.json`

Typical contents:

- DOM-origin post payloads before collected-post normalization
- startup/final network-capture exports such as `network_capture_export`
- bounded GraphQL envelope data used for CDP-assisted recovery

These files are used to:

- build canonical collected posts
- register `artifact_refs`
- preserve raw provenance for later debugging

Legacy trees still present:

- `raw/facebook-dom/...`
- `raw/facebook-group/...`

Some of those older files are already partially derived and may include fields such as `derivedLocation`, inline `listings`, or other collector-era annotations.

### `collected/`

Current active path:

- `collected/facebook/<sourceKey>/capture-<runId>.json`
- `collected/facebook/<sourceKey>/crawl-<runId>.json`

These files contain arrays of canonical collected posts. Common fields include:

- `dedupeKey`
- `platform`
- `sourceKey`
- `groupName`
- `groupId`
- `groupUrl`
- `postId`
- `postUrl`
- `storyId`
- `feedbackId`
- `authorName`
- `authorId`
- `authorUrl`
- `postedAtText`
- `postedAtTimestamp`
- `postedAtIso`
- `bodyText`
- `comments`
- `media`
- `attachmentSummary`
- `captureMethod`
- `captureRunId`
- `captureIndex`
- `capturedAt`
- `rawArtifactPath`
- `derivedLocation`
- `captureHints`

These exports are the easiest on-disk view of what collection normalized, but the canonical durable copy is the matching `post_observations` row in SQLite.

Older method-scoped exports still exist under:

- `collected/facebook-dom/...`

### `state/`

Current active path:

- `state/ingest-loop/<sourceKey>.json`
- `state/ingest-loop/<sourceKey>.jsonl`
- `state/ingest-loop/<sourceKey>.stop`

How it is used:

- `ingest:loop` writes machine-friendly current state to the `.json` file
- `ingest:loop` appends one JSON object per cycle plus a final stop event to the `.jsonl` file
- creating the `.stop` file is one supported clean-stop signal

These are runtime/operator artifacts, not canonical application state.

### `storage/`

Current active path:

- `storage/nyc-housing-scout.sqlite`
- optional journaling sidecars: `storage/nyc-housing-scout.sqlite-wal`, `storage/nyc-housing-scout.sqlite-shm`

This is the canonical operational store. Important tables:

- `sources`
- `crawl_runs`
- `crawl_run_steps`
- `stable_posts`
- `post_observations`
- `artifact_refs`
- `processing_jobs`
- `processed_payloads`
- `listing_records`
- `evidence_fragments`
- `resolved_fields`
- `manual_overrides`
- `audit_events`

Collection, processing, review, and the local UI all treat this database as the source of truth.

## Legacy And Historical Layout

### `listings/`

`listings/` is now a legacy export tree.

Older collector versions wrote heuristic listing snapshots here. Those files can still be useful for regression comparison or archaeology, but they are not regenerated by the active DOM collection commands and they are not the canonical downstream boundary.

Current listing state lives in SQLite:

- `processed_payloads`
- `listing_records`

### `normalized/`

`normalized/` is also legacy.

It contains older coupled post-plus-listing outputs from earlier collector shapes, plus a few seed/example files used during early extraction design. The current pipeline does not write here.

### Other historical leftovers

You will still see older trees such as:

- `raw/facebook-dom/...`
- `raw/facebook-group/...`
- `collected/facebook-dom/...`
- `listings/facebook-dom/...`

Those are historical evidence of earlier layouts, not current write targets.

## Current Vs Legacy

Current write targets:

- `raw/facebook/<sourceKey>/<runId>/...`
- `collected/facebook/<sourceKey>/...`
- `state/ingest-loop/<sourceKey>.json`
- `state/ingest-loop/<sourceKey>.jsonl`
- `state/ingest-loop/<sourceKey>.stop`
- `storage/nyc-housing-scout.sqlite`

Legacy-only or historical paths:

- `listings/...`
- `normalized/...`
- `raw/facebook-dom/...`
- `raw/facebook-group/...`
- `collected/facebook-dom/...`
- `listings/facebook-dom/...`

## FAQ

### Why are there no current `data/listings/...` outputs from `capture:dom` or `crawl:dom`?

Because the active collection boundary stops at observations, artifacts, and run metadata. Listings now come from the downstream queue and processing path inside SQLite, not from collection-time exports.

### Why can old `data/listings/...` files disagree with SQLite `listing_records`?

Because those files are legacy heuristic snapshots captured at collection time. The canonical listing state now comes from downstream processing, evidence, and review stages in SQLite.

### Why are there both `facebook-dom` paths and `facebook/<sourceKey>` paths?

The storage layout evolved from method-scoped directories to source-scoped directories. The active collector writes source-scoped paths under `facebook/<sourceKey>`.

### Why do some records still have `postUrl: null`?

Older collector passes did not always recover a usable permalink from the visible card. Historical artifacts can still contain those rows. The current queue path is stricter and treats `postUrl` as important provenance.

### Why can `inspect:storage` show listings even though collection only wrote `raw/` and `collected/` files?

Because listings are derived later by the queue and processing stages. `process:jobs`, `enrich:evidence`, `resolve:addresses`, and review overrides all write through SQLite after collection has finished.

## Useful Commands

- `npm run inspect:storage -- runs --limit 5`
- `npm run inspect:storage -- observations --run-id <runId> --full`
- `npm run inspect:storage -- listings --run-id <runId> --full`
- `npm run inspect:jobs -- --status processed --limit 5`
- `npm run validate:queue -- --run-id <runId> --process-limit 0`

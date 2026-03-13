# `data/`

This directory holds local pipeline artifacts. The important split is:

- `data/storage/nyc-housing-scout.sqlite` is the system of record.
- JSON files under `raw/`, `collected/`, and `listings/` are inspectable disk artifacts and run exports.
- `normalized/` and some older `raw/*` trees are legacy outputs from earlier collector shapes.

## Pipeline Map

1. Collection reads Facebook from the attached browser tab.
2. Raw browser-origin payloads are written to `raw/...`.
3. Those payloads are normalized into canonical collected posts.
4. Collected posts are stored as `post_observations` in SQLite and also exported to `collected/...`.
5. The active DOM commands still do transitional inline heuristic extraction during collection and export those listing snapshots to `listings/...`.
6. The queue runs later against SQLite observations, not against the JSON exports:
   - `enqueue:processing` creates `processing_jobs`
   - `process:jobs` writes `processed_payloads`
   - completed jobs also derive `listing_records`

That means there is intentionally no `data/processed/` directory. Processed payloads live inside SQLite.

## Naming

- `capture-<runId>.json`: one visible feed slice, no scrolling loop.
- `crawl-<runId>.json`: a multi-step crawl that scrolls until it hits its fresh-post target or stop condition.
- `runId`: an ISO timestamp with `:` and `.` replaced by `-`, for example `2026-03-13T00-35-05-584Z`.
- Raw artifact filenames usually look like `<postId>-<captureIndex>.json`.
- If the collector cannot recover a stable `postId`, raw artifact filenames fall back to author/dedupe text such as `Grace-Ahn-010.json` or `unknown-author-...`.

## Current Layout

### `cache/`

- `cache/gemini/gemini.env`
  - Local env file for `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
  - Auto-discovered by `process:jobs` and `gemini:extract` if you do not pass `--env-file`.
  - Not data, just local runtime config. Do not commit secrets.
- `cache/gemini/sample-response.json`
  - Saved Gemini response envelope for debugging the structured-output shape.
  - Shape is closer to a `processed_payloads.payload_json` value than to a raw API response.
  - Useful for schema inspection; not canonical state and not read by the runtime.
- `cache/seen-post-ids.json`
  - Legacy seen-post cache used by the older snapshot collectors.
  - The current DOM + SQLite path does not rely on this file for freshness.

### `raw/`

Current active path:

- `raw/facebook/<sourceKey>/<runId>/<artifact>.json`
  - Browser-evaluated post payload before collected-post normalization.
  - Typical keys: `index`, `postId`, `author`, `postUrl`, `postedAtText`, `bodyText`, `mediaLinks`, `hasSeeMore`, `seeMoreText`, sometimes `debugMetadata`.
  - Produced by `capture:dom` and `crawl:dom`.

How it is used:

- `createCollectedPost(...)` turns each raw payload into the canonical collected-post shape.
- `recordObservationBatch(...)` stores the normalized observation in SQLite and registers an `artifact_refs` row pointing back to this file.
- `rawArtifactPath` then propagates forward into collected posts, listing `source.*`, and processed payload provenance.

Legacy trees still present here:

- `raw/facebook-dom/*.json`
- `raw/facebook-dom/<runId>/*.json`
- `raw/facebook-group/*.json`

Those older files are mixed-quality history. Some are true-ish raw DOM payloads, but others already contain derived fields like `derivedLocation`, `listings`, `skipped`, or `capturedAt`.

### `collected/`

Current active path:

- `collected/facebook/<sourceKey>/capture-<runId>.json`
- `collected/facebook/<sourceKey>/crawl-<runId>.json`

Shape:

- Array of canonical collected posts.
- Typical fields:
  - `sourceKey`
  - `platform`
  - `groupName`
  - `postId`
  - `postUrl`
  - `authorName`
  - `postedAtText`
  - `bodyText`
  - `comments`
  - `media`
  - `captureMethod`
  - `captureRunId`
  - `capturedAt`
  - `rawArtifactPath`
  - `derivedLocation`
  - `captureHints`
  - `dedupeKey`

How it is used:

- This is the easiest on-disk export for inspecting what the collector normalized.
- The canonical durable copy is the matching `post_observations.payload_json` row in SQLite.
- Queue processing rebuilds observation input from SQLite, not by rereading these JSON files.

Older DOM split output also exists under:

- `collected/facebook-dom/...`

That directory is from the earlier method-scoped layout before the storage layer switched to `facebook/<sourceKey>/...`.

### `listings/`

Current active path:

- `listings/facebook/<sourceKey>/capture-<runId>.json`
- `listings/facebook/<sourceKey>/crawl-<runId>.json`

Shape:

- Array of normalized listing rows.
- Each row is roughly:
  - `source`
  - `postIntent`
  - `listingType`
  - `location`
  - `pricing`
  - `rooms`
  - `dates`
  - `features`
  - `contact`
  - `notes`
  - `confidence`

How it is used:

- These files are collection-time heuristic listing exports.
- They are useful for quick inspection, regression comparison, and reading listing-shaped output without querying SQLite.
- They are not the canonical processing boundary anymore.
- They are also not automatically regenerated after later queue processing, so they can drift from the SQLite `listing_records` table for the same run.
- Canonical queued processing results live in:
  - `processed_payloads`
  - `listing_records`
  - both inside `data/storage/nyc-housing-scout.sqlite`

Important nuance:

- Collection exports all observed posts into `collected/...`.
- Inline listing extraction only runs for fresh posts.
- So a `listings/.../capture-...json` file can legitimately be empty even when the matching `collected/...` file contains records.

Older DOM split output also exists under:

- `listings/facebook-dom/...`

### `storage/`

- `storage/nyc-housing-scout.sqlite`
- you may also see `storage/nyc-housing-scout.sqlite-wal` and `storage/nyc-housing-scout.sqlite-shm` while SQLite is active

This is the canonical operational store. Important tables:

- `sources`: configured sources/groups
- `crawl_runs`: capture/crawl run metadata
- `crawl_run_steps`: per-step crawl checkpoints
- `stable_posts`: source-scoped stable post identity
- `post_observations`: normalized collected-post snapshots
- `artifact_refs`: references to raw/export files with hash/size metadata
- `listing_records`: normalized listing rows
- `processing_jobs`: queue state
- `processed_payloads`: versioned processor outputs, including Gemini envelopes

How it is used:

- Collection writes runs, observations, artifact refs, and transitional listing rows here.
- Queue processing claims observations from here and writes processed payloads back here.
- Inspection CLIs read this database first and then follow artifact refs when needed.
- The `-wal` and `-shm` sidecars are normal SQLite journaling files, not separate pipeline datasets.

## Legacy Layout

### `normalized/`

This directory is legacy. The current pipeline does not write here.

What is in it:

- `normalized/facebook-group/...`
  - Older snapshot-parser path.
  - Each record is a post-shaped object with inline `listings`.
- `normalized/facebook-dom/...`
  - Older DOM collector path before the raw / collected / listings split stabilized.
  - Same general coupled shape: post fields plus inline extracted listings.
- `normalized/seed-observations-2026-03-12.json`
  - Appears to be a hand-authored seed/example file for reasoning about multi-listing extraction shape.
  - I could not find current runtime code that reads it.

Why it still matters:

- It is useful historical evidence for how the collector/extractor evolved.
- It explains some odd older artifacts in `raw/facebook-dom/*`.
- It is not where new collection or queue work lands now.

## Current Vs Legacy

Current write targets:

- `raw/facebook/<sourceKey>/<runId>/...`
- `collected/facebook/<sourceKey>/...`
- `listings/facebook/<sourceKey>/...`
- `state/ingest-loop/<sourceKey>.json`
- `state/ingest-loop/<sourceKey>.jsonl`
- `storage/nyc-housing-scout.sqlite`

### `state/`

Current active path:

- `state/ingest-loop/<sourceKey>.json`
- `state/ingest-loop/<sourceKey>.jsonl`
- `state/ingest-loop/<sourceKey>.stop`

How it is used:

- `ingest:loop` writes machine-friendly loop state to the `.json` file.
- `ingest:loop` appends one JSON object per cycle plus a final stop event to the `.jsonl` file.
- creating the `.stop` file is one supported clean-stop signal for the loop.

These are local operator/runtime artifacts, not canonical application state. SQLite remains the system of record for crawl observations, queue state, processed payloads, and listings.

Historical leftovers you will still see:

- `raw/facebook-dom/*`
- `raw/facebook-group/*`
- `collected/facebook-dom/*`
- `listings/facebook-dom/*`
- `normalized/*`

## FAQ

### Why does `summary` look truncated in `normalized/facebook-dom/capture-2026-03-12T19-21-36-114Z.json`?

Because that file contains inline heuristic extraction output, and the heuristic extractor stores `notes.summary` as the first 240 characters of the listing text. It is a short summary field, not the full source text.

Where to find the full text instead:

- the surrounding record’s `bodyText`
- current SQLite observations in `post_observations.body_text`
- current SQLite observations in `post_observations.payload_json`

This also means older `normalized/*` files and current heuristic `listings/*` exports may contain clipped summaries even when the source post body is intact.

### Why can a `listings/.../capture-...json` file be empty?

Because the collector still exports all observed posts to `collected/...`, but only extracts listings inline for fresh posts. If a capture run mostly sees already-known posts, the collected export can be non-empty while the listing export is empty.

### Why do some records have `postUrl: null`?

Older collector passes did not always recover a usable Facebook permalink from the visible card. Those rows can still exist in historical artifacts. The queue path is stricter: standard enqueueing requires `postUrl`, so observations missing it are excluded from normal processing.

### Why are there both `facebook-dom` paths and `facebook/facebook-default` paths?

The storage layout evolved:

- older DOM outputs were method-scoped under `facebook-dom`
- current outputs are source-scoped under `facebook/<sourceKey>`

In this repo, the active source key defaults to `facebook-default` unless you pass `--source-key`.

### Why can `inspect:storage validate-run` report `summary.extractedListings does not match listing count`?

Because those numbers come from different moments in the pipeline:

- `summary.extractedListings` is the collection-time inline extraction count captured when the run finished
- `listing_records` is the current SQLite table, which can gain more rows later when queued processing completes for observations from that run

So once `process:jobs` has written newer queue-derived listings, the database can legitimately contain more listings than the original `data/listings/...` export or run summary reported.

## Useful Commands

- `npm run inspect:storage -- runs --limit 5`
- `npm run inspect:storage -- observations --run-id <runId> --full`
- `npm run inspect:storage -- listings --run-id <runId> --full`
- `npm run inspect:jobs -- --status processed --limit 5`
- `npm run validate:queue -- --run-id <runId> --process-limit 0`

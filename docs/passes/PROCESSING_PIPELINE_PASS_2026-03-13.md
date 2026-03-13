# Processing Pipeline Pass — 2026-03-13

## Scope

This pass added the processing queue skeleton only.

- no Gemini integration
- no attempt to build a general workflow engine
- no backward-compatibility work for stale local data

The goal was to make processing a first-class, observation-centric stage with explicit queue state, atomic claims, and a small local CLI surface.

## What Changed

- Added `processing_jobs` and `processed_payloads` tables under a new SQLite migration:
  - `src/storage/migrations/0002_processing_pipeline.sql`
- Added queue lifecycle methods to `SqliteStorage`:
  - `enqueueProcessingJobs(...)`
  - `claimProcessingJobs(...)`
  - `completeProcessingJob(...)`
  - `failProcessingJob(...)`
  - `retryProcessingJobs(...)`
  - `listProcessingJobs(...)`
- Added a small processing module:
  - `src/processing/config.js`
  - `src/processing/heuristic-processor.js`
- Added stage-oriented CLIs:
  - `npm run enqueue:processing -- ...`
  - `npm run inspect:jobs -- ...`
  - `npm run process:jobs -- ...`
  - `npm run retry:jobs -- ...`
- Added tests for both the storage lifecycle and the CLI behavior.

## Queue Model

The unit of work is one collected observation, keyed by:

- `observation_id`
- `processor_version`
- `schema_version`
- `model_name`

That tuple is unique in `processing_jobs`, so enqueue is idempotent for a given processing definition.

Current job states:

- `pending`
- `processing`
- `processed`
- `retryable`
- `failed`

Atomic claim semantics:

- `claimProcessingJobs(...)` runs inside `BEGIN IMMEDIATE`
- expired leases are swept before new claims are selected
- claimed jobs are updated to `processing` with:
  - `claimed_by`
  - `claimed_at`
  - `lease_expires_at`
  - incremented `attempt_count`

This keeps the design small while still supporting crash recovery and explicit retries.

## Provenance

Every processing job and processed payload now carries:

- `processor_version`
- `schema_version`
- `model_name`

`postUrl` is treated as required queue provenance for this stage.
Observations without `post_url` are not enqueued by the standard enqueue command.

The processed payload contract is stored in `processed_payloads` and currently includes:

- the observation reference
- the provenance tuple
- `post_url`
- extracted listing count
- raw processed payload JSON

## Current Worker Behavior

`process:jobs` is intentionally simple in Pass A:

- claim a batch of eligible jobs
- rebuild the collected-post input from the stored observation payload
- run the existing heuristic text extractor
- store the result in `processed_payloads`
- mark the job `processed`, `retryable`, or `failed`

This gives the repo a real processing boundary now, without coupling the queue to Gemini yet.

## Deliberate Non-Goals

- no remote workers
- no scheduler service
- no multi-stage workflow graph
- no processed-payload to listing-record mapping yet
- no refactor of the DOM collectors to enqueue automatically

Those are follow-on tasks, not part of this pass.

## Tests

Added coverage for:

- idempotent enqueue by observation + provenance
- claim / complete / fail / retry lifecycle
- persisted `processed_payloads`
- CLI behavior for enqueue, process, inspect, and retry

`npm test` passes after this change.

## Pass B

Pass B should build on this queue rather than bypass it.

Concrete next work:

1. Define the structured processed payload schema for Gemini output.
2. Integrate Gemini as a processor behind `process:jobs`.
3. Map `processed_payloads` into normalized `listing_records` with the same provenance tuple.
4. Move the active collection path toward enqueue-first, instead of inline extraction during crawl/capture.

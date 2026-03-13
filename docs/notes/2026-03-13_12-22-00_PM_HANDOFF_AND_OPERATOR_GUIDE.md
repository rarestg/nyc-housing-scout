# PM Handoff and Operator Guide

As of commit `7d11a21` (`harden Gemini queue processing and fix same-batch reclaim`).

## Why this exists

This repo now has enough moving parts that a new PM should not have to reconstruct intent from pass logs alone.
This note captures the practical project state, the operating heuristics that have worked so far, and the next decisions that matter.

## Current state in plain English

`nyc-housing-scout` is no longer an ad hoc scraper.
It is now a staged local-first pipeline with:

- DOM-based Facebook capture from a live attached Chrome tab
- canonical `CollectedPost` normalization
- SQLite as the operational source of truth
- raw artifacts persisted on disk for replay/debugging
- an observation-centric processing queue
- Gemini-backed structured extraction in `process:jobs`
- versioned `processed_payloads`
- normalized `listing_records`
- inspection/validation CLIs for storage and queue state

The pipeline is real now. The main remaining risk is not SQLite or queueing; it is crawl/traversal quality and extraction quality on messy real posts.

## What just landed

Two back-to-back Gemini operations passes are now in the repo:

1. `docs/passes/2026-03-13_03-19-09_GEMINI_OPERATIONAL_HARDENING_PASS.md`
   - abortable Gemini request timeout
   - lease-aware sequential processing behavior
   - inline batch/job metrics
   - live timeout + retry validation

2. `docs/passes/2026-03-13_08-56-33_SAME_BATCH_RECLAIM_FIX_PASS.md`
   - fixed the bug where one timed-out job could be reclaimed again in the same `process:jobs` invocation when `retryDelayMs=0`
   - regression coverage added
   - live timeout repro + live recovery validation added

Current expectation after those passes:
- one stuck Gemini call should only hold one lease
- one job should not burn multiple attempts inside the same batch invocation
- timeout/retry/token/latency metrics should show up directly in CLI output

## The actual project shape

The current reality is:

1. capture/crawl from the live Facebook tab
2. normalize into `CollectedPost`
3. persist observations and artifacts
4. enqueue eligible observations into `processing_jobs`
5. run Gemini extraction against stored observations
6. persist structured payloads in `processed_payloads`
7. derive frontend-facing `listing_records`

The code/docs to treat as the current truth are:

- `README.md`
- `docs/INDEX.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/PIPELINE.md`
- `docs/LISTING_SCHEMA.md`
- `src/core/browser-pipeline.js`
- `src/browser/dom-extractor.js`
- `src/storage/sqlite-storage.js`
- `src/processing/run-processing-batch.js`

## Things that are easy to miss if you only skim the docs

### 1. `postUrl` is a hard gate for queue eligibility
If Facebook hides the permalink, the post can still be captured, stored, and debugged, but it is currently excluded from queue processing.
This is intentional for now because provenance matters more than fake coverage.

### 2. There are still effectively two listing-generation paths
The queue path is the intended future boundary, but DOM capture/crawl still performs inline heuristic extraction as a transitional behavior.
Do not mistake that transitional path for the final architecture.

### 3. The biggest bottleneck is crawl policy, not storage
SQLite is not the thing to worry about right now.
The real leverage is in:
- top-of-feed reset behavior
- incremental vs backfill split
- overlap-anchor stopping
- stale-zone heuristics
- better traversal metrics

### 4. Gemini is no longer an experiment bolted on the side
`process:jobs` is now the canonical structured extraction path.
If extraction quality is poor, fix the queue prompt/schema/normalization path — do not bypass it with one-off scripts.

### 5. The recent pass style is worth preserving
The project has gone fastest when each change set is:
- narrow
- validated on real stored observations, not just unit tests
- written up in a timestamp-prefixed pass doc
- tied back to the existing CLI/operator surfaces instead of inventing a new subsystem

## PM operating heuristics that have worked well

### Keep delegation narrow
Good delegation prompts for this repo have:
- a specific pass name
- an explicit reading list
- a narrow scope
- a hard validation requirement on real data
- a requirement to write a timestamp-prefixed pass doc in New York time

### Ask for real validation when touching live paths
For queue, Gemini, or crawl changes, tests are not enough.
Ask workers to show:
- exact command(s) they ran
- real observed outcomes
- before/after or repro/recovery when possible

### Prefer explainers before large implementation passes
A read-only explainer/reviewer agent is useful before dispatching a coding agent when the area is changing quickly.
That reduces nonsense edits and gives better PM context.

### Avoid overbuilding orchestration
This repo keeps getting healthier when the answer is:
- one more explicit CLI
- one better storage helper
- one clearer pass doc

and not:
- a new daemon
- a new scheduler layer
- a new event bus
- migration theater for a single-user local tool

## Current known rough edges

### Crawl / collection
- traversal strategy is still simple expand + scroll
- latest-anchor and overlap-anchor behavior still need hardening
- missing permalink cases still exist
- DOM time extraction is still weaker than author/permalink extraction on some card shapes

### Extraction quality
- some posts are naturally multi-listing or multi-location and may still be flattened awkwardly
- availability windows and similar structured fields need review on real processed payloads
- queue metrics are better now, but output-quality review still needs to happen on real payloads and listing rows

### Product/query layer
- frontend-oriented query helpers/views are still mostly ahead of the current implementation
- there is not yet a polished review surface for unresolved or ambiguous listings

## Recommended next priority order

1. **Review real Gemini outputs end to end**
   - inspect `processed_payloads` and derived `listing_records`
   - categorize actual extraction failures
   - tune schema/prompt/normalization from evidence

2. **Harden crawl freshness / traversal policy**
   - top-of-feed reset
   - incremental vs backfill split
   - overlap-anchor stop rules
   - traversal metrics

3. **Shape the query/frontend layer**
   - listing query helpers/views
   - unresolved/ambiguous review views
   - only after the listing model feels stable enough

## Suggested dispatch order for future workers

1. explainer/reviewer agent to map the area
2. implementation agent for a narrow pass
3. optional validation-only agent if the surface is risky

For coding work, it has worked well to require workers to read:
- `README.md`
- `docs/INDEX.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/PIPELINE.md`
- relevant pass docs in `docs/passes/`

## Practical commands the PM will keep using

### Queue and processing
- `npm run enqueue:processing -- --run-id <runId>`
- `npm run validate:queue -- --run-id <runId>`
- `npm run inspect:jobs -- --status pending --limit 20`
- `npm run process:jobs -- --limit 10`
- `npm run retry:jobs -- --status failed`

### Storage inspection
- `npm run inspect:storage -- runs --limit 5`
- `npm run inspect:storage -- observations --run-id <runId> --limit 10`
- `npm run inspect:storage -- listings --run-id <runId> --full`
- `npm run inspect:storage -- validate-run --run-id <runId>`

### Collection
- `npm run capture:dom -- --source-key nyc-housing-group --limit 20`
- `npm run crawl:dom -- --source-key nyc-housing-group --target 20 --max-scrolls 20`

## PM definition of done for near-term work

A near-term pass is not really done unless it has:
- code changes
- tests where appropriate
- real validation where appropriate
- a pass doc
- a clear statement of what the next bottleneck is

That discipline is what has made the repo legible instead of turning it into a pile of experiments.

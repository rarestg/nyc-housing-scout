# Collection / Processing Boundary Simplification Pass

## 1. Scope

Narrow simplification pass for the active DOM collection path:

- remove transitional inline listing extraction from `capture:dom` and `crawl:dom`
- stop writing collection-time listing exports during normal DOM collection success
- keep collection ending at observations, artifacts, run steps, and run summaries
- keep listing creation on the queue/processing path

Explicit non-goals:

- no parser, normalizer, or resolver rewrite
- no network transport changes
- no storage redesign or queue redesign
- no legacy snapshot collector cleanup
- no frontend/UI cleanup

## 2. Files Changed

- `src/cli/capture-dom-feed.js`
- `src/cli/crawl-dom-latest.js`
- `src/cli/ingest-loop.js`
- `src/storage/sqlite-storage.js`
- `test/storage-inspection.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_16-34-20_COLLECTION_PROCESSING_BOUNDARY_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and code reads:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,260p' docs/ROADMAP.md
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,320p' src/cli/capture-dom-feed.js
sed -n '1,340p' src/cli/crawl-dom-latest.js
sed -n '341,760p' src/cli/crawl-dom-latest.js
sed -n '760,980p' src/cli/crawl-dom-latest.js
sed -n '1,260p' src/cli/enqueue-processing.js
sed -n '1,320p' src/cli/process-jobs.js
sed -n '1,320p' src/cli/validate-queue.js
sed -n '540,610p' src/cli/ingest-loop.js
sed -n '2000,2115p' src/storage/sqlite-storage.js
sed -n '1,320p' test/storage-inspection.test.js
sed -n '100,220p' test/storage-interface.test.js
rg -n "extract|listing|listings|recordListingsBatch|listing_export|extractedListings|listingsExportPath" src test docs data
git status --short
```

Local checks and tests:

```bash
node --check src/cli/capture-dom-feed.js
node --check src/cli/crawl-dom-latest.js
node --check src/cli/ingest-loop.js
node --check src/storage/sqlite-storage.js
node --check test/storage-inspection.test.js
node --test test/storage-inspection.test.js
node --test test/storage-interface.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-16T20-32-57-925Z
npm run validate:queue -- --run-id 2026-03-16T20-32-57-925Z --enqueue-limit 3 --process-limit 3 --sample-limit 2
npm run inspect:jobs -- --run-id 2026-03-16T20-32-57-925Z --status processed --limit 3
npm run inspect:storage -- listings --run-id 2026-03-16T20-32-57-925Z --limit 3
npm run inspect:storage -- validate-run --run-id 2026-03-16T20-32-57-925Z
node src/cli/capture-dom-feed.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --limit 5
npm run inspect:storage -- validate-run --run-id 2026-03-16T20-34-08-152Z
```

## 4. What Inline Behavior Was Removed

Removed from `capture-dom-feed.js` and `crawl-dom-latest.js`:

- `extractListingsFromPost(...)` during collection
- `storage.recordListingsBatch(...)` during collection
- `listing_export` artifact writing during collection success
- collection summary field `extractedListings`
- CLI output field `listingsArtifact`

Removed from `ingest-loop.js`:

- crawl summary field `extractedListings`, so controller state/log output no longer implies listing creation happened during collection

Adjusted in `sqlite-storage.js`:

- `validate-run` no longer requires `listingsExportPath` for a completed run
- `validate-run` no longer compares `summary.extractedListings` to `listing_records`

## 5. Before / After Boundary Definition

Before:

- `capture:dom` / `crawl:dom` collected observations
- the same CLIs also heuristically extracted listings inline
- the same CLIs wrote `listing_records`, `listing_export` artifacts, and `summary.extractedListings`
- queue processing existed as the intended boundary, but collection still crossed it

After:

- `capture:dom` / `crawl:dom` stop at `post_observations`, raw artifacts, collected exports, run steps, and run summaries
- `validate-run` treats those collection outputs as the integrity boundary
- listing creation belongs to `enqueue:processing`, `process:jobs`, and `validate:queue`

## 6. Tests Run

- `node --test test/storage-inspection.test.js`
- `node --test test/storage-interface.test.js`
- `npm test`

Results:

- `test/storage-inspection.test.js`: `2/2` passing
- `test/storage-interface.test.js`: `2/2` passing
- `npm test`: `91/91` passing

## 7. Live Validation Runs

### 7.1 Bounded crawl validation

- Run id: `2026-03-16T20-32-57-925Z`
- Command used the simplified default `crawl:dom` path
- Result:
  - `collected = 8`
  - `freshCollected = 0`
  - `seenCollected = 8`
  - `listingExports = 0`
  - `validate-run` stayed healthy with no issues
  - output contained `collectedArtifact` and `networkCaptureArtifact`, but no `listingsArtifact`

### 7.2 Capture sanity check

- Run id: `2026-03-16T20-34-08-152Z`
- Command used `capture-dom-feed.js --limit 5`
- Result:
  - `collected = 5`
  - `freshCollected = 0`
  - `seenCollected = 5`
  - `listingExports = 0`
  - `validate-run` stayed healthy with no issues
  - output contained `collectedArtifact`, but no `listingsArtifact`

## 8. Downstream Processing Validation

Because the bounded Williamsburg crawl landed on an all-seen top slice, I validated the downstream listing path on that run without a `--freshness` filter.

Run-scoped queue validation:

- `npm run validate:queue -- --run-id 2026-03-16T20-32-57-925Z --enqueue-limit 3 --process-limit 3 --sample-limit 2`
- result:
  - `enqueue.counts.created = 3`
  - `processing.claimedCount = 3`
  - `processing.processedCount = 3`
  - `processing.failedCount = 0`
  - post-validation `run.listingCount = 3`

Compact downstream inspection confirmed the listings were queue-derived:

- `inspect:jobs` showed 3 processed jobs for that run, each with `processedListingCount = 1`
- `inspect:storage listings` showed 3 listing rows for that run with extractor version `gemini-structured-v1|gemini-processed-payload-v1|gemini-3-flash-preview`
- rerunning `validate-run` after queue processing stayed healthy even though the run now had `listings = 3` and `listingExports = 0`

## 9. Risks Or Limitations

- Historical support for `listing_export` still exists in storage, fixtures, and read surfaces for older runs. This pass stopped active DOM collection from writing those exports, but it did not delete the historical concept globally.
- The bounded live crawl used an all-seen slice. That was still sufficient to prove the new boundary and downstream queue behavior, but it was not a fresh-only validation.
- `data/README.md` still contains historical wording about collection-time listing exports. I left it alone in this narrow pass because the requested write scope named `docs/PIPELINE.md` as the canonical doc target.
- The dashboard/inspection UI still contains historical labels around extracted listings and listing exports. I intentionally left frontend cleanup out of this pass.

## 10. Recommendation For The Next Simplification Pass

Collapse Facebook identity canonicalization into one shared utility used by collected-post normalization, network normalization, and resolver matching.

Why this is the next best simplification:

- transport branching is already reduced
- collection no longer crosses into listing creation
- the biggest remaining correctness-oriented simplification win is removing duplicated Facebook URL/post-id normalization rules across modules

# Gemini Integration Into `process:jobs` — 2026-03-13

## Scope

This pass moved Gemini from an isolated experiment into the real observation-centric processing path.

- no backward-compatibility work for stale local queue state
- no new orchestration layer
- no second parallel processing stack beside `process:jobs`

The goal was to make Gemini the canonical queued processor, persist its processed payloads under the existing provenance tuple, and map those payloads into normalized `listing_records`.

## What Changed

- Added the canonical Gemini structured schema in `src/processing/gemini/canonical-schema.js`.
- Reused the existing Gemini harness in `src/processing/gemini/structured-output-experiment.js` instead of replacing it.
- Added `src/processing/gemini/processor.js` to resolve env/key state and run Gemini for queued observations.
- Switched processing defaults to the Gemini provenance tuple:
  - `processorVersion`: `gemini-structured-v1`
  - `schemaVersion`: `gemini-processed-payload-v1`
  - `modelName`: `gemini-3-flash-preview`
- Made the shared batch runner async so `process:jobs` and `validate:queue` both execute the same Gemini-backed path.
- Stored normalized Gemini listings inside the processed payload envelope as `extracted.listings`, while also retaining the canonical Gemini `structuredData` plus raw Gemini response metadata.
- Made `completeProcessingJob(...)` insert derived `listing_records` atomically alongside the `processed_payloads` row.
- Reused the existing `listing_records.extractor_version` column to preserve the full processing provenance tuple as:
  - `processorVersion|schemaVersion|modelName`
- Updated the queue CLIs and docs so Gemini is the default processing path and `--env-file` / `--temperature` are available where needed.

## Canonical Gemini Processed-Payload Shape

The canonical model response schema is now:

- top-level `source.postUrl`
- top-level `listings[]`
- top-level `overallAmbiguities[]`

Each `listings[]` entry carries the normalized housing fields needed for downstream mapping:

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

The stored processed payload envelope keeps:

- queue provenance
- observation provenance
- canonical Gemini `structuredData`
- normalized `extracted.listings`
- Gemini response metadata (`responseId`, `modelVersion`, `usageMetadata`, prompt, raw JSON text)

That means `processed_payloads` remain the durable inspection boundary while `listing_records` stay frontend-oriented.

## Storage / Mapping Behavior

`completeProcessingJob(...)` now does two things in the same transaction:

1. insert the `processed_payloads` row
2. derive and insert `listing_records`

This keeps queue state, processed payloads, and normalized listings coherent for:

- `process:jobs`
- `validate:queue`
- `inspect:jobs`
- `inspect:storage -- listings`

## Tests

`npm test` passes after this change.

Coverage now includes:

- canonical Gemini schema normalization
- Gemini processor reuse of the existing harness
- Gemini-backed shared batch processing
- atomic mapping from processed payloads into `listing_records`
- queue/CLI regression coverage with explicit heuristic provenance overrides for offline tests

## Real Gemini-Backed Runs

### Finished `process:jobs` run

Command:

```bash
npm run process:jobs -- --observation-id obs_000099 --limit 1 --env-file data/cache/gemini/gemini.env
```

Result:

- claimed: `1`
- processed: `1`
- retryable: `0`
- failed: `0`
- processed job: `job_000034`
- observation: `obs_000099`
- processed payload: `ppd_000033`
- derived listing record: `lst_000040`

Observed extracted shape:

- author: `Bryan Soares`
- post URL: `https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24439825002382072/`
- listing type: `lease_takeover`
- intent: `offering`
- neighborhood: `Greenpoint`
- borough: `Brooklyn`
- availability: `2026-04-01` through `2026-08-15`
- summary: `Lease takeover for an unfurnished studio in North Greenpoint from April 1 to August 15.`
- ambiguity: price missing

### Additional live Gemini queue processing

Earlier in the pass, the same real queue path was exercised on three stored fresh observations from run `2026-03-13T00-35-05-584Z`:

- `job_000031` / `obs_000096` processed successfully
- `job_000032` / `obs_000097` processed successfully
- `job_000033` / `obs_000098` stalled during the live Gemini call and was manually moved to `retryable`

Successful extracted examples from that live batch:

- `obs_000096`
  - Greenpoint room sublet
  - available `2026-04-27` to `2026-06-30`
  - 3 bed / 2 bath context captured
- `obs_000097`
  - Williamsburg short-term sublet
  - available `2026-03-09` to `2026-03-15`
  - in-unit laundry, balcony, rooftop captured

Manual recovery action taken for the stalled row:

- `job_000033` marked `retryable`
- `lastError`: `manual timeout after live Gemini run`

### Queue validation snapshot after the live Gemini work

Command:

```bash
npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --process-limit 0 --sample-limit 2
```

State after enqueue-only validation on the same Gemini provenance:

- fresh observations in scope: `12`
- eligible observations: `12`
- observations with Gemini jobs: `12`
- processed Gemini jobs: `3`
- retryable Gemini jobs: `1`
- pending Gemini jobs: `8`

This confirms the queue/validation surface now sees real Gemini payload persistence and real listing mapping on stored observations.

## Notes

- The queue path is now the intended structured extraction surface.
- The standalone Gemini CLI still exists, but the canonical schema now lives in-repo and can be used without passing a separate schema file.
- The live run surfaced one real operational gap: request-level timeout / cancellation handling for long-running Gemini calls.

## Next Best Follow-Up

Add explicit request timeout / cancellation handling around Gemini calls in `process:jobs`, so a single slow observation does not hold a lease indefinitely and manual retry intervention is no longer needed.

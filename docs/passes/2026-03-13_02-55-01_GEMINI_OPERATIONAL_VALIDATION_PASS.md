# Gemini Operational Validation On Live Jobs — 2026-03-13

## Scope

This pass validated the real Gemini-backed `process:jobs` path against live queued observations.

- inspected real `processed_payloads` and derived `listing_records`
- retried the previously timed-out `job_000033`
- ran controlled live Gemini batches on pending jobs
- made one small operational tuning change justified by the live results
- did not do schema redesign, queue redesign, or missing-permalink debugging

## Starting Queue State

Before this pass, the Gemini provenance tuple for run `2026-03-13T00-35-05-584Z` was:

- `3 processed`
- `1 retryable` (`job_000033`)
- `8 pending`

The retryable row was:

- `job_000033` / `obs_000098`
- author: `Eric Schrieber`
- previous `lastError`: `manual timeout after live Gemini run`

## Live Validation Work

### 1. Retry of `job_000033`

Actions:

- requeued `job_000033`
- processed `obs_000098` in isolation through the real Gemini queue path

Result:

- `processed: 1`
- `retryable: 0`
- `failed: 0`

Observed behavior:

- this was not a deterministic schema or mapping failure
- it did reproduce as a slow operational outlier
- the retried job completed only after about `4m 38s`
- stored usage metadata showed:
  - `totalTokenCount: 64720`
  - `thoughtsTokenCount: 62913`

Conclusion:

- the earlier timeout was not a one-off “bad row” failure
- it was a repeatable long-running Gemini call caused by excessive reasoning token generation on this observation

### 2. Untuned controlled live batch

Command surface:

- processed the next `4` pending Gemini jobs with the current defaults

Jobs:

- `job_000035` / `obs_000100`
- `job_000036` / `obs_000101`
- `job_000037` / `obs_000102`
- `job_000038` / `obs_000104`

Result:

- `processed: 4`
- `retryable: 0`
- `failed: 0`

Notes:

- all four completed successfully
- multi-listing output worked on `job_000037` with `2` derived listings
- this batch was operationally fine, but it still ran under the same no-timeout / 5-minute lease assumptions that nearly failed on `job_000033`

### 3. Small operational tuning change

Based on the `job_000033` outlier, the queued Gemini path now:

- sets `thinkingLevel: minimal` by default for structured extraction
- stores that runtime setting under `processed_payloads.payload_json.gemini.thinkingConfig`

No schema or listing-model changes were made.

### 4. Tuned controlled live batch

After the change, processed the remaining `4` pending Gemini jobs:

- `job_000039` / `obs_000105`
- `job_000040` / `obs_000106`
- `job_000041` / `obs_000107`
- `job_000042` / `obs_000108`

Result:

- `processed: 4`
- `retryable: 0`
- `failed: 0`

Observed behavior:

- all four completed quickly
- stored Gemini metadata recorded an explicit minimal thinking setting on every row
- `thoughtsTokenCount` was absent on all four tuned payloads
- total token counts dropped to:
  - `1202`
  - `2323`
  - `1171`
  - `2359`

## Validation-Pass Totals

Across the live work performed in this pass:

- `processed: 9`
- `retryable: 0`
- `failed: 0`

Final queue snapshot for fresh observations in run `2026-03-13T00-35-05-584Z`:

- `12 processed`
- `0 pending`
- `0 retryable`
- `0 failed`

## Representative Processed Payload Examples

### `ppd_000034` / `job_000033`

- post intent: `wanted`
- listing type: `roommate_search`
- borough: `Brooklyn`
- available from: `2026-04-01`
- summary: roommate search across Williamsburg / Clinton Hill / Bushwick / Bed-Stuy / Greenpoint with dog-friendly + bike-storage + laundry requirements

### `ppd_000037` / `job_000037`

- post intent: `offering`
- listing type: `roommate_search`
- listing count: `2`
- split prices captured as:
  - `$2000/month`
  - `$1700/month`
- both listings mapped to Williamsburg

### `ppd_000040` / `job_000040`

- post intent: `offering`
- listing type: `lease_takeover`
- neighborhood: `Greenpoint`
- shape captured: luxury `1BR`, deck, pool access, furnished-or-unfurnished ambiguity preserved

## Representative Normalized Listing Examples

### `lst_000041` from `obs_000098`

- `listing_type: roommate_search`
- `post_intent: wanted`
- `borough: Brooklyn`
- `available_from: 2026-04-01`

### `lst_000044` and `lst_000045` from `obs_000102`

- two normalized rows derived from one observation
- both `roommate_search` offerings
- monthly prices mapped separately as `$2000` and `$1700`

### `lst_000049` from `obs_000107`

- `listing_type: entire_apartment`
- `post_intent: offering`
- `neighborhood: East Williamsburg`
- `price_amount: 4800`

## Output Quality Findings

These findings are about structured output shape and listing mapping only.

### Good

- Gemini consistently returned the canonical envelope shape required by the queue path.
- Offering posts, wanted posts, and multi-listing posts all mapped into normalized `listing_records` without storage or schema issues.
- `postUrl` provenance flowed through correctly into processed payloads and normalized listings.
- Multi-listing splitting worked correctly on `obs_000102`.
- Wanted roommate-hunt posts stayed `wanted` / `roommate_search` instead of being collapsed into offered-room listings.

### Issues Observed

- `obs_000108` contains two non-contiguous sublet windows (`3/11-3/16` and `4/14-5/4`), but Gemini flattened them into one continuous `availableFrom` / `availableTo` span (`2026-03-11` to `2026-05-04`).
- Multi-location wanted posts still lose some precision because the current schema only supports one normalized neighborhood value; `obs_000104` preserved the ambiguity textually but normalized to a single neighborhood.

### Decision

- no schema redesign in this pass
- no prompt change for the date-window issue yet, because the operational fix was clearer and directly validated on live jobs

## Operational Behavior Findings

These findings are about timeout, claim, retry, and live queue behavior only.

### Confirmed

- `job_000033` showed that long-running Gemini calls are a real operational issue, not just a one-off manual interruption.
- The problem was not queue corruption or schema invalidity; it was extreme reasoning-token expansion on a single observation.
- With the prior defaults, one outlier could consume nearly the whole `5 minute` lease budget by itself.

### Tuning Outcome

- pinning Gemini 3 to `thinkingLevel: minimal` removed the observed reasoning-token spike on the tuned live batch
- the tuned batch completed quickly and cleanly with `0 retryable` and `0 failed`
- storing `thinkingConfig` in the processed payload now makes this runtime behavior inspectable later

### Remaining Risk

- there is still no explicit request timeout / cancellation around the Gemini call
- the worker still claims whole batches up front and processes sequentially
- if future live calls stall for another reason, lease expiry / duplicate-claim risk still exists under concurrent workers

## Code / Doc Changes

- `src/processing/gemini/config.js`
  - added default Gemini thinking-level constant
- `src/processing/gemini/processor.js`
  - passed the default thinking level into queued Gemini processing
- `src/processing/gemini/structured-output-experiment.js`
  - sent `thinkingConfig.thinkingLevel`
  - persisted `gemini.thinkingConfig` in the stored payload envelope
- `test/gemini-structured-output.test.js`
  - added coverage for explicit minimal-thinking defaults
- `docs/PIPELINE.md`
  - documented the queued Gemini `thinkingLevel: minimal` default

## Verification

- `node --test test/gemini-structured-output.test.js`
- `npm test`
- live retry of `job_000033`
- live untuned batch over `job_000035` through `job_000038`
- live tuned batch over `job_000039` through `job_000042`
- `npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --process-limit 0 --sample-limit 3`

## Next Recommended Follow-Up

Add explicit Gemini request timeout / cancellation handling plus lease-safety for sequential batches, so a future slow or stuck call cannot pin a claimed batch until lease sweep.

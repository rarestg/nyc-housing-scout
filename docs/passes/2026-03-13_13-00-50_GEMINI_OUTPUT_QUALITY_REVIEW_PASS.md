# Gemini Output Quality Review Pass - 2026-03-13

## Operator Summary

- Alternative or multi-option posts are still being flattened into single exact scalar values in `processed_payloads`, especially for dates, neighborhoods, and bedroom counts (`obs_000108`, `obs_000104`, `obs_000098`).
- Offered room-fill posts can still land as `listingType=roommate_search` even when the post is clearly offering concrete room inventory (`obs_000102`).
- Several missing-field cases begin upstream in truncated `See more` observations, not in Gemini (`obs_000100`, `obs_000106`, `obs_000096`).
- Next fix should target: `prompt`
- Do not touch yet: queue hardening, `listing_records` mapping, or a broad schema/collector rewrite.

## 1. Scope

This was a narrow, read-only review pass focused on real queued Gemini output quality at the current landed boundary `7d11a21`.

Reviewed surfaces:

- real `post_observations`
- real Gemini `processed_payloads`
- real derived `listing_records`
- the current Gemini processing + storage mapping code paths

Primary provenance used:

- run: `2026-03-13T00-35-05-584Z`
- source key: `facebook-default`
- processor provenance: `gemini-structured-v1 | gemini-processed-payload-v1 | gemini-3-flash-preview`

Read-only confirmation:

- no code edits
- no prompt/schema/normalization/collector changes
- no fresh crawl or processing
- the only repo edit in this pass is this doc

## 2. Dataset Reviewed

- Run IDs reviewed: `2026-03-13T00-35-05-584Z`
- Source keys reviewed: `facebook-default`
- Observations reviewed: `12`
  - full fresh canonical Gemini cohort, not a sample
  - reviewed observations: `obs_000096`, `obs_000097`, `obs_000098`, `obs_000099`, `obs_000100`, `obs_000101`, `obs_000102`, `obs_000104`, `obs_000105`, `obs_000106`, `obs_000107`, `obs_000108`
- Processed payloads reviewed: `12`
- Canonical current Gemini listing rows reviewed: `13`
  - `obs_000102` produced `2` canonical rows
- Raw artifacts spot-checked: `4`
  - `24435663062798266-024.json`
  - `24424959913868581-027.json`
  - `24431597633204809-024.json`
  - `24441484092216163-020.json`

Important cohort note:

- `inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z` returns `30` rows for the run overall, but only `13` of those are the current canonical Gemini rows.
- The rest are transitional inline heuristic rows plus isolated validation provenance rows from the hardening/same-batch passes.

## 3. Method

How the cohort was chosen:

- started with storage inspection, not assumptions
- discovered the real source key from storage: `facebook-default`
- selected run `2026-03-13T00-35-05-584Z` because it is the latest run with a complete fresh canonical Gemini cohort:
  - `12` eligible fresh observations
  - `12` processed canonical Gemini jobs
  - `0` retryable jobs
  - no need to collect a fresh sample

How cases were selected:

- the full canonical fresh cohort was small enough to review end to end, so I reviewed all `12` observations / `12` processed payloads / `13` canonical listing rows
- representative findings were then chosen from that full review to cover:
  - offering
  - wanted
  - multi-listing
  - multi-location
  - ambiguous-date
  - truncated-source cases

No SQL was used.
The existing inspection CLIs were sufficient for cohort selection, payload review, listing review, and queue validation.

Exact commands run:

```bash
npm test
npm run inspect:storage -- runs --limit 10
npm run inspect:storage -- runs --source-key facebook-default --limit 10
npm run inspect:jobs -- --status processed --limit 50
npm run inspect:jobs -- --status retryable --limit 20
npm run inspect:storage -- observations --run-id 2026-03-13T00-35-05-584Z --limit 50 --full
npm run inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z --limit 100 --full
npm run inspect:storage -- validate-run --run-id 2026-03-13T00-35-05-584Z
npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --process-limit 0 --sample-limit 5
npm run inspect:jobs -- --run-id 2026-03-13T00-35-05-584Z --status processed --full

npm run inspect:jobs -- --run-id 2026-03-13T00-35-05-584Z --status processed --full | tail -n +4 | jq '.results[] | {jobId:.id, observationId:.observationId, processedPayloadId:.processedPayloadId, processedListingCount:.processedListingCount, authorName, postUrl, bodyText:.observationPayload.bodyText, listings:(.processedPayload.extracted.listings | map({postIntent, listingType, neighborhood:.location.neighborhood, borough:.location.borough, rawLocation:.location.rawText, amount:.pricing.amount, period:.pricing.period, roomsAvailable:.rooms.roomsAvailable, totalBedrooms:.rooms.totalBedrooms, bathrooms:.rooms.bathrooms, availableFrom:.dates.availableFrom, availableTo:.dates.availableTo, leaseTermText:.dates.leaseTermText, laundry:.features.laundry, furnished:.features.furnished, petsAllowed:.features.petsAllowed, summary:.notes.summary, ambiguities:.notes.ambiguities}))}'

npm run inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z --limit 100 --full | tail -n +4 | jq '.results | map(select(.extractorVersion=="gemini-structured-v1|gemini-processed-payload-v1|gemini-3-flash-preview")) | {count:length, results: map({listingId:.id, observationId:.observationId, postUrl, ordinal, listingType, postIntent, borough, neighborhood, priceAmount, pricePeriod, extractorVersion, payload:{postIntent:.payload.postIntent, listingType:.payload.listingType, neighborhood:.payload.location.neighborhood, borough:.payload.location.borough, rawLocation:.payload.location.rawText, amount:.payload.pricing.amount, period:.payload.pricing.period, roomsAvailable:.payload.rooms.roomsAvailable, totalBedrooms:.payload.rooms.totalBedrooms, bathrooms:.payload.rooms.bathrooms, availableFrom:.payload.dates.availableFrom, availableTo:.payload.dates.availableTo, leaseTermText:.payload.dates.leaseTermText, summary:.payload.notes.summary, ambiguities:.payload.notes.ambiguities}})}'

npm run inspect:storage -- observations --run-id 2026-03-13T00-35-05-584Z --limit 50 --full | tail -n +4 | jq '.results | map(select(.freshness=="fresh" and .postUrl != null)) | {count:length, results: map({observationId:.id, rawArtifactPath, authorName, postUrl, derivedLocation, postedAtText, hasSeeMore:.captureHints.hasSeeMore, bodyText:.bodyText})}'

jq '{postId, postUrl, bodyText, hasSeeMore, seeMoreText}' data/raw/facebook/facebook-default/2026-03-13T00-35-05-584Z/24435663062798266-024.json
jq '{postId, postUrl, bodyText, hasSeeMore, seeMoreText}' data/raw/facebook/facebook-default/2026-03-13T00-35-05-584Z/24424959913868581-027.json
jq '{postId, postUrl, bodyText, hasSeeMore, seeMoreText}' data/raw/facebook/facebook-default/2026-03-13T00-35-05-584Z/24431597633204809-024.json
jq '{postId, postUrl, bodyText, hasSeeMore, seeMoreText}' data/raw/facebook/facebook-default/2026-03-13T00-35-05-584Z/24441484092216163-020.json

node --input-type=module <<'NODE'
import { execSync } from 'node:child_process';
function parseCliJson(cmd) {
  const raw = execSync(cmd, { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(raw.split('\n').slice(3).join('\n'));
}
const jobs = parseCliJson('npm run inspect:jobs -- --run-id 2026-03-13T00-35-05-584Z --status processed --full');
const listings = parseCliJson('npm run inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z --limit 100 --full');
const canonicalVersion = 'gemini-structured-v1|gemini-processed-payload-v1|gemini-3-flash-preview';
const jobMap = new Map();
for (const job of jobs.results) {
  const extracted = job.processedPayload?.extracted?.listings || [];
  extracted.forEach((listing, ordinal) => {
    jobMap.set(`${job.observationId}:${ordinal}`, {
      postIntent: listing.postIntent,
      listingType: listing.listingType,
      borough: listing.location?.borough ?? null,
      neighborhood: listing.location?.neighborhood ?? null,
      priceAmount: listing.pricing?.amount ?? null,
      pricePeriod: listing.pricing?.period ?? null,
      availableFrom: listing.dates?.availableFrom ?? null,
      availableTo: listing.dates?.availableTo ?? null,
      totalBedrooms: listing.rooms?.totalBedrooms ?? null,
      roomsAvailable: listing.rooms?.roomsAvailable ?? null,
    });
  });
}
const mismatches = [];
for (const listing of listings.results.filter((row) => row.extractorVersion === canonicalVersion)) {
  const key = `${listing.observationId}:${listing.ordinal}`;
  const source = jobMap.get(key);
  if (!source) {
    mismatches.push({ key, reason: 'missing_processed_payload_listing' });
    continue;
  }
  const compare = {
    postIntent: listing.postIntent,
    listingType: listing.listingType,
    borough: listing.borough,
    neighborhood: listing.neighborhood,
    priceAmount: listing.priceAmount,
    pricePeriod: listing.pricePeriod,
    availableFrom: listing.payload?.dates?.availableFrom ?? null,
    availableTo: listing.payload?.dates?.availableTo ?? null,
    totalBedrooms: listing.payload?.rooms?.totalBedrooms ?? null,
    roomsAvailable: listing.payload?.rooms?.roomsAvailable ?? null,
  };
  for (const [field, expected] of Object.entries(source)) {
    if (compare[field] !== expected) mismatches.push({ key, listingId: listing.id, field, expected, actual: compare[field] });
  }
}
console.log(JSON.stringify({
  canonicalProcessedListings: jobMap.size,
  canonicalListingRows: listings.results.filter((row) => row.extractorVersion === canonicalVersion).length,
  mismatchCount: mismatches.length,
  mismatches,
}, null, 2));
NODE
```

## 4. Findings Table

| IDs | Short description | Bucket | Evidence | Where mismatch first appears | Recommended fix type |
| --- | --- | --- | --- | --- | --- |
| `obs_000108 / job_000042 / ppd_000042 / lst_000050` | Two non-contiguous sublet windows were flattened into one continuous availability span | `schema-shape` | Raw observation says `3/11-3/16 and 4/14 - 5/4`. Gemini stored `availableFrom=2026-03-11` and `availableTo=2026-05-04` while keeping the original text only in `leaseTermText`. The canonical listing row copies that same continuous span. | `processed_payloads.extracted.listings[0].dates` | `schema` |
| `obs_000104 / job_000038 / ppd_000038 / lst_000046` | Alternative neighborhoods and bedroom options were collapsed to one exact choice | `schema-shape` | Raw observation says `Greenpoint/Williamsburg 1 or 2 bed`. Gemini stored `neighborhood=Greenpoint` and `totalBedrooms=1`. The canonical listing row matches those flattened values. | `processed_payloads.extracted.listings[0].location` and `.rooms` | `schema` |
| `obs_000104 / job_000038 / ppd_000038 / lst_000046` | Deadline language was converted into an exact start date | `prompt/model-behavior` | Raw observation says `I need to move in before April 1.` Gemini stored `availableFrom=2026-04-01`. The listing row preserves the exact date even though the source expressed a deadline, not a start date. | `processed_payloads.extracted.listings[0].dates.availableFrom` | `prompt` |
| `obs_000102 / job_000037 / ppd_000037 / lst_000044,lst_000045` | Offered room-fill post split correctly, but both rows landed as `roommate_search` instead of room inventory | `prompt/model-behavior` | Raw observation says `Looking for 2 roommates` and gives two room prices (`~$2000` and `~$1700`). Gemini correctly produced two listings with `postIntent=offering`, but both have `listingType=roommate_search`. The canonical rows copy that type. Existing repo intent from the 2026-03-12 listing pass and `test/listing-extractor.test.js` is that offered room-fill posts should stay room listings, not `roommate_search`. | `processed_payloads.extracted.listings[*].listingType` | `prompt` |
| `obs_000098 / job_000033 / ppd_000034 / lst_000041` | Search constraint was misread as actual apartment size | `prompt/model-behavior` | Raw observation says `3 bed max.` Gemini stored `totalBedrooms=3` even though the post does not describe an actual apartment yet. The canonical listing row copies that bedroom count into payload JSON. | `processed_payloads.extracted.listings[0].rooms.totalBedrooms` | `prompt` |
| `obs_000100 / job_000035 / ppd_000035 / lst_000042` | `See more` truncation removed upstream detail before Gemini ever ran | `source-data/provenance` | Raw artifact body is only `Mar 1 ... Hi everyone, ... See more`. The normalized observation is equally truncated. Gemini could only extract a partial room listing with `price=null`; the listing row matches that limited input. | Raw artifact / `post_observations.payload_json` | `collector/provenance` |
| `obs_000106 / job_000040 / ppd_000040 / lst_000048` | Lease-takeover post is truncated before price/date detail, so Gemini only preserves missing-field ambiguity | `source-data/provenance` | Raw artifact ends with `See more`. The stored observation has no price or date lines. Gemini returns `price=null`, `availableFrom=null`, `availableTo=null` and notes the truncation; the listing row matches that. | Raw artifact / `post_observations.payload_json` | `collector/provenance` |
| `run 2026-03-13T00-35-05-584Z` | Run-level listing counts are operationally noisy because the run mixes transitional inline rows and multiple queue provenances | `operational but not quality` | `validate-run` reports `summary.extractedListings=12` vs `listingCount=30`. After filtering by current canonical extractor version, only `13` rows belong to the current canonical Gemini cohort. | Run summary / inspection surface, not the Gemini payloads | `no action/acceptable ambiguity` |

What the representative findings show, explicitly:

- Raw source or observation content was enough to trace every reviewed mismatch back to the first failing layer.
- In every quality finding above, the canonical `listing_records` row matched the already-wrong canonical Gemini payload.
- No reviewed mismatch first appeared in `listing_records` normalization/mapping.

## 5. Failure Summary

Grouped counts below are counts of representative findings in this review, not distinct observations:

- `prompt/model-behavior`: `3`
- `schema-shape`: `2`
- `normalization/mapping`: `0`
- `source-data/provenance`: `2` representative findings in the table, with the same upstream truncation pattern also visible on `obs_000096`
- `operational but not quality`: `1`

Common issues:

- Gemini still chooses exact scalar values when the post actually expresses alternatives, constraints, or maxima.
- `See more` truncation is still present in several real fresh observations and directly limits downstream quality.

Edge-case issues:

- Non-contiguous date windows are currently unrepresentable without flattening or losing structure.

Highest-impact issues for user-facing listing quality:

- `listingType=roommate_search` on offered room-fill posts will hurt any future room/entire-unit filters.
- Exact-date fabrication from deadline/option language creates false certainty in availability filters.
- Upstream `See more` truncation causes missing price/date details before Gemini has a chance to help.

What did not fail in this cohort:

- `postUrl` provenance stayed intact from observation -> processed payload -> listing row in all reviewed canonical rows.
- The selected canonical row fields matched the canonical processed payloads on all `13` canonical current Gemini listing rows reviewed.

## 6. Recommended Next Implementation Pass

Exactly one next pass:

### `PROMPT_GUARDRAIL_PASS_FOR_AMBIGUOUS_GEMINI_SCALARS`

Scope:

- change the queued Gemini prompt/examples only
- do not change queue logic
- do not change `listing_records` mapping
- do not do a broad schema redesign
- do not do collector work in the same pass

Target behavior:

- when the post expresses alternatives or constraints (`or`, `before`, `max`, multiple neighborhoods), Gemini should prefer `null` plus explicit ambiguity text over inventing a single exact scalar
- offered room-fill posts should stay room inventory (`room_in_shared` or split room rows), not `roommate_search`
- validation cohort should explicitly include:
  - `obs_000102` for offered room-fill typing
  - `obs_000104` for alternative neighborhoods/bedrooms and deadline wording
  - `obs_000098` for `3 bed max` vs actual bedroom count

Why this should be the next pass:

- it is the narrowest fix surface touching the largest still-current quality bucket on complete observations
- the review found `0` normalization/mapping failures, so the next pass should not target storage mapping
- queue hardening is not implicated by the reviewed quality failures
- the schema limitation on non-contiguous date windows is real, but it hit fewer reviewed cases than the prompt/model false-certainty problems

## 7. Validation

Commands rerun during this review:

- `npm test`
- `npm run inspect:storage -- runs --limit 10`
- `npm run inspect:storage -- runs --source-key facebook-default --limit 10`
- `npm run inspect:jobs -- --status processed --limit 50`
- `npm run inspect:jobs -- --status retryable --limit 20`
- `npm run inspect:storage -- observations --run-id 2026-03-13T00-35-05-584Z --limit 50 --full`
- `npm run inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z --limit 100 --full`
- `npm run inspect:storage -- validate-run --run-id 2026-03-13T00-35-05-584Z`
- `npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --process-limit 0 --sample-limit 5`
- raw artifact spot checks via `jq`
- one CLI-driven row/payload comparison confirming `13` canonical processed listings == `13` canonical listing rows and `0` selected-field mismatches

Sanity checks used:

- confirmed the chosen run is a real stored crawl run, not fixtures
- confirmed the current canonical Gemini cohort is complete (`12 processed`, `0 pending`, `0 retryable`)
- filtered `listing_records` by canonical extractor version so transitional inline rows did not contaminate the quality review
- traced suspicious rows back to raw artifacts before assigning blame to Gemini

Confirmation on real data:

- all conclusions in this pass came from real stored observations, real raw artifacts, real `processed_payloads`, and real `listing_records`
- no synthetic-only fixtures were used to reach the findings above

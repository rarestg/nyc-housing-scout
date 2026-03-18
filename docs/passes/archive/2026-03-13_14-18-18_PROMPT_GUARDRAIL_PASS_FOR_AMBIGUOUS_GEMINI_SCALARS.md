# Prompt Guardrail Pass For Ambiguous Gemini Scalars - 2026-03-13

## Scope

Tightened the queued Gemini prompt only in `src/processing/gemini/structured-output-experiment.js`.

This pass did not change:

- queue mechanics
- `listing_records` mapping
- schema shape
- collector/provenance behavior
- ingest-loop docs or implementation

Primary target:

- reduce false certainty in `processed_payloads` for complete observations
- keep offered room-fill posts as offered room inventory
- preserve `postUrl` through the existing queue -> payload -> listing path

## Files Changed

- `src/processing/gemini/structured-output-experiment.js`
- `test/gemini-structured-output.test.js`
- `docs/passes/2026-03-13_14-18-18_PROMPT_GUARDRAIL_PASS_FOR_AMBIGUOUS_GEMINI_SCALARS.md`

## What Changed

- added compact prompt rules to prefer `null` over invented scalar certainty for:
  - alternatives
  - constraints
  - maxima
  - deadline language
- added a specific prompt rule that offered room-fill posts with concrete priced rooms should stay `offering` room inventory, not `roommate_search`
- added a prompt rule to infer the year for concrete offered month/day dates from `observation.capturedAt`
- added deterministic prompt-builder coverage so the guardrails are pinned locally without depending on live Gemini wording

## Exact Commands Run

### Local tests

```bash
node --test test/gemini-structured-output.test.js
npm test
node --test test/gemini-structured-output.test.js
npm test
```

### Baseline inspection for the reviewed failures

```bash
npm run inspect:jobs -- --status processed --limit 100 --full | tail -n +4 | jq '.results[] | select(.observationId=="obs_000102" or .observationId=="obs_000104" or .observationId=="obs_000098") | {observationId, postUrl, bodyText:.observationPayload.bodyText, extracted:(.processedPayload.extracted.listings | map({postIntent, listingType, neighborhood:.location.neighborhood, borough:.location.borough, amount:.pricing.amount, roomsAvailable:.rooms.roomsAvailable, totalBedrooms:.rooms.totalBedrooms, availableFrom:.dates.availableFrom, availableTo:.dates.availableTo, leaseTermText:.dates.leaseTermText, ambiguities:.notes.ambiguities, summary:.notes.summary}))}'
npm run inspect:storage -- observations --run-id 2026-03-13T00-35-05-584Z --limit 50 --full | tail -n +4 | jq '.results[] | select(.id=="obs_000102" or .id=="obs_000104" or .id=="obs_000098") | {id, postUrl, authorName, postedAtText, captureHints, derivedLocation, bodyText}'
```

### Intermediate live validation

This first isolated run exposed one residual prompt issue on `obs_000102`: the room typing was fixed, but Gemini backdated `4/1` to `2025-04-01`. I added one more prompt line about inferring yearless concrete offered dates from `observation.capturedAt`, then reran the validation from scratch under fresh isolated provenance.

```bash
npm run validate:queue -- --observation-id obs_000102 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run validate:queue -- --observation-id obs_000104 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run validate:queue -- --observation-id obs_000098 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000102 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000104 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000098 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails --schema-version gemini-processed-payload-v1-prompt-guardrails --model-name gemini-3-flash-preview
npm run inspect:storage -- observations --run-id 2026-03-13T00-35-05-584Z --limit 50 --full | tail -n +4 | jq '.results[] | select(.id=="obs_000102") | {id, capturedAt, postedAtText, bodyText}'
```

### Final live validation

Final isolated provenance used for the pass evidence:

- `processorVersion`: `gemini-structured-v1-prompt-guardrails-final`
- `schemaVersion`: `gemini-processed-payload-v1-prompt-guardrails-final`
- `modelName`: `gemini-3-flash-preview`

```bash
npm run validate:queue -- --observation-id obs_000102 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run validate:queue -- --observation-id obs_000104 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run validate:queue -- --observation-id obs_000098 --process-limit 0 --sample-limit 1 --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000102 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000104 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run process:jobs -- --observation-id obs_000098 --limit 1 --env-file data/cache/gemini/gemini.env --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview
npm run inspect:jobs -- --status processed --limit 20 --processor-version gemini-structured-v1-prompt-guardrails-final --schema-version gemini-processed-payload-v1-prompt-guardrails-final --model-name gemini-3-flash-preview --full | tail -n +4 | jq '.results[] | select(.observationId=="obs_000102" or .observationId=="obs_000104" or .observationId=="obs_000098") | {jobId:.id, observationId, postUrl, sourcePostUrl:.processedPayload.extracted.structuredData.source.postUrl, extracted:(.processedPayload.extracted.listings | map({postIntent, listingType, neighborhood:.location.neighborhood, borough:.location.borough, rawLocation:.location.rawText, amount:.pricing.amount, roomsAvailable:.rooms.roomsAvailable, totalBedrooms:.rooms.totalBedrooms, availableFrom:.dates.availableFrom, availableTo:.dates.availableTo, leaseTermText:.dates.leaseTermText, ambiguities:.notes.ambiguities, summary:.notes.summary}))}'
npm run inspect:storage -- listings --run-id 2026-03-13T00-35-05-584Z --limit 100 --full | tail -n +4 | jq '.results | map(select(.extractorVersion=="gemini-structured-v1-prompt-guardrails-final|gemini-processed-payload-v1-prompt-guardrails-final|gemini-3-flash-preview" and (.observationId=="obs_000102" or .observationId=="obs_000104" or .observationId=="obs_000098"))) | map({listingId:.id, observationId, ordinal, postUrl, extractorVersion, listingType, postIntent, borough, neighborhood, priceAmount, payload:{postIntent:.payload.postIntent, listingType:.payload.listingType, neighborhood:.payload.location.neighborhood, borough:.payload.location.borough, rawLocation:.payload.location.rawText, amount:.payload.pricing.amount, roomsAvailable:.payload.rooms.roomsAvailable, totalBedrooms:.payload.rooms.totalBedrooms, availableFrom:.payload.dates.availableFrom, availableTo:.payload.dates.availableTo, leaseTermText:.payload.dates.leaseTermText, ambiguities:.payload.notes.ambiguities, summary:.payload.notes.summary}})'
```

## Before / After Findings

### `obs_000102`

Before at canonical boundary:

- split into two listings correctly
- both listings typed `roommate_search`
- `postIntent` already `offering`

After final prompt-guardrail provenance:

- still split into two listings
- both listings now typed `room_in_shared`
- `postIntent` stayed `offering`
- `availableFrom` resolved to `2026-04-01`
- `postUrl` matched observation -> processed payload -> listing row

Result:

- direct hit on the primary room-fill misclassification

### `obs_000104`

Before at canonical boundary:

- `neighborhood=Greenpoint`
- `totalBedrooms=1`
- `amount=3200`
- `availableFrom=2026-04-01`
- source actually said `Greenpoint/Williamsburg`, `1 or 2 bed`, and `before April 1`

After final prompt-guardrail provenance:

- `neighborhood=null`
- `totalBedrooms=null`
- `amount=null`
- `availableFrom=null`
- `leaseTermText="move in before April 1"`
- ambiguity text now explicitly preserves:
  - neighborhood alternatives
  - bedroom alternatives
  - budget as a max constraint
  - move-in as a deadline constraint

Residual:

- `listingType` drifted from `entire_apartment` to `unknown`; the scalar false-certainty problem improved, but listing-type specificity is now weaker on this observation

### `obs_000098`

Before at canonical boundary:

- `listingType=roommate_search`
- `totalBedrooms=3`
- `availableFrom=2026-04-01`
- source actually said `3 bed max` and `I do not have a place yet`

After final prompt-guardrail provenance:

- `listingType` stayed `roommate_search`
- `totalBedrooms=null`
- ambiguity text now explicitly says `3 bed max` is a maximum constraint, not a fixed bedroom count
- `postUrl` matched observation -> processed payload -> listing row

Residual:

- `availableFrom` still landed as `2026-04-01` even though this is a wanted post without a concrete property; that remains a prompt/model behavior gap

## What Improved

- the dominant reviewed `obs_000102` failure was fixed in the intended layer: `processed_payloads`
- `obs_000104` stopped inventing exact scalar certainty for neighborhood, bedrooms, price, and `before April 1`
- `obs_000098` stopped treating `3 bed max` as an actual apartment bedroom count
- `postUrl` provenance remained intact on all three observations
- no queue or listing-mapping changes were needed

## What Remained Out Of Scope

- multi-window dates remain a schema limitation and were not changed here
- `See more` truncation remains a collector/provenance limitation and was not changed here

## Verification

- `node --test test/gemini-structured-output.test.js`
- `npm test`
- real queue validation with isolated provenance on:
  - `obs_000102`
  - `obs_000104`
  - `obs_000098`
- inspected both:
  - `processed_payloads` via `inspect:jobs`
  - derived `listing_records` via `inspect:storage -- listings`

## Next Bottleneck

The next narrow quality bottleneck is still prompt/model behavior on wanted move-in dates and listing-type specificity after ambiguity guardrails are applied.

Specifically:

- wanted/search posts can still convert target move-in language into exact `availableFrom`
- `obs_000104` shows the prompt can now over-null `listingType` when the base housing category is still reasonably clear

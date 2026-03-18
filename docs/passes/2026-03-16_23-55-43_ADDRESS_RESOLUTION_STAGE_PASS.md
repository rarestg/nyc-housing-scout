# Address Resolution Stage Pass

## 1. Scope

Implemented Worker 3 for the evidence resolution milestone:

- add an independently runnable NYC-constrained `resolve:addresses` stage on top of persisted `evidence_fragments`
- write generic `resolved_fields` rows for listing location fields
- make ambiguity and no-signal cases explicit instead of silently guessing
- preserve supporting fragment references for explainability
- add the minimal inspection/docs surface for resolved rows

Explicit non-goals:

- no manual overrides
- no review/correction UI
- no raw-row mutation

## 2. Files Changed

- `src/core/address-resolution.js`
- `src/processing/run-address-resolution.js`
- `src/cli/resolve-addresses.js`
- `src/cli/inspect-storage.js`
- `src/storage/sqlite-storage.js`
- `package.json`
- `test/address-resolution.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_23-55-43_ADDRESS_RESOLUTION_STAGE_PASS.md`

## 3. Implementation Notes

Added a pure resolver module in `src/core/address-resolution.js` with a fixed tuple:

- `resolutionKind = address_resolution`
- `resolverVersion = nyc-address-resolver-v1`

Current stage behavior:

- `runAddressResolution(...)` targets `listing_record` rows
- reads persisted observation-scoped location fragments:
  - `location.address`
  - `location.neighborhood`
  - `location.borough`
- emits one `resolved_fields` row per listing for:
  - `location.address`
  - `location.neighborhood`
  - `location.borough`
  - `location.city`
  - `location.state`

Status contract:

- `accepted`
  - one strong NYC-constrained value
- `candidate`
  - best available value exists but is below acceptance threshold
- `ambiguous`
  - competing candidates stay explicit instead of forcing a winner
- `unresolved`
  - no usable location evidence or no address candidate for that field

Explainability behavior:

- accepted/candidate/ambiguous rows carry `supportingFragmentIds`
- `ambiguity_json` stores candidate alternatives when relevant
- `metadata_json` records the raw listing location snapshot plus the resolution reason

Rerun behavior:

- unchanged rows are detected and skipped
- rerunning the same observation/listing scope does not churn `resolved_fields`

Inspection surfaces:

- new stage CLI: `npm run resolve:addresses -- ...`
- new inspection subcommand: `npm run inspect:storage -- resolved -- ...`

## 4. Exact Commands Run

Context reads:

```bash
sed -n '1,220p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/README.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/01_REPO_STATE_SYNTHESIS.txt
sed -n '1,320p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/02_STORAGE_AND_PRECEDENCE_DESIGN.txt
sed -n '1,320p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/03_EXECUTION_PLAN.txt
sed -n '1,280p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/04_DISPATCH_PROTOCOL.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/05_COORDINATION_BOARD.txt
sed -n '1,220p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/handoffs/worker_1_status.txt
sed -n '1,240p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/handoffs/worker_2_status.txt
sed -n '1,320p' docs/notes/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_OVERRIDE_DESIGN.md
sed -n '300,760p' src/storage/sqlite-storage.js
sed -n '1720,1905p' src/storage/sqlite-storage.js
sed -n '1,260p' src/core/evidence-fragments.js
sed -n '1,260p' src/core/neighborhoods.js
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,240p' docs/passes/README.md
```

Checks and targeted tests:

```bash
node --check src/core/address-resolution.js
node --check src/processing/run-address-resolution.js
node --check src/cli/resolve-addresses.js
node --check src/cli/inspect-storage.js
node --check test/address-resolution.test.js
node --test test/address-resolution.test.js
node --test test/evidence-resolution-storage.test.js
node --test test/evidence-enrichment.test.js
node --test test/storage-inspection.test.js
```

Live validation:

```bash
npm run enrich:evidence -- --source-key williamsburggreenpointhousing --limit 10
npm run resolve:addresses -- --source-key williamsburggreenpointhousing --limit 5
npm run enrich:evidence -- --observation-id obs_001207
npm run resolve:addresses -- --observation-id obs_001207
npm run inspect:storage -- resolved --observation-id obs_001207 --target-kind listing_record --resolver-version nyc-address-resolver-v1 --resolution-kind address_resolution --limit 10
npm run resolve:addresses -- --observation-id obs_001207
```

Full validation:

```bash
npm test
```

## 5. Validation Results

Targeted:

- `node --test test/address-resolution.test.js`
  - `3/3` passing
- `node --test test/evidence-resolution-storage.test.js`
  - `1/1` passing
- `node --test test/evidence-enrichment.test.js`
  - `3/3` passing
- `node --test test/storage-inspection.test.js`
  - `2/2` passing

Live stage validation on real local data:

- `npm run enrich:evidence -- --source-key williamsburggreenpointhousing --limit 10`
  - scanned `100` observations
  - enriched `10`
  - wrote `103` fragments
- `npm run resolve:addresses -- --source-key williamsburggreenpointhousing --limit 5`
  - scanned `100` listings
  - resolved `5`
  - wrote `25` rows
  - top-of-scope listings without evidence fragments landed as explicit `unresolved` rows instead of silent guesses
- `npm run resolve:addresses -- --observation-id obs_001207`
  - resolved `1` listing
  - wrote `5` rows for `lst_000263`
  - accepted:
    - `location.neighborhood = Greenpoint`
    - `location.borough = Brooklyn`
    - `location.city = New York`
    - `location.state = NY`
  - explicit unresolved:
    - `location.address` with reason `no_address_candidates`
- rerunning `npm run resolve:addresses -- --observation-id obs_001207`
  - wrote `0`
  - `unchangedCount = 5`

Full suite:

- `npm test`
  - `104/104` passing

## 6. Notes For Worker 4

- Resolved rows now exist for location fields even when the answer is `candidate`, `ambiguous`, or `unresolved`; Worker 4 should preserve those states instead of flattening them away.
- `inspect-storage resolved` is available for field-level debugging without raw SQL.
- `location.city` / `location.state` are now resolver-produced NYC fallthrough fields when borough/neighborhood evidence is sufficient.
- Broad resolver runs can intentionally materialize explicit unresolved rows for listings that have not yet been enriched; that is part of the current provenance contract, not a write bug.

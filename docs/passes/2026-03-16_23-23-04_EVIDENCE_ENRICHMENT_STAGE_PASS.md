# Evidence Enrichment Stage Pass

## 1. Scope

Implemented Worker 2 for the evidence resolution milestone:

- add an observation-scoped evidence enrichment stage on top of the new `evidence_fragments` table
- extract reusable fragments from persisted observation inputs only
- cover body text, comments, media metadata, capture-derived metadata, network-enrichment metadata, and obvious contact/outbound references already present in stored inputs
- add a dedicated stage CLI plus an inspection surface for stored evidence
- keep `post_observations` immutable

Explicit non-goals:

- no address resolution yet
- no effective-value read model changes
- no manual override or review API work
- no UI work

## 2. Files Changed

- `src/core/evidence-fragments.js`
- `src/processing/run-evidence-enrichment.js`
- `src/cli/enrich-evidence.js`
- `src/cli/inspect-storage.js`
- `src/storage/sqlite-storage.js`
- `package.json`
- `test/evidence-enrichment.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_23-23-04_EVIDENCE_ENRICHMENT_STAGE_PASS.md`

## 3. Implementation Notes

Added a pure evidence builder in `src/core/evidence-fragments.js` with a fixed producer tuple:

- `producerKind = observation_enrichment`
- `producerVersion = evidence-enrichment-v1`

Current fragment coverage:

- `body_text`
  - address candidates
  - neighborhood / borough candidates
  - price / bedroom / bathroom / availability candidates
  - email / phone / Instagram / Telegram / WhatsApp / outbound URL references
- `comments`
  - the same text-derived evidence paths as body text, scoped to `/comments/<index>`
- `media`
  - one fragment per normalized media item
  - attachment-summary fragment when present in payload metadata
- `capture_metadata`
  - capture provenance fragment
  - derived neighborhood / borough fragments from stored observation metadata
- `network_enrichment`
  - one fragment for stored `captureHints.networkEnrichment`
  - one Facebook identity fragment when `storyId`, `feedbackId`, `authorId`, or `authorUrl` exists

Stage behavior:

- `runEvidenceEnrichment(...)` reads persisted observations with full text, collections, and payload
- default reruns skip observations that already have fragments for the same producer kind/version
- writes only to `evidence_fragments`
- never rewrites `post_observations`

Operator surfaces:

- new stage CLI: `npm run enrich:evidence -- ...`
- new inspection subcommand: `npm run inspect:storage -- evidence -- ...`

## 4. Exact Commands Run

Context reads:

```bash
sed -n '1,260p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/README.txt
sed -n '1,240p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/01_REPO_STATE_SYNTHESIS.txt
sed -n '1,240p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/02_STORAGE_AND_PRECEDENCE_DESIGN.txt
sed -n '1,260p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/03_EXECUTION_PLAN.txt
sed -n '1,240p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/04_DISPATCH_PROTOCOL.txt
sed -n '1,240p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/05_COORDINATION_BOARD.txt
sed -n '1,240p' src/ui/planning/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/handoffs/worker_1_status.txt
sed -n '1,260p' docs/notes/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_OVERRIDE_DESIGN.md
sed -n '1,260p' src/storage/sqlite-storage.js
sed -n '1600,1905p' src/storage/sqlite-storage.js
sed -n '1,260p' src/core/collected-post.js
sed -n '1,260p' src/extractors/text-extractor.js
sed -n '1,240p' src/core/neighborhoods.js
sed -n '1,280p' docs/PIPELINE.md
sed -n '1,220p' docs/passes/README.md
```

Checks and targeted tests:

```bash
node --check src/core/evidence-fragments.js
node --check src/processing/run-evidence-enrichment.js
node --check src/cli/enrich-evidence.js
node --check test/evidence-enrichment.test.js
node --test test/evidence-enrichment.test.js
node --test test/evidence-resolution-storage.test.js
node --test test/storage-inspection.test.js
```

Live validation:

```bash
npm run enrich:evidence -- --source-key williamsburggreenpointhousing --limit 5
npm run inspect:storage -- evidence --source-key williamsburggreenpointhousing --producer-kind observation_enrichment --producer-version evidence-enrichment-v1 --limit 10
npm run enrich:evidence -- --observation-id obs_000917
npm run inspect:storage -- evidence --observation-id obs_000917 --producer-kind observation_enrichment --producer-version evidence-enrichment-v1 --limit 20
```

Full validation:

```bash
npm test
```

## 5. Validation Results

Targeted:

- `node --test test/evidence-enrichment.test.js`
  - `3/3` passing
- `node --test test/evidence-resolution-storage.test.js`
  - `1/1` passing
- `node --test test/storage-inspection.test.js`
  - `2/2` passing

Live stage validation on real local data:

- `npm run enrich:evidence -- --source-key williamsburggreenpointhousing --limit 5`
  - scanned `100` observations
  - enriched `5` observations
  - wrote `45` fragments
- `npm run enrich:evidence -- --observation-id obs_000917`
  - enriched `1` observation with stored network metadata
  - wrote `14` fragments across `body_text`, `media`, `capture_metadata`, and `network_enrichment`

Full suite:

- `npm test`
  - `98/98` passing

## 6. Notes For Worker 3

- Address-resolution input is now available through `listEvidenceFragments(...)`.
- Location fragments currently land on:
  - `location.address`
  - `location.neighborhood`
  - `location.borough`
- Provenance fragments are also available when needed:
  - `provenance.capture`
  - `provenance.networkEnrichment`
  - `provenance.facebookIdentity`
- Rerunning the same producer version skips already-enriched observations by default; if Worker 3 needs a new fragment contract, bump the producer version instead of relying on duplicate writes.

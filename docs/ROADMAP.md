# Roadmap

Compact working roadmap for `nyc-housing-scout`.

## Current Phase

We are hardening the first deploy slice: trustworthy local collection, one supported operator workflow, minimal reliability guardrails, and a hosted public read path sourced from local canonical SQLite.

The fuller end-state still includes a robust multi-source runtime and a repo-owned browser bridge, but those are no longer the immediate blocker for the first deploy slice.

## Completed

- Project bootstrap and folder layout
- DOM-based Facebook collection path
- SQLite-backed storage layer
- Source / run / observation / listing persistence
- Storage inspection / validation CLI
- Collector metadata hardening passes
- Collector simplification and network-assisted identity recovery passes
- Listing extraction quality passes
- Processing pipeline skeleton
- Real queue validation on live crawl data
- Strategy reviews for crawl policy and scale architecture

## In Progress / Next

### 1. First deploy hardening
- [ ] deterministic source preflight
- [ ] top-of-feed reset / latest-anchor behavior
- [ ] overlap-anchor stop rules and stale-zone / seen-threshold stop policy
- [ ] Facebook identity merge/reuse hardening plus real regression fixtures
- [ ] storage modularization for `src/storage/sqlite-storage.js` so schema and query changes stop depending on a 5k+ line file
- [ ] one supported operator workflow over the existing stage CLIs
- [ ] minimal reliability telemetry for crawl failure, zero-yield drift, queue backlog, and publish failure
- [ ] publish a hosted read side from local canonical SQLite

This is the current recommended next milestone. For the rationale and handoff context, see `docs/notes/2026-03-18_01-41-19_PM_HANDOFF_FIRST_DEPLOY_SLICE.md` and `docs/notes/2026-03-18_01-36-14_ENG_STATUS_AND_DEPLOY_PRIORITIES_MEMO.md`.

### 2. Storage modularization and schema cleanup
- [ ] split `src/storage/sqlite-storage.js` into focused modules by concern instead of one giant file
- [ ] move dashboard/read-model presentation logic out of the storage layer
- [ ] keep canonical write operations, queue/evidence operations, and read helpers independently understandable
- [ ] make upcoming data-model and DB interaction changes cheaper and easier to validate
- [ ] once the first-deploy schema is trustworthy, reset the local DB baseline and squash historical migrations into one clean starting migration

The refactor input for this work lives at `docs/reviews/2026-03-17_17-10-01_SQLITE_STORAGE_REFACTOR_REVIEW.md`.

### 3. Multi-source collector runtime and browser boundary
- [ ] make source metadata and source-specific browser ownership first-class
- [ ] replace the current implicit attached-tab assumption with explicit source-to-tab targeting
- [ ] add source/tab lease and recovery state for safe parallel collection
- [ ] remove the hard dependency on external browser-control tooling by owning a narrow browser bridge
- [ ] support continuous ingest across multiple Facebook groups on one machine without source collisions

This remains the locked end-state runtime direction, but it is not the blocker for the first deploy slice.

### 4. Processing pipeline skeleton
- [x] processing jobs table/model
- [x] atomic claim semantics
- [x] processing status lifecycle
- [x] CLI for enqueue / process / inspect / retry jobs
- [x] replay / reprocess hooks
- [ ] make collection loops enqueue-first and keep extraction work in central queue workers
- [ ] harden concurrent writer/worker behavior for always-on multi-source ingest

### 5. Structured LLM extraction
- [x] define extraction schema
- [x] Gemini structured output integration
- [x] persist raw processed payloads with provenance
- [x] map processed payloads into normalized listing records
- [x] dry-run extraction CLI for N posts/jobs
- [x] timeout/retry hardening for live Gemini queue processing
- [ ] review real processed payloads and tune prompt/schema/normalization from observed failures

### 6. Frontend-oriented query surface
- [x] listing query helpers / views
- [x] filters for borough / neighborhood / price / beds / listing type / intent
- [x] unresolved / low-confidence / ambiguous review views

### 7. Evidence resolution and review foundation
- [x] storage contract for evidence fragments / resolved fields / manual overrides / audit
- [x] storage-level effective-value precedence helper
- [x] listings / review read helpers that apply raw + resolved + manual precedence
- [x] observation-scoped evidence enrichment stage
- [x] NYC-constrained address resolution stage
- [x] Review-oriented correction API / workflow boundary
- [x] layered frontend surfacing for raw / resolved / manual values
- [x] Review-only manual correction UI with Listings / Debug boundary preserved

### 8. Hosted public read model
- [ ] define the public read-side contract for first deploy
- [ ] define the public-safe listing/source contract and redaction boundary
- [ ] publish a curated hosted read model from local canonical SQLite
- [ ] keep operator-only state local/private by default
- [ ] ship a hosted public frontend against the published read model

## Later

- [ ] optional image-aware enrichment
- [ ] broader geocoding beyond the first NYC-constrained address pass
- [ ] map view
- [ ] saved searches / alerting on effective listing values

## Notes

This doc should stay short.
If something needs a long explanation, put it in a dedicated design doc and link to it from here.

For the cross-workstream shipping path, see `docs/SHIP_PLAN.md`.

# Roadmap

Compact working roadmap for `nyc-housing-scout`.

## Current Phase

We are transitioning from a working local operator pipeline into a robust multi-source collector plus hosted public read path.

## Completed

- Project bootstrap and folder layout
- DOM-based Facebook collection path
- SQLite-backed storage layer
- Source / run / observation / listing persistence
- Storage inspection / validation CLI
- Collector metadata hardening passes
- Listing extraction quality passes
- Processing pipeline skeleton
- Real queue validation on live crawl data
- Strategy reviews for crawl policy and scale architecture

## In Progress / Next

### 1. Multi-source collector runtime
- [ ] make source metadata and source-specific browser ownership first-class
- [ ] replace the current implicit attached-tab assumption with explicit source-to-tab targeting
- [ ] add source/tab lease and recovery state for safe parallel collection
- [ ] remove the hard dependency on external browser-control tooling by owning a narrow browser bridge
- [ ] support continuous ingest across multiple Facebook groups on one machine without source collisions

### 2. Crawl strategy hardening
- [ ] deterministic source preflight
- [ ] top-of-feed reset / latest-anchor behavior
- [ ] incremental mode vs backfill mode split
- [ ] overlap-anchor stop rules
- [ ] stale-zone / seen-threshold stop policy
- [ ] traversal metrics (`firstFreshPosition`, seen ratio, observed-per-fresh)

### 3. Processing pipeline skeleton
- [x] processing jobs table/model
- [x] atomic claim semantics
- [x] processing status lifecycle
- [x] CLI for enqueue / process / inspect / retry jobs
- [x] replay / reprocess hooks
- [ ] make collection loops enqueue-first and keep extraction work in central queue workers
- [ ] harden concurrent writer/worker behavior for always-on multi-source ingest

### 4. Structured LLM extraction
- [x] define extraction schema
- [x] Gemini structured output integration
- [x] persist raw processed payloads with provenance
- [x] map processed payloads into normalized listing records
- [x] dry-run extraction CLI for N posts/jobs
- [x] timeout/retry hardening for live Gemini queue processing
- [ ] review real processed payloads and tune prompt/schema/normalization from observed failures

### 5. Frontend-oriented query surface
- [x] listing query helpers / views
- [x] filters for borough / neighborhood / price / beds / listing type / intent
- [x] unresolved / low-confidence / ambiguous review views

### 6. Evidence resolution and review foundation
- [x] storage contract for evidence fragments / resolved fields / manual overrides / audit
- [x] storage-level effective-value precedence helper
- [x] listings / review read helpers that apply raw + resolved + manual precedence
- [x] observation-scoped evidence enrichment stage
- [x] NYC-constrained address resolution stage
- [x] Review-oriented correction API / workflow boundary
- [x] layered frontend surfacing for raw / resolved / manual values
- [x] Review-only manual correction UI with Listings / Debug boundary preserved

### 7. Hosted public read model
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

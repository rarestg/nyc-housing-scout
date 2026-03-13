# Roadmap

Compact working roadmap for `nyc-housing-scout`.

## Current Phase

We are transitioning from exploratory scraping into a modular ingestion + processing pipeline.

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

### 1. Crawl strategy hardening
- [ ] deterministic source preflight
- [ ] top-of-feed reset / latest-anchor behavior
- [ ] incremental mode vs backfill mode split
- [ ] overlap-anchor stop rules
- [ ] stale-zone / seen-threshold stop policy
- [ ] traversal metrics (`firstFreshPosition`, seen ratio, observed-per-fresh)

### 2. Processing pipeline skeleton
- [x] processing jobs table/model
- [x] atomic claim semantics
- [x] processing status lifecycle
- [x] CLI for enqueue / process / inspect / retry jobs
- [x] replay / reprocess hooks

### 3. Structured LLM extraction
- [x] define extraction schema
- [x] Gemini structured output integration
- [x] persist raw processed payloads with provenance
- [x] map processed payloads into normalized listing records
- [x] dry-run extraction CLI for N posts/jobs

### 4. Frontend-oriented query surface
- [ ] listing query helpers / views
- [ ] filters for borough / neighborhood / price / beds / listing type / intent
- [ ] unresolved / low-confidence / ambiguous review views

## Later

- [ ] optional image-aware enrichment
- [ ] geocoding
- [ ] map view
- [ ] source management for multiple Facebook groups
- [ ] controlled multi-source orchestration

## Notes

This doc should stay short.
If something needs a long explanation, put it in a dedicated design doc and link to it from here.

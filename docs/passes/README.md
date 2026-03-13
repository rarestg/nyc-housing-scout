# Passes

Dated implementation logs. Each records what changed, what improved, and what's still open.

| Doc | Area | What changed |
|-----|------|-------------|
| [2026-03-12_16-19-36_IMPLEMENTATION_PASS](2026-03-12_16-19-36_IMPLEMENTATION_PASS.md) | Pipeline structure | Introduced `CollectedPost` contract, split artifact layers, added contract tests |
| [2026-03-12_18-41-52_COLLECTOR_HARDENING_PASS](2026-03-12_18-41-52_COLLECTOR_HARDENING_PASS.md) | DOM collector | Scored ancestor picking for card boundaries, broader selectors, fixture tests |
| [2026-03-12_20-02-31_COLLECTOR_IDENTITY_PASS](2026-03-12_20-02-31_COLLECTOR_IDENTITY_PASS.md) | DOM collector | Recovered hidden identity signals — `aria-labelledby`, base64 post IDs (19/21 coverage) |
| [2026-03-12_19-17-31_DOM_METADATA_HARDENING_PASS](2026-03-12_19-17-31_DOM_METADATA_HARDENING_PASS.md) | DOM extractor | Filtered media noise, reconstructed permalinks, tightened author filtering |
| [2026-03-12_19-26-12_DOM_TIME_DEBUGGING_PASS](2026-03-12_19-26-12_DOM_TIME_DEBUGGING_PASS.md) | DOM extractor | Added debug traces for metadata candidate selection |
| [2026-03-12_19-45-23_DOM_TOP_SLICE_FALLBACK_PASS](2026-03-12_19-45-23_DOM_TOP_SLICE_FALLBACK_PASS.md) | DOM extractor | Bounded fallback search for time anchors — proved issue is card-root selection |
| [2026-03-12_20-07-13_LISTING_EXTRACTION_PASS](2026-03-12_20-07-13_LISTING_EXTRACTION_PASS.md) | Text extraction | Separated intent from listing type, scored neighborhood matching |
| [2026-03-12_17-27-10_STORAGE_INTERFACE_PASS](2026-03-12_17-27-10_STORAGE_INTERFACE_PASS.md) | Storage | Thin storage interface with domain-shaped operations, JSON placeholder |
| [2026-03-12_17-58-43_SQLITE_STORAGE_PASS](2026-03-12_17-58-43_SQLITE_STORAGE_PASS.md) | Storage | SQLite behind the storage interface — migrations, source-scoped identity |
| [2026-03-12_18-40-20_OBSERVABILITY_PASS](2026-03-12_18-40-20_OBSERVABILITY_PASS.md) | Tooling | `inspect:storage` CLI, read helpers for sources/runs/observations/listings |
| [2026-03-13_01-20-44_PROCESSING_PIPELINE_PASS](2026-03-13_01-20-44_PROCESSING_PIPELINE_PASS.md) | Processing queue | Observation-centric jobs, atomic claims, versioned processed payloads, queue CLIs |
| [2026-03-13_02-05-12_QUEUE_VALIDATION_PASS](2026-03-13_02-05-12_QUEUE_VALIDATION_PASS.md) | Queue validation | Live crawl queue coverage, repeatable enqueue/process validation, processed payload samples |

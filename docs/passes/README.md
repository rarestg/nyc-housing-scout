# Passes

Dated implementation logs. Each records what changed, what improved, and what's still open.

| Doc | Area | What changed |
|-----|------|-------------|
| [IMPLEMENTATION_PASS_2026-03-12](IMPLEMENTATION_PASS_2026-03-12.md) | Pipeline structure | Introduced `CollectedPost` contract, split artifact layers, added contract tests |
| [COLLECTOR_HARDENING_PASS_2026-03-12](COLLECTOR_HARDENING_PASS_2026-03-12.md) | DOM collector | Scored ancestor picking for card boundaries, broader selectors, fixture tests |
| [COLLECTOR_IDENTITY_PASS_2026-03-12](COLLECTOR_IDENTITY_PASS_2026-03-12.md) | DOM collector | Recovered hidden identity signals — `aria-labelledby`, base64 post IDs (19/21 coverage) |
| [DOM_METADATA_HARDENING_PASS_2026-03-12](DOM_METADATA_HARDENING_PASS_2026-03-12.md) | DOM extractor | Filtered media noise, reconstructed permalinks, tightened author filtering |
| [DOM_TIME_DEBUGGING_PASS_2026-03-12](DOM_TIME_DEBUGGING_PASS_2026-03-12.md) | DOM extractor | Added debug traces for metadata candidate selection |
| [DOM_TOP_SLICE_FALLBACK_PASS_2026-03-12](DOM_TOP_SLICE_FALLBACK_PASS_2026-03-12.md) | DOM extractor | Bounded fallback search for time anchors — proved issue is card-root selection |
| [LISTING_EXTRACTION_PASS_2026-03-12](LISTING_EXTRACTION_PASS_2026-03-12.md) | Text extraction | Separated intent from listing type, scored neighborhood matching |
| [STORAGE_INTERFACE_PASS_2026-03-12](STORAGE_INTERFACE_PASS_2026-03-12.md) | Storage | Thin storage interface with domain-shaped operations, JSON placeholder |
| [SQLITE_STORAGE_PASS_2026-03-12](SQLITE_STORAGE_PASS_2026-03-12.md) | Storage | SQLite behind the storage interface — migrations, source-scoped identity |
| [OBSERVABILITY_PASS_2026-03-12](OBSERVABILITY_PASS_2026-03-12.md) | Tooling | `inspect:storage` CLI, read helpers for sources/runs/observations/listings |

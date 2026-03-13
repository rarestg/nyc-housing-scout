# AGENTS.md

## Repo Purpose

`nyc-housing-scout` is a single-user, local-first pipeline for collecting Facebook housing posts, storing them durably, extracting structured listing data, and preparing queryable outputs for a future frontend.

## Repo Map

- `src/browser/` — browser-side DOM extraction and feed helpers
- `src/cli/` — stage-oriented command entrypoints
- `src/core/` — shared collected-post, pipeline, and normalization logic
- `src/extractors/` — heuristic listing extraction
- `src/processing/` — processing queue and processor logic
- `src/storage/` — SQLite-backed storage and migrations
- `docs/` — living architecture docs, roadmap, pipeline guide, passes, reviews, notes
- `test/` — contract and storage/CLI tests

## Sources Of Truth

Start here, in order:

1. `README.md` — current repo orientation
2. `docs/INDEX.md` — doc map
3. `docs/VISION_AND_ARCHITECTURE.md` — north star and stage definitions
4. `docs/ROADMAP.md` — what is next
5. `docs/PIPELINE.md` — operational commands and storage/crawl semantics
6. `docs/LISTING_SCHEMA.md` — normalized listing contract

For recent implementation context, read the latest relevant file in `docs/passes/`.
For older tradeoffs and investigations, use `docs/reviews/` and `docs/notes/`.

## Non-Negotiable Invariants

- This is a single-user local tool. Optimize for speed of iteration, not backward compatibility, glue layers, or migration scaffolding.
- SQLite is the system of record. Raw artifacts stay on disk. Derived exports are not canonical state.
- Keep the pipeline stage-oriented and independently operable: collect, inspect, enqueue, process, extract, review.
- Preserve provenance across stages. `postUrl` is important and should flow through collected posts, processing jobs, processed payloads, and listings.
- Observation-centric processing is the current shape. Job/payload provenance is keyed by observation plus processor/schema/model versions.
- Prefer small explicit CLIs over large orchestration systems.
- Never commit secrets. Use env vars or local env files for API keys.

## Workflow Rules

- Any new doc, note, pass log, or scratch writeup should use a New York timestamp prefix in `YYYY-MM-DD_HH-MM-SS_*` form when the filename is not otherwise fixed by convention.
- If you dispatch a worker/coding agent, start it with fresh context rather than inheriting the full conversation when that option exists. Write a self-contained task brief with the exact scope, constraints, references, write ownership, and success criteria.
- If you dispatch a worker/coding agent and have the option to wait for completion, give it at least 30 minutes before treating it as stalled.
- When the schema or storage shape needs to change, change it directly and update the current docs. Do not add compatibility shims for stale local state unless explicitly asked.

## Validation / Definition Of Done

- Run `npm test`.
- Run the relevant stage CLI(s) for the surface you changed.
- Update or add the minimal doc needed when the source of truth changes.
- Keep docs concise and link outward instead of duplicating architecture detail into this file.

## Navigation

- `docs/passes/` — recent implementation changes
- `docs/reviews/` — architectural assessments and tradeoffs
- `docs/notes/` — exploratory or superseded context

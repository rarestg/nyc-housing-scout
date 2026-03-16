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
- `src/ui/` — local inspection server, dashboard app, and UI planning artifacts
- `docs/` — living architecture docs, roadmap, pipeline guide, passes, reviews, notes
- `data/` — local artifact layout, SQLite database, cache/env conventions, and legacy-vs-active paths
- `test/` — contract and storage/CLI tests

## Sources Of Truth

Start here, in order:

1. `README.md` — current repo orientation
2. `docs/INDEX.md` — doc map
3. `docs/VISION_AND_ARCHITECTURE.md` — north star and stage definitions
4. `docs/ROADMAP.md` — what is next
5. `docs/WORKLOG.md` — terse recent decisions and progress
6. `docs/PIPELINE.md` — operational commands, crawl semantics, queue validation, and inspection surfaces
7. `docs/LISTING_SCHEMA.md` — normalized listing contract
8. `data/README.md` — local artifact layout, active vs legacy data paths, and how disk artifacts relate to SQLite
9. `docs/FACEBOOK_CAPTURE_NOTES.md` — Facebook DOM capture priorities, noise patterns, and collector assumptions

For recent implementation context, use `docs/passes/README.md` to find and then read the latest relevant file in `docs/passes/`.
For older tradeoffs and investigations, use `docs/reviews/` and `docs/notes/`.
Only treat `src/ui/planning/` as working context when you are actively changing the dashboard; it is not the canonical architecture doc set.

## Non-Negotiable Invariants

- This is a single-user local tool. Optimize for speed of iteration, not backward compatibility, glue layers, or migration scaffolding.
- SQLite is the system of record. Raw artifacts stay on disk. Derived exports are not canonical state.
- Keep the pipeline stage-oriented and independently operable: collect, inspect, enqueue, process, extract, review.
- Preserve provenance across stages. `postUrl` is important and should flow through collected posts, processing jobs, processed payloads, and listings.
- Observation-centric processing is the current shape. Job/payload provenance is keyed by observation plus processor/schema/model versions.
- Keep collection separate from heavier enrichment. Crawl/ingest and structured extraction are distinct stages.
- Prefer small explicit CLIs over large orchestration systems.
- Never commit secrets. Use env vars or local env files for API keys.

## Workflow Rules

- Any new doc, note, pass log, or scratch writeup should use a New York timestamp prefix in `YYYY-MM-DD_HH-MM-SS_*` form when the filename is not otherwise fixed by convention.
- If you dispatch a worker/coding agent, start it with fresh context rather than inheriting the full conversation when that option exists. Write a self-contained task brief with the exact scope, constraints, references, write ownership, and success criteria.
- If you dispatch a worker/coding agent, give it at least 30 minutes before treating it as stalled.
- Do not interrupt, close, cancel, or otherwise kill a dispatched worker/coding agent before that 30 minute mark just because you no longer need it. If you would not let it run, do not dispatch it in the first place.
- When the schema or storage shape needs to change, change it directly and update the current docs. Do not add compatibility shims for stale local state unless explicitly asked.

## Validation / Definition Of Done

- Run `npm test`.
- Run the relevant stage CLI(s) for the surface you changed:
  - collection/browser: `npm run capture:dom -- --source-key <key> --limit 5`, `npm run crawl:dom -- --source-key <key> --target 20 --max-scrolls 20`, or `npm run ingest:loop -- --source-key <key> --display-name "<name>" --group-url <url> --max-cycles 1`
  - storage/read surfaces: `npm run inspect:storage -- validate-run --run-id <runId>` plus the relevant `runs`, `observations`, `listings`, or `artifacts` view
  - queue/processing: `npm run validate:queue -- --run-id <runId>`; use `enqueue:processing`, `inspect:jobs`, `process:jobs`, and `retry:jobs` as needed
  - UI: `npm run inspect:ui`, then verify `http://127.0.0.1:4310`
  - extractor spot checks: `npm run extract:text`, `npm run extract:html`, or `npm run gemini:extract`
- Collection CLIs depend on `openclaw` plus an attached Chrome tab/profile.
- Gemini paths require `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or `data/cache/gemini/gemini.env`.
- Update or add the minimal doc needed when the source of truth changes.
- Keep docs concise and link outward instead of duplicating architecture detail into this file.

## Navigation

- `data/README.md` — what lives under `data/`, where it comes from, and which paths are legacy
- `src/ui/planning/` — active dashboard planning and worker handoffs; useful for UI work, not canonical repo policy
- `docs/passes/` — recent implementation changes
- `docs/reviews/` — architectural assessments and tradeoffs
- `docs/notes/` — exploratory or superseded context

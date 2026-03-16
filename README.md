# nyc-housing-scout

Local-first pipeline for collecting Facebook housing posts, storing them durably, extracting structured listing data, and exposing that state through lightweight local inspection surfaces.

## What it does

`nyc-housing-scout` is being built to:

- crawl housing posts from Facebook groups
- persist canonical post state and crawl history in SQLite
- store raw artifacts on disk for replay/debugging
- extract structured housing listings from messy free-form posts
- inspect runs, observations, jobs, listings, and provenance in a local operator UI
- support a future frontend for filtering by things like price, location, bedrooms, listing type, and availability

## Architecture at a glance

The project is converging on a staged pipeline:

1. **ingestion / crawl**
   - scrape posts from a Facebook source
   - persist source, run, observation, and stable post state
   - store raw artifacts on disk

2. **processing queue**
   - identify posts that still need extraction/enrichment
   - claim work atomically
   - process without double-running the same item

3. **structured extraction**
   - heuristic extraction
   - LLM structured extraction
   - normalized listing rows with confidence + ambiguity

4. **query / frontend layer**
   - filterable listing views
   - review unresolved / ambiguous records

For the detailed direction, read:
- `docs/VISION_AND_ARCHITECTURE.md`

## Current priorities

Right now the project has:
- DOM-based collection from an attached Chrome tab
- SQLite-backed storage
- source/run/observation/listing persistence
- observation-centric processing queue skeleton
- Gemini-backed `process:jobs` with canonical structured payloads
- storage inspection/validation CLI
- improved collector metadata extraction
- improved listing extraction heuristics

Current bottleneck:
- **crawl strategy / traversal efficiency**

## Repository layout

- `src/browser/` — browser-side DOM extraction and helpers
- `src/cli/` — stage-oriented command entrypoints
- `src/core/` — shared pipeline logic, normalization, neighborhoods, etc.
- `src/extractors/` — heuristic housing extraction
- `src/processing/` — processing provenance defaults and queue worker logic
- `src/storage/` — storage interface + SQLite implementation
- `src/ui/` — local inspection server and static operator UI
- `docs/` — architecture, passes, roadmap, and notes
- `examples/` — fixtures and exploratory scripts
- `data/raw/` — raw scrape artifacts (gitignored)
- `data/collected/` — collected-post exports (gitignored)
- `data/listings/` — listing exports (gitignored)
- `data/storage/` — SQLite database (gitignored)

## Development principles

- Keep each pipeline stage independently operable and testable.
- Prefer small, composable CLIs over one giant command.
- Use SQLite as the system of record.
- Keep raw artifacts on disk.
- Preserve provenance for every extracted listing.
- Avoid overbuilding orchestration.

## Key docs

### Core guidance
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/WORKLOG.md`
- `docs/notes/2026-03-13_12-22-00_PM_HANDOFF_AND_OPERATOR_GUIDE.md` — PM/operator bootstrap, current state, and next-step guidance

### Historical records
- `docs/reviews/` — architectural assessments
- `docs/passes/` — implementation work logs
- `docs/notes/` — field notes, strategy ideas, superseded docs

See `docs/INDEX.md` for a full map.

## When You Revisit Cloudflare

When it is time to build the hosted/public version, start here:

- `docs/reviews/README.md` — index of architectural reviews
- `docs/reviews/2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md` — the deployment-readiness assessment and recommended target architecture

Read that Cloudflare review in this order:

1. `Executive Verdict` — the short answer on what can move to Cloudflare and what should stay local
2. `Current Readiness` and `Why The Current Cloudflare Lift-And-Shift Fails` — what in the repo is portable vs laptop-bound
3. `D1 Vs Postgres / Supabase` — database decision and why D1 is the recommended first target
4. `Ideal Cloudflare End State` and `Suggested Implementation Phases` — the concrete build plan to follow

Keep `docs/PIPELINE.md` open while reading it. The Cloudflare review assumes the current local-first split remains true: Facebook scraping, raw artifacts, and the canonical SQLite write-side stay on the laptop until we intentionally replace that architecture.

## Commands

### Tests
- `npm test`

### Inspect storage
- `npm run inspect:storage -- sources`
- `npm run inspect:storage -- runs --limit 5`
- `npm run inspect:storage -- validate-run --run-id <runId>`
- `npm run inspect:storage -- observations --run-id <runId> --limit 10`
- `npm run inspect:storage -- listings --run-id <runId> --limit 10`
- `npm run inspect:storage -- artifacts --run-id <runId>`

### Inspect in browser
- `npm run inspect:ui`
- open `http://127.0.0.1:4310`
- browse runs, observations, jobs, listings, run steps, artifacts, and full JSON payloads without dropping to raw SQL or CLI output

### Processing queue
- `npm run enqueue:processing -- --run-id <runId>`
- `npm run validate:queue -- --run-id <runId>`
- `npm run inspect:jobs -- --status pending --limit 20`
- `npm run process:jobs -- --limit 10`
- `npm run retry:jobs -- --status failed`

### Collection
- `npm run capture:dom -- --limit 5`
- `npm run crawl:dom -- --target 20 --max-scrolls 10`
- `npm run ingest:loop -- --source-key <key> --display-name "<name>" --group-url <url> --max-cycles 1`

## Near-term direction

The next major build steps are:

1. harden crawl strategy (incremental vs backfill, top-of-feed reset, overlap anchors)
2. tighten the operator inspection UI and shape query surfaces for a future hosted frontend
3. tighten Gemini timeout / retry behavior for slow model calls
4. move the DOM path fully to enqueue-first processing

## Notes

This README is meant to be a current orientation document.
Detailed historical pass notes live under `docs/`.

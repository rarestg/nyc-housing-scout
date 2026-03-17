# nyc-housing-scout

`nyc-housing-scout` is a single-user, local-first pipeline for collecting Facebook housing posts, storing them durably, extracting structured listing data, and preparing both local operator views and a future hosted public read model.

## Read First

Read these in order:

1. `docs/INDEX.md`
2. `docs/VISION_AND_ARCHITECTURE.md`
3. `docs/ROADMAP.md`
4. `docs/SHIP_PLAN.md`
5. `docs/PIPELINE.md`
6. `docs/LISTING_SCHEMA.md`
7. `data/README.md`

If you are working on the operator surfaces, also read:

- `src/cli/README.md`
- `src/ui/ARCHITECTURE.md`

## Repository Layout

- `src/browser/` — browser-side extraction and CDP capture helpers
- `src/cli/` — stage-oriented operator entrypoints
- `src/core/` — collected-post, identity, normalization, and shared pipeline logic
- `src/extractors/` — heuristic extraction helpers
- `src/processing/` — queue and downstream processing stages
- `src/storage/` — SQLite storage layer and migrations
- `src/ui/` — local operator server, dashboard, inspector, and UI planning bundles
- `docs/` — canonical docs, reviews, notes, and pass logs
- `data/` — local artifacts, exports, cache, runtime state, and SQLite database
- `test/` — unit, storage, CLI, and UI contract tests

## Working Principles

- Keep the pipeline stage-oriented and independently operable.
- Keep local SQLite as the canonical write-side.
- Keep raw artifacts on disk and preserve provenance end to end.
- Keep browser control explicit and replaceable.
- Treat hosted/public infrastructure as a published read model unless intentionally promoted further.
- Prefer small explicit CLIs over large orchestration systems.

## Command Surfaces

The command inventory and operational examples live in:

- `docs/PIPELINE.md` — end-to-end ops guide
- `src/cli/README.md` — quick map from npm script to stage/file

## Additional Context

- `docs/reviews/README.md` — architectural reviews, including Cloudflare deployment direction
- `docs/passes/README.md` — dated implementation logs
- `docs/notes/README.md` — field notes and superseded planning docs

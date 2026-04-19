# AGENTS.md

## Repo Purpose

`nyc-housing-scout` is a single-user, local-first pipeline for collecting Facebook housing posts, storing canonical local state in SQLite, extracting structured listing data, and preparing local/operator and future public read surfaces.

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

Read in this order:

1. `README.md`
2. `docs/INDEX.md`
3. `docs/VISION_AND_ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. `docs/SHIP_PLAN.md`
6. `docs/PIPELINE.md`
7. `docs/LISTING_SCHEMA.md`
8. `data/README.md`
9. `src/cli/README.md`
10. `src/ui/ARCHITECTURE.md`

Then:
- use `docs/passes/README.md` to find the latest relevant implementation context
- use `docs/reviews/` and `docs/notes/` for tradeoffs and background
- treat `src/ui/planning/` as working context only when actively changing the dashboard

## Non-Negotiable Invariants

- This is a single-user local tool. Optimize for speed of iteration, not backward compatibility, glue layers, or migration scaffolding.
- SQLite is the system of record. Raw artifacts stay on disk. Derived exports are not canonical state.
- Before first public release, prefer changing the local schema directly, resetting the local SQLite DB, and rewriting one clean baseline migration over carrying transitional migrations or compatibility code for stale local state.
- Keep the pipeline stage-oriented and independently operable: collect, inspect, enqueue, process, extract, review.
- Preserve provenance across stages. `postUrl` is important and should flow through collected posts, processing jobs, processed payloads, and listings.
- Observation-centric processing is the current shape. Job/payload provenance is keyed by observation plus processor/schema/model versions.
- Keep collection separate from heavier enrichment. Crawl/ingest and structured extraction are distinct stages.
- Prefer small explicit CLIs over large orchestration systems.
- Never commit secrets. Use env vars or local env files for API keys.

## Engineering Principles

- Optimize for honest, maintainable fixes over the smallest possible diff. Refactor lightly when it better solves the real lifecycle, state, or data-model problem.
- Write the fewest lines of correct, readable code that get the job done, but not at the expense of clear ownership or invariants.
- Keep code simple, modular, and local. Prefer small explicit helpers and narrow module-level interfaces; add abstraction only when it protects an important invariant or makes async/stateful behavior easier to reason about.
- Do not introduce abstractions, guards, renames, wrapper components, or new files unless they solve a concrete problem today.
- If existing code is already clean and correct, leave it alone. When in doubt, ask: “does removing this make the code worse?” If not, remove it.

## Reading And Documentation

- Before reading a file, run a line count first and then read the full file or doc.
- Any new doc, note, pass log, or scratch writeup should use a New York timestamp prefix in `YYYY-MM-DD_HH-MM-SS_*` form when the filename is not otherwise fixed by convention.
- When writing docs, task files, or handoffs, prefer repo-root-relative paths like `docs/passes/...` instead of machine-specific absolute paths unless a tool requires an absolute path.
- Active doc directories should stay scannable. If a new PM or engineer cannot quickly tell what is current, the docs are too cluttered.
- When a milestone closes or a doc is superseded, archive it in the same pass. Move it to the relevant `archive/` subfolder, update the parent index, and add it to the archive index.
- When archiving touches many files or cross-cutting references, dispatch a worker to handle the moves, index updates, and a reference-verification grep.
- Prefer archive moves over deletion. Historical docs should stay discoverable, just not on the main stage.
- Never archive canonical docs listed in `Sources Of Truth`.
- When the source of truth changes, update or add the minimal doc needed. Keep docs concise and link outward instead of duplicating architecture detail.

## Delegation

- If you dispatch a worker/coding agent, start it with fresh context rather than inheriting the current conversation when avoidable. Prefer `fork_context: false`.
- For substantive delegated work, prefer `gpt-5.4` with `xhigh` reasoning.
- Point the worker to an existing task file or write a short markdown handoff with exact repo context, scope, constraints, write ownership, success criteria, and expected output.
- Give dispatched workers at least 30 minutes before treating them as stalled.
- Do not interrupt, close, cancel, or otherwise kill a dispatched worker before that 30 minute mark just because you no longer need it.
- Treat delegated work as input, not truth. Review it carefully against the current sources of truth, reuse the same reviewer for follow-up passes when practical, and do not ping workers early unless the task is actually blocked.
- If a PM/operator is coordinating multiple agents or parallel slices, assume they own the final commit packaging unless they explicitly ask you to commit your slice yourself.

## Browser And Runtime

- If you use `agent-browser`, always pass a unique named session on every command, for example `--session <task-name>`, instead of relying on the default session.
- When browser automation is done or looks wedged, close that named `agent-browser` session first and check `agent-browser session list` plus running processes before killing Chrome/Chromium trees that may belong to the user.
- Collection CLIs depend on `openclaw` plus an attached Chrome tab/profile.
- Gemini paths require `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or `data/cache/gemini/gemini.env`.

## Collaboration And Git

- Assume the worktree may contain concurrent collaborator edits. Do not revert, overwrite, or repackage changes you did not make unless explicitly told to do so.
- Run git and GitHub operations sequentially, not in parallel. `git` / `gh` commands often race each other and should be executed one by one.
- When you are working directly and own a self-contained change, prefer small scoped commits with descriptive messages as you go rather than one large end-of-session dump.
- Keep commits limited to the files and behavior you actually changed. Do not bundle unrelated cleanup or neighboring collaborator edits into the same commit.
- When the schema or storage shape needs to change, change it directly, update the current docs, and remove obsolete migration or compatibility code in the same pass.

## Validation

- Run `npm test`.
- Run the relevant stage CLI(s) for the surface you changed:
  - collection/browser: `npm run capture:dom -- --source-key <key> --limit 5`, `npm run crawl:dom -- --source-key <key> --target 20 --max-scrolls 20`, or `npm run ingest:loop -- --source-key <key> --display-name "<name>" --group-url <url> --max-cycles 1`
  - storage/read surfaces: `npm run inspect:storage -- validate-run --run-id <runId>` plus the relevant `runs`, `observations`, `listings`, or `artifacts` view
  - queue/processing: `npm run validate:queue -- --run-id <runId>`; use `enqueue:processing`, `inspect:jobs`, `process:jobs`, and `retry:jobs` as needed
  - UI: `npm run inspect:ui`, then verify `http://127.0.0.1:4310`
  - extractor spot checks: `npm run extract:text`, `npm run extract:html`, or `npm run gemini:extract`

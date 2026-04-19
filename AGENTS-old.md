# AGENTS-old.md

Superseded snapshot of the previous `AGENTS.md`. For current instructions, use `AGENTS.md`.

## Repo Purpose

`nyc-housing-scout` is a single-user, local-first pipeline for collecting Facebook housing posts, storing them durably, extracting structured listing data, and preparing queryable outputs for a future frontend.

## Repo Map

- `src/browser/` — browser-side DOM extraction and feed helpers
- `src/cli/` — stage-oriented command entrypoints
- `src/core/` — shared collected-post, pipeline, and normalization logic
- `src/extractors/` — heuristic listing extraction
- `src/processing/` — processing queue and processor logic
- `src/storage/` — SQLite-backed storage and migrations
- `src/ui/` — local inspection server, dashboard app, and UI planning artifacts (see `src/ui/ARCHITECTURE.md`)
- `docs/` — living architecture docs, roadmap, pipeline guide, passes, reviews, notes
- `data/` — local artifact layout, SQLite database, cache/env conventions, and legacy-vs-active paths
- `test/` — contract and storage/CLI tests

## Sources Of Truth

Start here, in order:

1. `README.md` — current repo orientation
2. `docs/INDEX.md` — doc map
3. `docs/VISION_AND_ARCHITECTURE.md` — north star and stage definitions
4. `docs/ROADMAP.md` — what is next
5. `docs/SHIP_PLAN.md` — definitive plan for shipping the multi-source local collector plus hosted public product
6. `docs/PIPELINE.md` — operational commands, crawl semantics, queue validation, and inspection surfaces
7. `docs/LISTING_SCHEMA.md` — normalized listing contract
8. `data/README.md` — local artifact layout, active vs legacy data paths, and how disk artifacts relate to SQLite
9. `src/cli/README.md` — quick map of stage CLIs and their roles
10. `src/ui/ARCHITECTURE.md` — operator UI architecture and route/API map

For recent implementation context, use `docs/passes/README.md` to find and then read the latest relevant file in `docs/passes/`.
For older tradeoffs and investigations, use `docs/reviews/` and `docs/notes/`.
Only treat `src/ui/planning/` as working context when you are actively changing the dashboard; it is not the canonical architecture doc set.

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

## Code Simplicity

- Optimize for honest, maintainable fixes over the smallest possible diff. Refactor lightly when it better solves the real lifecycle, state, or data-model problem.
- Write the fewest lines of correct, readable code that get the job done. Every line should earn its place.
- Keep code simple, modular, and local. Prefer small explicit helpers and narrow module-level interfaces; add abstraction only when it protects an important invariant or makes async/stateful behavior easier to reason about.
- Do not introduce abstractions, guards, renames, wrapper components, or new files unless they solve a concrete problem today. A comment is better than a defensive runtime check for a scenario that cannot currently happen. Three similar lines are better than a premature helper.
- If existing code is already clean and correct, leave it alone. When in doubt, ask: "does removing this make the code worse?" If the answer is no, remove it.

## Documentation Hygiene

- Active doc directories should stay scannable. If a new PM or engineer cannot quickly tell what is current, the docs are too cluttered.
- When a milestone closes or a doc is superseded, archive it in the same pass — do not leave it for a future cleanup. Move it to the relevant `archive/` subfolder, update the parent index, and add it to the archive index.
- When archiving touches many files or cross-cutting references, dispatch a worker to handle the moves, index updates, and a reference-verification grep.
- Prefer archive moves over deletion. Historical docs should stay discoverable, just not on the main stage.
- Never archive canonical docs listed in Sources Of Truth above.

## Workflow Rules

- Any new doc, note, pass log, or scratch writeup should use a New York timestamp prefix in `YYYY-MM-DD_HH-MM-SS_*` form when the filename is not otherwise fixed by convention.
- Before reading a file, run a line count first and then read the full range so you do not miss trailing content.
- When writing docs, task files, or handoffs, prefer repo-root-relative paths like `docs/passes/...` instead of absolute machine-specific paths, unless a tool explicitly requires an absolute path.
- If you use `agent-browser`, always pass a unique named session on every command, for example `--session <task-name>`, instead of relying on the default session.
- When browser automation is done or looks wedged, close that named `agent-browser` session first and check `agent-browser session list` plus running processes before killing Chrome/Chromium trees that may belong to the user.
- Assume the worktree may contain concurrent collaborator edits. Do not revert, overwrite, or repackage changes you did not make unless the user explicitly tells you to do so.
- If you dispatch a worker/coding agent, start it with fresh context rather than inheriting the current conversation when avoidable. Prefer `fork_context: false`. For substantive work, prefer `gpt-5.4` with `xhigh` reasoning. Point the worker to an existing task file or write a short markdown handoff, and include the exact repo context, scope, constraints, write ownership, success criteria, and expected output so it can work independently and make sound tradeoffs.
- If you dispatch a worker/coding agent, give it at least 30 minutes before treating it as stalled.
- Do not interrupt, close, cancel, or otherwise kill a dispatched worker/coding agent before that 30 minute mark just because you no longer need it. If you would not let it run, do not dispatch it in the first place.
- Treat delegated work as input, not truth. Review it carefully against the current sources of truth, reuse the same reviewer for follow-up passes when practical, and do not ping workers early unless the task is actually blocked.
- Run git and GitHub operations sequentially, not in parallel. `git` / `gh` commands often race each other and should be executed one by one.
- When you are working directly and own a self-contained change, prefer small scoped commits with descriptive messages as you go rather than one large end-of-session dump.
- Keep commits limited to the files and behavior you actually changed. Do not bundle unrelated cleanup or neighboring collaborator edits into the same commit.
- If a PM/operator is coordinating multiple agents or parallel slices, assume they own the final commit packaging unless they explicitly ask you to commit your slice yourself.
- When the schema or storage shape needs to change, change it directly, update the current docs, and remove obsolete migration or compatibility code in the same pass. Do not add compatibility shims for stale local state unless explicitly asked.

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
- `docs/passes/` — recent implementation changes (older foundational passes live in `docs/passes/archive/`)
- `docs/reviews/` — architectural assessments and tradeoffs
- `docs/notes/` — current planning inputs, deferred end-state notes, and active background (superseded and session-specific notes live in `docs/notes/archive/`)

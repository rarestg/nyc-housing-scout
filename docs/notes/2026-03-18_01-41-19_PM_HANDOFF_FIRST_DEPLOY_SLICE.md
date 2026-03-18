# PM Handoff: First Deploy Slice

Short handoff for a PM joining after the collector simplification sequence and the first deploy reprioritization.

## What Just Closed

The active Facebook collector path is materially healthier than it was a few days ago.

Recent work proved and then simplified:

- network-assisted identity recovery in the active collector
- CDP as the canonical capture transport
- collection ending at observations and artifacts instead of inline listings
- shared Facebook identity canonicalization
- a smaller resolver model
- a simpler crawl working-set lifecycle
- a simpler network-capture bootstrap, live-session flow, and finalization path
- removal of the old `page_context` fallback transport from active `crawl:dom`

The collector is no longer carrying multiple overlapping transport paths and transitional listing behavior in the active DOM crawl path.

## What The Current State Actually Is

`nyc-housing-scout` now has a real local-first pipeline shape:

1. collect Facebook posts into raw artifacts and SQLite observations
2. enqueue and process those observations into structured listing data
3. layer evidence, resolved fields, and manual overrides above raw records
4. inspect and review the resulting local state through CLI and local operator surfaces
5. prepare a hosted public read model from that canonical local state

This means the immediate risk is no longer broad collector cleanup or transport experimentation.

The immediate risk is:

- crawl coverage and stopping correctness
- Facebook identity correctness
- storage modularization and schema clarity
- operator workflow clarity
- deployment boundary clarity

## Recommended Next Milestone

The next milestone should be:

**first deploy hardening and read-side publication**

This is the current recommended next milestone, not a speculative backlog idea.

## What That Milestone Should Cover

### 1. Crawl policy hardening

The collector needs a trustworthy repeated-run policy:

- deterministic source preflight
- reliable top-of-feed reset behavior
- overlap anchors
- stale-zone / seen-threshold stopping
- explicit latest-sweep versus backfill thinking
- a few core crawl-quality metrics

### 2. Facebook identity merge/reuse hardening

The remaining correctness hotspot is the Facebook-specific network integration path in `src/cli/crawl-dom-latest.network-integration.js`.

The key requirement is to preserve:

- exact identity enrichment when canonical `postId` / `postUrl` evidence exists
- conservative recovery when the DOM copy lacks durable identity but network evidence is strong
- duplicate reuse so later overlap copies of the same post do not survive as separate provisional observations

### 3. One supported operator workflow

This should be a thin supported path over the existing stage CLIs, not a new orchestration framework.

The path should make it clear how to:

- preflight the runtime
- run collection
- validate the run
- enqueue and process work
- inspect failure and retry paths

### 4. Storage modularization and schema cleanup

`src/storage/sqlite-storage.js` is still a very large mixed-concern file. That is now worth moving up in priority because the team still expects to make data-model and DB interaction changes before the first deploy shape is fully settled.

The near-term goal is not a storage redesign or an ORM migration. The goal is:

- split the giant storage file into focused modules by concern
- make canonical write paths, queue/evidence operations, and read helpers independently understandable
- make schema changes cheaper and safer while the first deploy model is still moving
- once the first-deploy schema is trustworthy, reset the local DB baseline and squash historical migrations into one clean starting migration

Use `docs/reviews/2026-03-17_17-10-01_SQLITE_STORAGE_REFACTOR_REVIEW.md` as the main refactor input.

### 5. Minimal reliability telemetry

The repo needs a small set of hard signals for:

- CDP / browser preflight failure
- suspiciously low or zero crawl yield
- `validate-run` failure
- queue backlog growth
- publish failure

### 6. Hosted read-side publication from local canonical SQLite

The near-term deployment target should be:

- local collector remains local
- local SQLite remains canonical
- hosted deployment is the published read side plus public frontend

Do not treat “deploy the collector” as the first ship boundary.

## What This Milestone Does Not Require First

The following remain important, but they are no longer the blocker for the first deploy slice:

- multi-source collector runtime
- explicit source/tab lease model
- repo-owned MV3 browser bridge
- full OpenClaw replacement

Those are still the locked fuller end-state direction. They are just not the immediate next milestone.

## Why The Sequencing Changed

The earlier recommendation to focus next on multi-source runtime and OpenClaw replacement was reasonable at the time.

What changed is that the collector cleanup sequence made the remaining product risks more visible:

- the active collector path is now simple enough that crawl policy and identity correctness stand out as the real remaining trust risks
- the first deploy boundary is now clearer: local write-side, hosted read-side
- the browser-runtime replacement work still matters, but it no longer needs to be treated as the first deploy gate

## How To Use The Older Runtime Notes

The older runtime planning notes are still useful, but they should now be treated as deferred background design input:

- `docs/notes/2026-03-17_18-32-59_PM_PLANNING_BRIEF_MULTI_SOURCE_RUNTIME.md`
- `docs/notes/2026-03-17_18-39-19_MV3_BROWSER_BRIDGE_RECOMMENDATION.md`

Use them when the team is ready to push from the first deploy slice into the fuller end-state runtime.

Do not use them as the active next-milestone brief for current PM execution.

## Recommended Reading For A New PM

Start here:

1. `README.md`
2. `docs/INDEX.md`
3. `docs/VISION_AND_ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. `docs/SHIP_PLAN.md`
6. this note
7. `docs/notes/2026-03-18_01-36-14_ENG_STATUS_AND_DEPLOY_PRIORITIES_MEMO.md`
8. `docs/PIPELINE.md`
9. `docs/passes/README.md`

## Decision Status

This note supersedes `docs/notes/2026-03-17_16-40-27_PM_HANDOFF_AND_NEXT_MILESTONE.md` for near-term PM sequencing.

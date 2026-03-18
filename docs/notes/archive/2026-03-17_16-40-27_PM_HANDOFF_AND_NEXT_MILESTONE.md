# PM Handoff And Next Milestone

Status: superseded for near-term PM sequencing by `docs/notes/2026-03-18_01-41-19_PM_HANDOFF_FIRST_DEPLOY_SLICE.md`.

This note remains historical context for the earlier recommendation that multi-source collector runtime / ingest hardening should be the next milestone.

Short handoff for a new PM joining after the dashboard redesign and the evidence-resolution-and-review milestone.

## What Just Closed

Two substantial workstreams are now complete:

1. the listing-first operator dashboard redesign and simplification work
2. the evidence resolution, address recovery, and Review correction foundation

Current state:

- the dashboard is now listing-first, denser, and more usable for cross-group scanning
- Review can surface and act on layered raw / resolved / manual location state
- Debug remains forensic and non-editorial
- evidence enrichment and NYC-constrained address resolution now exist as explicit stages
- manual overrides are durable, audited, and flow through the same effective-value model

For the detailed recap, see:

- `src/ui/planning/2026-03-17_16-26-05_SESSION_PROGRESS_OVERVIEW.md`
- `docs/passes/README.md`

The finished execution bundle for the evidence/resolution/review milestone is archived here:

- `src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN`

## Recommended Next Milestone

The next milestone should be:

**multi-source collector runtime and ingest hardening**

This is primarily backend / runtime / operational-hardening work, not a frontend sprint.

## Why This Is Next

The current bottleneck is no longer the dashboard or the review model.

Downstream layers are now materially stronger than upstream ingest:

- the dashboard is usable
- evidence enrichment exists
- address resolution exists
- Review can carry correction actions honestly

But collection/runtime still needs hardening for the real product shape:

- multiple Facebook groups
- long-running ingest
- explicit source ownership
- safe browser/tab coordination
- no source collisions

The roadmap already points in this direction, but the sequencing decision is:

- stabilize ingest/runtime first
- then broaden data-quality follow-ups
- then build features like saved searches / alerts on top of more trustworthy collection

## Why Not The Other Candidates First

### Not another frontend sprint

The main operator/dashboard restructuring work is done for now. More frontend work would add less value than making ingest more reliable.

Deferred operator-surface follow-up input is tracked here:

- `docs/reviews/2026-03-17_17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG.md`
- `docs/reviews/2026-03-17_18-16-44_OPERATOR_UI_BACKLOG_REVALIDATION.md`

### Not saved searches / alerts yet

Saved searches and alerts depend on trustworthy upstream coverage and stable continuous ingest. Building them first would layer product features on top of a weaker runtime foundation.

### Not broader enrichment/geocoding first

Broader enrichment remains important, but the first evidence/review milestone already established the basic recovery model. Multi-source ingest reliability will improve the value of any later enrichment work.

Deferred storage modularization / SQL pushdown input is tracked here:

- `docs/reviews/2026-03-17_17-10-01_SQLITE_STORAGE_REFACTOR_REVIEW.md`

## What The Next Milestone Should Cover

The next execution bundle should focus on:

- making source metadata and source-specific browser ownership first-class
- replacing the implicit attached-tab assumption with explicit source-to-tab targeting
- adding source/tab lease and recovery state
- supporting continuous ingest across multiple groups on one machine without collisions
- hardening concurrent collection + processing behavior for always-on operation

Likely code areas:

- `src/browser/`
- `src/core/`
- `src/processing/`
- `src/storage/`
- `src/cli/`

Frontend impact should be secondary and limited to operational visibility if needed.

## Recommended Reading For A New PM

Start here:

1. `README.md`
2. `docs/INDEX.md`
3. `docs/VISION_AND_ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. this note
6. `docs/PIPELINE.md`
7. `docs/passes/README.md`

Then review the recent passes from `2026-03-16` through `2026-03-17`.

## Decision Status

This is the current recommended next milestone, not a speculative idea list.

If a future PM needs to create the execution bundle for this milestone, start here:

- `docs/notes/2026-03-17_18-32-59_PM_PLANNING_BRIEF_MULTI_SOURCE_RUNTIME.md`
- `docs/notes/2026-03-17_18-39-19_MV3_BROWSER_BRIDGE_RECOMMENDATION.md`

If priorities change later, update `docs/ROADMAP.md` and replace this note with a newer timestamped PM handoff note.

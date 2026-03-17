# UI Planning

Temporary dashboard planning bundles, worker briefs, and handoff notes.

Treat this folder as working context for UI changes, not as the canonical architecture doc set.

Even though this path lives under `src/ui/`, it may also hold cross-cutting execution context when the work is being coordinated from the operator/dashboard side.

## Current Contents

Active execution source of truth:

- none at the moment

Closed but still useful for historical UI context:

- `2026-03-16_14-13-54_SHELL_RESET_AND_DENSITY_PASS`
- `2026-03-16_00-10-47_UI_SPRINT_2_AND_DATA_QUALITY_PLAN`

Archive rule:

- keep a closed bundle at the root only when it is still a recent or frequently referenced handoff for current UI context
- move a closed bundle into `archived/` once it is no longer part of active decision-making or handoff flow
- keep cross-bundle recap docs like session overviews at the root unless they are explicitly superseded

Older archived bundles:

- see `archived/README.md`
- this now includes `2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN`

Session / progress overviews:

- `2026-03-17_16-26-05_SESSION_PROGRESS_OVERVIEW.md`

Future overview docs should:

- live at the root of `src/ui/planning/`
- use New York timestamped filenames
- summarize progress across multiple bundles or a whole milestone
- avoid replacing the canonical architecture / roadmap / pipeline docs

## Canonical Docs

For repo architecture, roadmap, and operator behavior, start with:

- `README.md`
- `docs/INDEX.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/PIPELINE.md`

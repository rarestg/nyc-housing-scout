# UI Planning

Temporary dashboard planning bundles, worker briefs, and handoff notes.

Treat this folder as working context for UI changes, not as the canonical architecture doc set.

Even though this path lives under `src/ui/`, it may also hold cross-cutting execution context when the work is being coordinated from the operator/dashboard side.

## Current Contents

Active execution source of truth:

- none at the moment

Archived bundles and session overviews:

- see `archived/README.md`

Archive rule:

- keep a closed bundle at the root only when it is still a recent or frequently referenced handoff for current UI context
- move a closed bundle into `archived/` once it is no longer part of active decision-making or handoff flow
- keep cross-bundle recap docs like session overviews at the root unless they are explicitly superseded

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

# Documentation Cleanup Lead Plan

Date: 2026-03-18

## Scope

Reduce documentation clutter in `nyc-housing-scout` so that:
- a new PM can find the current planning story quickly
- a new engineer can find the current implementation story quickly
- stale historical material is still available but no longer crowds active directories
- archive folders have short index files explaining what is there and when to read them
- indexes and links remain coherent after the cleanup

This is a documentation information-architecture pass, not a product redesign pass.

## Read Sources

All classification decisions below were informed by reading:

1. `README.md`
2. `docs/INDEX.md`
3. `docs/VISION_AND_ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. `docs/SHIP_PLAN.md`
6. `docs/PIPELINE.md`
7. `docs/LISTING_SCHEMA.md`
8. `data/README.md`
9. `docs/notes/README.md`
10. `docs/passes/README.md`
11. `docs/reviews/README.md`
12. `docs/notes/2026-03-18_00-30-48_CODEX_PM_BOOTSTRAP_PROMPT.md`
13. `docs/notes/2026-03-18_01-36-14_ENG_STATUS_AND_DEPLOY_PRIORITIES_MEMO.md`
14. `docs/notes/2026-03-18_01-41-19_PM_HANDOFF_FIRST_DEPLOY_SLICE.md`
15. Full file listings of `docs/notes/`, `docs/passes/`, `docs/reviews/`, `src/ui/planning/`
16. Cross-reference checks for links from canonical docs to notes and passes

## Current Doc Categories

### Canonical (never archive)

- `README.md`
- `docs/INDEX.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/SHIP_PLAN.md`
- `docs/PIPELINE.md`
- `docs/LISTING_SCHEMA.md`
- `data/README.md`

### Current planning input (keep visible)

- `docs/notes/2026-03-18_01-36-14_ENG_STATUS_AND_DEPLOY_PRIORITIES_MEMO.md`
- `docs/notes/2026-03-18_01-41-19_PM_HANDOFF_FIRST_DEPLOY_SLICE.md`

### Deferred end-state input (keep visible)

- `docs/notes/2026-03-17_18-32-59_PM_PLANNING_BRIEF_MULTI_SOURCE_RUNTIME.md`
- `docs/notes/2026-03-17_18-39-19_MV3_BROWSER_BRIDGE_RECOMMENDATION.md`

### PM tooling (keep visible)

- `docs/notes/2026-03-18_00-30-48_CODEX_PM_BOOTSTRAP_PROMPT.md`

### Still useful background (keep visible)

- `docs/notes/2026-03-12_21-27-18_CRAWL_STRATEGY_IDEAS.md` — directly relevant to P0 crawl-policy work
- `docs/notes/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_OVERRIDE_DESIGN.md` — design reference for implemented evidence layer

### Reviews (keep visible, all 8)

All 8 review docs retain planning or backlog value. No archival needed.

### Recent passes (keep visible, 27 from 03-15 through 03-17)

These are recent enough that they are still useful active implementation context.

### Archive: superseded notes (5)

| File | Superseded by |
|------|---------------|
| `2026-03-12_14-35-37_EXECUTION_PLAN.md` | `docs/ROADMAP.md` |
| `2026-03-12_14-35-37_PROJECT_GOALS.md` | `docs/VISION_AND_ARCHITECTURE.md` |
| `2026-03-13_12-22-00_PM_HANDOFF_AND_OPERATOR_GUIDE.md` | `docs/VISION_AND_ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/PIPELINE.md` |
| `2026-03-13_13-37-00_INGEST_LOOP_SPEC.md` | `docs/PIPELINE.md` |
| `2026-03-17_16-40-27_PM_HANDOFF_AND_NEXT_MILESTONE.md` | `docs/notes/2026-03-18_01-41-19_PM_HANDOFF_FIRST_DEPLOY_SLICE.md` |

### Archive: session-specific or narrow notes (4)

| File | Why |
|------|-----|
| `2026-03-12_14-45-07_LIVE_BROWSE.md` | Early manual browsing session notes |
| `2026-03-12_15-16-00_TEST_RESULTS.md` | Early MVP test findings |
| `2026-03-12_19-35-38_DOM_ROOT_DISCOVERY_NOTE.md` | Narrow investigation note on card-root discovery |
| `2026-03-13_13-16-00_BROWSER_RELAY_INGESTION_SOP.md` | Old browser relay path SOP |

### Archive: foundational-phase passes (21 from 03-12 and 03-13)

These passes describe work that is complete and now documented in canonical docs. They remain available in the archive for archaeology.

### Archive: completed UI planning bundles (2 dirs + 1 file)

| Path | Why |
|------|-----|
| `src/ui/planning/2026-03-16_00-10-47_UI_SPRINT_2_AND_DATA_QUALITY_PLAN/` | Closed execution bundle |
| `src/ui/planning/2026-03-16_14-13-54_SHELL_RESET_AND_DENSITY_PASS/` | Closed execution bundle |
| `src/ui/planning/2026-03-17_16-26-05_SESSION_PROGRESS_OVERVIEW.md` | Session-specific recap |

## Proposed Archive Structure

```
docs/notes/archive/
  INDEX.md          — explains what is here and when to read it
  9 archived notes

docs/passes/archive/
  INDEX.md          — explains what is here and when to read it
  21 archived passes

src/ui/planning/archived/
  README.md         — already exists, update with new entries
  5 archived bundles (3 existing + 2 new)
  1 session overview
```

## Files / Directories Likely To Stay Visible

- All canonical docs
- `docs/notes/`: 7 docs + README
- `docs/passes/`: 27 docs + README
- `docs/reviews/`: 8 docs + README (no changes)
- `docs/WORKLOG.md`, `docs/FACEBOOK_CAPTURE_NOTES.md` (already labeled historical in INDEX.md)
- `src/ui/planning/`: README only at root level

## Files / Directories Likely To Move To Archive

- `docs/notes/` → `docs/notes/archive/`: 9 files
- `docs/passes/` → `docs/passes/archive/`: 21 files
- `src/ui/planning/` → `src/ui/planning/archived/`: 2 dirs + 1 file

## Delegation Plan

| Worker | Scope | Write ownership |
|--------|-------|-----------------|
| W1: notes cleanup | `docs/notes/` | Move 9 files, create `archive/INDEX.md`, update `README.md` |
| W2: passes cleanup | `docs/passes/` | Move 21 files, create `archive/INDEX.md`, update `README.md` |
| W3: ui/planning cleanup | `src/ui/planning/` | Move 2 dirs + 1 file, update both READMEs |
| W4: link/index verify | Cross-cutting read + `docs/INDEX.md` write | Fix INDEX.md PM reading path, verify references, run `npm test` |

Workers 1–3 run in parallel. Worker 4 runs after 1–3 complete.

All workers:
- do not archive canonical docs
- prefer archive moves over deletion
- add/update archive INDEX.md files where they create archive folders
- update indexes only for the files they touch

## Risks / Edge Cases

1. **Stale link in `docs/INDEX.md`**: PM reading path step 4 points to superseded `PM_HANDOFF_AND_NEXT_MILESTONE`. Worker 4 fixes this.
2. **Cross-references from deferred notes to archived note**: `PM_PLANNING_BRIEF_MULTI_SOURCE_RUNTIME` and `MV3_BROWSER_BRIDGE_RECOMMENDATION` both reference the superseded `PM_HANDOFF_AND_NEXT_MILESTONE`. These are informational references within deferred notes; the notes already contain enough context and the archived file will still exist.
3. **Pass logs referencing archived notes**: Some 03-15 passes have reading-list references to archived 03-13 notes. These are historical context sections in pass logs, not live links. Acceptable.
4. **5 passes not listed in `docs/passes/README.md`**: Some passes on disk are not in the index. Worker 2 should verify whether the unlisted recent ones (03-15, 03-16) should be added to the updated README.

## Execution Order

1. Create this lead note
2. Dispatch W1, W2, W3 in parallel
3. After W1–W3 complete, dispatch W4 for link/index verification
4. Review results and report

## Definition Of Done

- [ ] 9 notes moved to `docs/notes/archive/`
- [ ] 21 passes moved to `docs/passes/archive/`
- [ ] 2 UI planning bundles + 1 session overview moved to `src/ui/planning/archived/`
- [ ] `docs/notes/archive/INDEX.md` created
- [ ] `docs/passes/archive/INDEX.md` created
- [ ] `src/ui/planning/archived/README.md` updated
- [ ] `docs/notes/README.md` updated
- [ ] `docs/passes/README.md` updated
- [ ] `src/ui/planning/README.md` updated
- [ ] `docs/INDEX.md` PM reading path fixed
- [ ] `npm test` passes
- [ ] No canonical doc points to a file that moved without an updated reference

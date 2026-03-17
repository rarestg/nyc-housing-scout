Frontend Simplification Execution Plan
======================================

Purpose
-------
This planning bundle turns the frontend simplification review into a dispatch-ready execution plan with PR-sized phases, worker handoff files, and shared coordination docs.

Central verdict
---------------
The recommended simplification path is:

- simplify Posts, Review, and Debug first
- remove focused single-record table mode on those secondary routes
- move review-link semantics into the backend read model
- clean shell and shared-helper churn after the behavioral surface shrinks
- leave Listings as the primary product surface
- do not spend time removing `@tanstack/react-table` in this pass

Read order
----------
Everyone should read these files in this order:

1. `README.txt`
2. `01_VERDICT_AND_PRIORITY_ORDER.txt`
3. `02_PR_SIZED_PHASE_BREAKDOWN.txt`
4. `03_MASTER_CHECKLIST.txt`
5. `04_DISPATCH_PROTOCOL.txt`
6. `05_COORDINATION_BOARD.txt`
7. `06_WHITEBOARD_AND_NOTES.txt`
8. your assigned phase file
9. your assigned handoff file
10. all prior phase handoff files if your phase depends on earlier work

Bundle contents
---------------
- `README.txt`
- `01_VERDICT_AND_PRIORITY_ORDER.txt`
- `02_PR_SIZED_PHASE_BREAKDOWN.txt`
- `03_MASTER_CHECKLIST.txt`
- `04_DISPATCH_PROTOCOL.txt`
- `05_COORDINATION_BOARD.txt`
- `06_WHITEBOARD_AND_NOTES.txt`
- `phase_1_remove_secondary_route_focused_mode.txt`
- `phase_2_trim_secondary_route_chrome_and_actions.txt`
- `phase_3_backend_review_link_targets.txt`
- `phase_4_shell_and_css_cleanup.txt`
- `phase_5_route_support_and_query_state_cleanup.txt`
- `phase_6_listings_chrome_trim_optional.txt`
- `handoffs/phase_1_status.txt`
- `handoffs/phase_2_status.txt`
- `handoffs/phase_3_status.txt`
- `handoffs/phase_4_status.txt`
- `handoffs/phase_5_status.txt`
- `handoffs/phase_6_status.txt`

Recommended dispatch order
--------------------------
Dispatch these sequentially unless a later phase is explicitly re-scoped to avoid file overlap:

1. Phase 1: remove focused single-record mode from Posts, Review, and Debug
2. Phase 2: trim secondary-route chrome, duplicate actions, and debug leakage
3. Phase 3: add backend-provided review link targets and delete frontend heuristics
4. Phase 4: freeze the shell compact, simplify Debug selection, and collapse CSS duplication
5. Phase 5: shrink `route-support.jsx` and add route-local query/update helpers
6. Phase 6: optional Listings chrome trim after the earlier phases stabilize

Execution rules
---------------
- Use each phase file as the worker brief.
- Dispatch with fresh context.
- Each worker updates only their own file under `handoffs/`.
- Each worker updates that file:
  - when starting
  - when a blocker appears
  - when finishing
- If a worker finds a cross-phase contract issue:
  - note it in the handoff file immediately
  - update `05_COORDINATION_BOARD.txt` if the recommended next dispatch changes
  - append a dated note to `06_WHITEBOARD_AND_NOTES.txt`
- Do not dispatch the next phase until the current phase is merged or intentionally paused with a written decision.

Important scope notes
---------------------
- The main target is simplification, not redesign.
- Listings remains the primary browsing surface.
- Debug remains intentionally secondary.
- The focus of this plan is route behavior, state flow, read-model seams, and shell churn.
- Table-library replacement is explicitly out of scope for this execution plan.

Explicitly deferred
-------------------
- removing `@tanstack/react-table`
- adding a new UI/component library
- rebuilding focused-row tables as a shared primitive
- broad filter-model reduction on Listings
- any hosted/frontend architecture changes outside the current local dashboard

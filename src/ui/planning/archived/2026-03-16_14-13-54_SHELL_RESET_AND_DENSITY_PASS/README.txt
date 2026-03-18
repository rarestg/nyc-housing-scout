Shell Reset And Density Pass
============================

Purpose
-------
This planning bundle turns the latest post-simplification UI feedback into a dispatch-ready pass.

The old "UI Sprint 2 integrator" framing is no longer the right fit. The remaining work is not mainly route behavior or contract integration. It is a shell and visual-system reset:

- remove the confusing fixed icon rail
- reclaim more width for the listings table
- flatten the card-heavy chrome
- tighten the detail pane hierarchy
- quiet the table typography so the data is easier to scan

Central call
------------
Run one strong shared-UI worker first, then decide whether a short regression/polish follow-up is still needed.

Do not split the first pass across many workers. The main seams are all shared:

- `src/ui/dashboard/app/AppShell.jsx`
- `src/ui/dashboard/components/DetailPane.jsx`
- `src/ui/dashboard/components/DataTable.jsx`
- `src/ui/dashboard/components/FilterControls.jsx`
- `src/ui/dashboard/components/RouteScaffold.jsx`
- `src/ui/dashboard/styles/dashboard.css`

That work will merge badly if it is over-parallelized.

Read order
----------
Everyone should read these files in this order:

1. `README.txt`
2. `01_VERDICT_AND_GOALS.txt`
3. `02_EXECUTION_PLAN.txt`
4. `03_DISPATCH_PROTOCOL.txt`
5. `04_COORDINATION_BOARD.txt`
6. your assigned worker file
7. your assigned handoff file

Bundle contents
---------------
- `README.txt`
- `01_VERDICT_AND_GOALS.txt`
- `02_EXECUTION_PLAN.txt`
- `03_DISPATCH_PROTOCOL.txt`
- `04_COORDINATION_BOARD.txt`
- `worker_1_shell_reset_and_density.txt`
- `worker_2_polish_and_regression_optional.txt`
- `handoffs/worker_1_status.txt`
- `handoffs/worker_2_status.txt`

Relationship to earlier planning
--------------------------------
- This bundle supersedes the earlier UI-side shell recommendation that preferred a compact icon rail over a top nav.
- The broader data-quality / correction planning in `../2026-03-16_00-10-47_UI_SPRINT_2_AND_DATA_QUALITY_PLAN/` remains active and relevant.
- The archived simplification bundle remains a completed record and should not be reopened unless a regression is discovered.

Recommended dispatch order
--------------------------
1. Dispatch Worker 1: shell reset and density pass
2. Review the result visually and against the validation checklist
3. Dispatch Worker 2 only if there is still meaningful cleanup or regression work after Worker 1 lands

Out of scope
------------
- backend enrichment or address resolution
- manual correction workflows
- push notifications or saved searches
- replacing `@tanstack/react-table`
- introducing a new component/UI framework
- rebuilding route behavior that the simplification sprint intentionally removed

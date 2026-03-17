Cross-Group Listings Dashboard Plan
==================================

Purpose
-------
This planning bundle turns the recent UI/UX review into a concrete redesign spec and a worker-ready implementation plan.

The central conclusion is:

- keep the thin local read-only Node + SQLite architecture
- stop treating the run inspector as the primary product
- redesign the frontend around newest listings across all groups
- use dense table/list browsing with a detail pane, not card grids or a map-first UI

Current product direction
-------------------------
The current inspection UI is useful as a local debug/operator surface, but it is optimized for run-by-run forensic inspection. The broader product goal is different:

- show the newest listings across Facebook groups
- make those listings easier to browse than endless Facebook scrolling
- support strong filtering now
- support saved searches and push notifications later

Read order
----------
Everyone should read these files in this order:

1. `README.txt`
2. `01_REVIEW_SYNTHESIS.txt`
3. `02_REDESIGN_SPEC.txt`
4. `03_PHASED_IMPLEMENTATION_PLAN.txt`
5. `04_SHARED_CONTRACTS_AND_BOUNDARIES.txt`
6. your worker task file
7. your worker handoff file

Bundle contents
---------------
- `01_REVIEW_SYNTHESIS.txt`
- `02_REDESIGN_SPEC.txt`
- `03_PHASED_IMPLEMENTATION_PLAN.txt`
- `04_SHARED_CONTRACTS_AND_BOUNDARIES.txt`
- `05_COORDINATION_BOARD.txt`
- `worker_1_api_and_storage_contract.txt`
- `worker_2_app_shell_and_shared_primitives.txt`
- `worker_3_listings_workspace.txt`
- `worker_4_posts_review_debug.txt`
- `worker_5_stage_c_integration_and_polish.txt`
- `handoffs/worker_1_status.txt`
- `handoffs/worker_2_status.txt`
- `handoffs/worker_3_status.txt`
- `handoffs/worker_4_status.txt`
- `handoffs/worker_5_status.txt`

Recommended dispatch order
--------------------------
Stage A: parallel

- Worker 1: API and storage contract
- Worker 2: app shell and shared frontend primitives

Stage B: parallel after Stage A lands or stabilizes

- Worker 3: Listings workspace
- Worker 4: Posts, Review, and Debug

Stage C: integration and polish

- merge and validate the combined app
- reconcile shared contract drift
- tighten accessibility, responsiveness, and loading states

Worker update rules
-------------------
- Each worker should update only their own file under `handoffs/`.
- Each worker should update that file at minimum:
  - when starting
  - when a blocker or contract change appears
  - when finishing
- If a worker needs to change a shared contract:
  - Worker 1 owns data/API contract updates in `04_SHARED_CONTRACTS_AND_BOUNDARIES.txt`
  - Worker 2 owns app structure and shared UI contract updates in `04_SHARED_CONTRACTS_AND_BOUNDARIES.txt`
  - Workers 3 and 4 should avoid changing shared contract docs unless the integrator asks for it

Important scope notes
---------------------
- The centerpiece is `Listings`, not source-group activity.
- `Posts` matters because raw post text is still the evidence layer.
- `Debug` remains valuable, but it is not the home screen.
- Map is explicitly out of scope for this redesign pass.
- Duplicate or near-duplicate posts across groups are a later backend concern. The frontend should leave space for duplicate-cluster indicators, but should not block on a dedupe system.

Future-facing product note
--------------------------
The filter model should become the alert model later. If a user can filter for something like:

- 3 bedrooms
- 2 bathrooms
- Brooklyn
- under a price threshold
- posted in the last 6 hours

that same serialized query should later be reusable as a saved search or push-notification rule.

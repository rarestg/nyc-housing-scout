Evidence Resolution And Review Execution Plan
=============================================

Status
------
Archived completed bundle. Keep for historical reference; do not treat as an active dispatch board.

Purpose
-------
This bundle turns the repo-state assessment into a dispatch-ready plan for the next milestone:

- evidence enrichment
- address resolution
- durable overrides and auditability
- effective-value read models
- later Review-oriented correction UI

Central call
------------
Do not start with UI.

Start by locking the storage contract and precedence rules. Every later backend and frontend surface depends on that.

Read order
----------
Everyone should read these files in order:

1. `README.txt`
2. `01_REPO_STATE_SYNTHESIS.txt`
3. `02_STORAGE_AND_PRECEDENCE_DESIGN.txt`
4. `03_EXECUTION_PLAN.txt`
5. `04_DISPATCH_PROTOCOL.txt`
6. `05_COORDINATION_BOARD.txt`
7. your assigned worker file
8. your assigned handoff file
9. prior handoff files if your work depends on earlier phases

Bundle contents
---------------
- `README.txt`
- `01_REPO_STATE_SYNTHESIS.txt`
- `02_STORAGE_AND_PRECEDENCE_DESIGN.txt`
- `03_EXECUTION_PLAN.txt`
- `04_DISPATCH_PROTOCOL.txt`
- `05_COORDINATION_BOARD.txt`
- `worker_1_storage_contract_and_precedence.txt`
- `worker_2_evidence_fragments_and_enrichment_stage.txt`
- `worker_3_address_resolution_and_resolved_fields.txt`
- `worker_4_effective_values_and_review_read_models.txt`
- `worker_5_override_model_and_review_api.txt`
- `worker_6_review_ui_and_debug_boundary.txt`
- `handoffs/worker_1_status.txt`
- `handoffs/worker_2_status.txt`
- `handoffs/worker_3_status.txt`
- `handoffs/worker_4_status.txt`
- `handoffs/worker_5_status.txt`
- `handoffs/worker_6_status.txt`

Primary design note
-------------------
The storage and precedence contract for this milestone lives here:

- `docs/notes/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_OVERRIDE_DESIGN.md`

Relationship to other active planning
-------------------------------------
- The UI shell-reset bundle is complete enough that it should not block this work.
- The earlier UI Sprint 2 / data-quality bundle remains useful as product context, and this bundle records the backend-first execution plan that shipped this milestone.

Recommended dispatch order
--------------------------
1. Worker 1: storage contract and precedence
2. Worker 2: evidence fragments and enrichment stage
3. Worker 3: address resolution and resolved fields
4. Worker 4: effective values and review read models
5. Worker 5: override model and review API
6. Worker 6: Review UI and Debug boundary

Execution rules
---------------
- Do not dispatch later workers before their dependencies are stable.
- Do not fake frontend states before the backend can persist them honestly.
- Keep raw tables forensic and immutable.
- Prefer explicit SQLite tables and CLIs over hosted/workflow complexity.

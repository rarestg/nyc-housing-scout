UI Sprint 2 And Data Quality Plan
=================================

Purpose
-------
This planning bundle translates the post-Stage-C dashboard feedback into a concrete next plan.

For the later shell-reset / density cleanup prompted by post-simplification visual feedback, see:

- `../2026-03-16_14-13-54_SHELL_RESET_AND_DENSITY_PASS/README.txt`

The main conclusion is:

- do not treat all new requests as one giant "frontend sprint"
- split the work into:
  - UI Sprint 2: make the listings workflow materially faster and clearer
  - Data Quality / Review Track: recover more evidence, resolve addresses, and support manual correction

This bundle now also folds in a second round of more specific UI/UX direction:

- reclaim permanent screen width and height from shell chrome
- make the listings table clearly dominant
- make row selection the obvious detail trigger
- treat author, source, and posted time as first-class detail context
- demote technical evidence links below the first-level review flow
- reserve correction work for Review-oriented workflows, not raw Debug

Why the split matters
---------------------
The first group of issues is mostly a browsing and interaction problem:

- too much permanent shell chrome
- too many columns for too little width
- unclear detail-pane behavior
- low row density
- too much vertical space spent on non-core cards and controls

The second group of issues is mostly a data and workflow problem:

- linked media is not being used as evidence
- extraction is not clearly multi-source
- address resolution is missing
- manual corrections need storage, precedence, and auditability
- the UI cannot explain missing fields well until the backend knows why they are missing

Trying to solve both in one sprint would blur ownership and slow delivery.

Recommended read order
----------------------
1. `README.txt`
2. `01_PRIORITY_ORDER.txt`
3. `02_UI_SPRINT_2_EXECUTION_PLAN.txt`
4. `03_DATA_QUALITY_AND_CORRECTION_TRACK.txt`
5. `04_DELEGATION_AND_PHASES.txt`

Current product stance
----------------------
- the product is still listing-first
- the main job is: "show me the newest relevant listings across groups quickly"
- `Posts` remains the evidence layer
- `Review` should become the correction / attention workspace
- `Debug` should stay forensic and advanced, not editorial

Important note
--------------
Duplicate or near-duplicate listings across groups remain a backend concern. That work should not block UI Sprint 2, but the backend team should plan for stable-post collapse and later duplicate-cluster metadata.

Explicit pushback
-----------------
- The original shell guidance in this bundle preferred a compact icon rail over a top nav.
- That guidance has been superseded by the later shell-reset bundle after the simplification sprint and additional visual review.
- Do not build manual correction UI before the backend has a durable override model, precedence rules, and auditability.
- Do not promise highly actionable "why missing" field messaging until the evidence model can distinguish:
  - not found
  - not resolved
  - not yet analyzed

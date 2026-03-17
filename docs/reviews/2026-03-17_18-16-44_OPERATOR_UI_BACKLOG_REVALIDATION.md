# Operator UI Backlog Revalidation

Point-in-time backlog filter for the operator UI review findings after the recent frontend simplification, evidence/review closeout, and doc updates.

Read this together with:

- `docs/reviews/2026-03-17_17-05-01_OPERATOR_UI_REVIEW_AND_BACKLOG.md`

Why:

- the earlier review preserves the full original findings and operator concerns
- this document exists to filter, downgrade, and re-order those findings against the newer codebase
- if a PM is preparing a future operator-surface execution bundle, this doc should usually be treated as the current backlog source, but not read in isolation

This document is intentionally narrow:

- keep only findings that still merit future backlog work in the current codebase
- explicitly drop or downgrade findings that were tied to older plumbing assumptions
- frame the remaining items so a PM can dispatch them later without redoing the assessment

## Scope

Assessment inputs:

- current docs:
  - `README.md`
  - `docs/VISION_AND_ARCHITECTURE.md`
  - `docs/PIPELINE.md`
  - `src/ui/ARCHITECTURE.md`
- current UI/server code:
  - `src/ui/dashboard/routes/debug/DebugRoute.jsx`
  - `src/ui/dashboard/routes/posts/PostsRoute.jsx`
  - `src/ui/dashboard/routes/listings/ListingsRoute.jsx`
  - `src/ui/dashboard/routes/review/ReviewRoute.jsx`
  - `src/ui/dashboard/routes/shared/route-support.jsx`
  - `src/ui/inspection-server.js`
  - `src/ui/inspection-app.js`
  - `src/storage/sqlite-storage.js`
- current tests:
  - `test/dashboard-api.test.js`
  - `test/inspect-ui.test.js`
- live read-only verification:
  - current local inspection server
  - live dashboard/legacy API checks against the current SQLite dataset

## Assessment Summary

The earlier review is still useful, but not all of it should go into backlog unchanged.

What changed since that review:

- the backend now already supports dashboard-level `runId` filtering for posts, listings, and review
- the legacy inspector deep-link plumbing is present and appears wired correctly
- listing rows are now grouped as variant-collapsed dashboard rows rather than a naive flat dump of every extractor row
- Review is now explicitly the narrow correction surface, while Debug remains intentionally forensic/read-oriented

Because of that, the old report mixed together:

- real backlog-worthy UX/product gaps
- one likely stale inspector bug report
- one concern that is now better framed as a read-model decision, not a broken UI

## Backlog-Worthy Findings

### 1. Preserve run context across dashboard routes

Priority: High

Why this still matters:

- the dashboard still drops run scope when leaving `Debug`
- operators still have to switch from run-centric forensics into source-wide browsing
- this is the cleanest backlog item because the backend already supports it

Current evidence:

- `Debug` still links to:
  - `Posts from source`
  - `Listings from source`
- those links only pass `sourceKey`, not `runId`
- the React route query state for `Posts`, `Listings`, and `Review` still has no `runId`
- the server already accepts `runId` for:
  - `/api/dashboard/posts`
  - `/api/dashboard/listings`
  - `/api/dashboard/review`

Implication:

- this is no longer a storage/API limitation
- it is now a route-state and UX wiring gap

Recommended future scope:

- add optional `runId` support to dashboard route query state
- add persistent run-scoped breadcrumbs/chips where useful
- make run-to-post/listing/review links preserve run context by default
- keep source-wide browsing available as an explicit opt-out, not the only path

### 2. Make jobs and processed-payload inspection first-class in the dashboard

Priority: High

Why this still matters:

- jobs and processed payloads are still a core operator workflow
- the React dashboard still does not provide a first-class jobs workspace
- source-to-processed comparison is still weaker than it should be

Current evidence:

- dashboard routes are:
  - `Listings`
  - `Posts`
  - `Review`
  - `Debug`
- there is no dedicated jobs route
- `Debug` still hands off to the legacy inspector for jobs/artifacts
- the legacy `/api/jobs` endpoint already returns rich data including:
  - observation payload
  - processed payload
  - model/provenance data
- `Posts` and `Listings` show some job metadata, but not a real processed-payload inspection workspace

Important reframing:

- the earlier review’s stronger claim that the inspector handoff itself is broken should not be treated as the backlog item
- the backlog item is the product gap:
  - jobs/payload inspection is still not dashboard-native

Recommended future scope:

- decide whether to add:
  - a dedicated jobs route, or
  - a richer jobs/payload panel inside `Posts` and/or `Listings`
- make it easy to compare:
  - source post text
  - processed payload JSON
  - normalized listing output

### 3. Clarify listing row semantics in the main listings workspace

Priority: Medium

Why this still matters:

- the dashboard is better than it was, but the list view still under-signals what the row actually represents
- the current model is more nuanced than “canonical listing row” vs “historical junk row”

Current evidence:

- dashboard storage now collapses extractor variants into one list item with `variantCount`
- listing detail expands variants and layered field state
- effective values are now layered from:
  - manual override
  - accepted resolved field
  - raw extracted listing value
  - raw observation-derived fallback

What remains unclear:

- the main table does not strongly communicate that the row is a grouped dashboard read over immutable forensic records
- variant provenance and effective-value semantics still mostly appear in detail, not at scan time

Recommended future scope:

- add clearer scan-time cues for:
  - grouped variant rows
  - effective value vs raw extracted value
  - whether reviewable ambiguity comes from extractor output, layered resolution state, or both

### 4. Expand `Debug` from validation hub into a stronger run-forensics workspace

Priority: Medium

Why this still matters:

- `Debug` still requires extra hops before the operator sees meaningful run evidence
- the route remains light on run-step and run-outcome interpretation

Current evidence:

- `Debug` shows:
  - run summary
  - validation
  - raw JSON
  - inspector/export handoffs
- it still does not inline:
  - step progression
  - last fresh step
  - stop reason
  - compact evidence previews
  - explicit outcome badges like `Fresh`, `Idle`, `Failed`

Important framing:

- this is not a contradiction with the current architecture
- current docs intentionally treat `Debug` as a read-oriented forensic route with inspector handoff
- this is a backlog enhancement, not a hidden defect

Recommended future scope:

- add a compact run progression block
- surface recent steps/artifacts/post previews inline
- make run outcome easier to interpret without forcing inspector hops

### 5. Revisit the Review queue row model

Priority: Medium

Why this still matters:

- one listing can still appear multiple times across different review queues
- this increases scan noise and can make the queue look larger than the unique work set

Current evidence:

- Review is computed, not stored
- current tests explicitly expect the same listing to appear as multiple queue items when multiple review reasons apply
- docs explicitly state that non-winning resolved rows still surface in Review rather than being flattened away

Important framing:

- this is not just a UI table bug
- it is a read-model and workflow choice

Recommended future scope:

- decide whether the operator should work from:
  - one row per queue reason, or
  - one row per item with grouped reason tags/counts
- if grouped, define how queue counts and drill-down behavior should still work

### 6. Improve JSON and side-by-side inspection ergonomics

Priority: Medium

Why this still matters:

- raw JSON is still core operator material
- the current detail-pane presentation is still secondary-feeling

Current evidence:

- listings keep raw JSON behind collapsible `JsonDetails`
- posts still do not surface processed payload JSON first-class
- the dashboard still lacks a comfortable side-by-side source vs processed vs normalized comparison view

Recommended future scope:

- add a wider or pop-out code view
- support direct source vs processed vs normalized comparison in one operator flow

### 7. Improve scanability in `Posts` and the legacy inspector

Priority: Low-Medium

Why this still matters:

- desktop operator work is still scan-heavy
- repeated metadata and stale selection behavior still add friction

Current evidence:

- `Posts` still does not treat run identity as a first-class scan signal
- repeated source/group context remains visually prominent
- the legacy inspector still uses tall run cards
- the legacy inspector search filter can leave the detail pane bound to a selected run that is no longer visible in the filtered run list

Recommended future scope:

- surface run/date more clearly in posts
- trim repeated source chrome where it does not add value
- consider a denser run list mode in inspector
- reconcile selected-run behavior when local run search filters hide the current selection

## Findings To Exclude From Backlog As Written

### A. “Run-scoped inspector deep link is broken and non-empty runs render as empty”

Do not dispatch this exact statement as-is.

Reason:

- the current inspector still receives `run` and `tab` via hash state
- it hydrates that state on load and on hash change
- it fetches run-scoped tabs through `/api/observations`, `/api/jobs`, `/api/listings`, `/api/run-steps`, and `/api/artifacts`
- current live API checks returned non-empty run-scoped data for the previously cited Williamsburg run

Practical takeaway:

- if someone still suspects a browser-level inspector bug, re-reproduce it first
- do not backlog the old report verbatim without a fresh repro

### B. “Listings table is fundamentally misrepresenting historical rows as equally canonical”

Do not dispatch this wording verbatim.

Reason:

- the current dashboard now collapses variants and exposes layered effective values
- the remaining issue is clarity and scan-time signaling, not the same older flat-row problem

Practical takeaway:

- backlog the clearer version:
  - clarify grouped variant/effective-value semantics in the listings workspace

## Recommended Deferred Backlog Order

When this work eventually comes back onto the roadmap, the recommended order is:

1. preserve run context across dashboard routes
2. make jobs/processed payload inspection first-class
3. improve listings row semantics and scan-time provenance cues
4. decide whether Review should stay multi-row per reason or move to grouped-per-item rows
5. improve Debug run-forensics depth
6. improve JSON inspection ergonomics
7. apply lower-priority scanability cleanup to Posts and inspector

## Dispatch Guidance

If this backlog is handed to a PM later:

- treat items 1 and 2 as the highest-value operator workflow improvements
- treat item 5 as a product/read-model decision, not a pure frontend cleanup task
- do not revive the stale “broken inspector handoff” bug report without a fresh reproduction
- keep the current architectural boundary intact unless intentionally revisiting it:
  - Review is the narrow correction surface
  - Debug is forensic/read-oriented
  - SQLite remains the source of truth

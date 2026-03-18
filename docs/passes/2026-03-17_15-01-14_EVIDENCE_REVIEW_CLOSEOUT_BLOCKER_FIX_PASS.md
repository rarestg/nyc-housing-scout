# Evidence Review Closeout Blocker Fix Pass

Date: 2026-03-17 15:01:14 EDT

## Scope

Narrow closeout pass for the evidence resolution and review milestone:

- make enrichment and resolution audit rows real, durable, and non-noisy
- reject unsupported Review override writes at the backend
- remove the misleading Posts Review link when no review target exists
- update the minimal docs/planning state so the bundle can be archived honestly

## Files Changed

- `src/storage/sqlite-storage.js`
- `src/processing/run-evidence-enrichment.js`
- `src/processing/run-address-resolution.js`
- `src/ui/inspection-server.js`
- `src/ui/dashboard/routes/posts/PostsRoute.jsx`
- `test/evidence-enrichment.test.js`
- `test/address-resolution.test.js`
- `test/dashboard-api.test.js`
- `test/inspect-ui.test.js`
- `docs/PIPELINE.md`
- `src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/05_COORDINATION_BOARD.txt`
- `docs/passes/README.md`
- `docs/passes/2026-03-17_15-01-14_EVIDENCE_REVIEW_CLOSEOUT_BLOCKER_FIX_PASS.md`

## What Changed

### 1. System audit rows are now real for stage writes

- `runEvidenceEnrichment(...)` now writes `evidence_fragments` and one matching `audit_events` row in the same transaction for each observation that actually produces fragments.
- `runAddressResolution(...)` now writes changed `resolved_fields` rows and one matching `audit_events` row in the same transaction for each listing that actually changes.
- No-op reruns still skip writes and now also skip synthetic audit rows.

Current event kinds:

- `evidence_enrichment_recorded`
  - target: `post_observation:<observationId>`
  - payload: producer tuple plus fragment count and summary
- `address_resolution_recorded`
  - target: `listing_record:<listingId>`
  - payload: resolver tuple plus written field summaries

### 2. Review write support is now enforced at the API boundary

- `POST /api/dashboard/review/manual-overrides`
- `POST /api/dashboard/review/manual-overrides/clear`

now require a `reviewId` and reject unsupported Review items with a `409`.

Backend support comes from the Review detail contract itself:

- current Review action support from `GET /api/dashboard/review/:reviewId`
- for supported listing-backed Review items, the surfaced location fields listed in `actions.manualOverride.fieldPaths` are editable
- or an existing active Review-owned manual override on that exact field, so update/clear still work if the original review reason drops away after a prior manual save

### 3. Posts no longer implies Review support when none exists

- `PostsRoute.jsx` now renders the Review handoff only when `reviewLinkTarget` is present.
- The visible link text is now `Open in Review`.
- The old fallback `"/review"` link path is gone from that surface.

## Validation

Targeted checks:

- `node --check src/storage/sqlite-storage.js`
- `node --check src/processing/run-evidence-enrichment.js`
- `node --check src/processing/run-address-resolution.js`
- `node --check src/ui/inspection-server.js`
- `node --test test/evidence-enrichment.test.js`
- `node --test test/address-resolution.test.js`
- `node --test test/dashboard-api.test.js`
- `node --test test/inspect-ui.test.js`

Full suite:

- `npm test`
  - `110/110` passing

Seeded runtime validation:

- disposable temp-data stage run
  - `runEvidenceEnrichment(...)` wrote fragments and one `evidence_enrichment_recorded` audit row
  - `runAddressResolution(...)` wrote five resolved rows and one `address_resolution_recorded` audit row
- `npm run inspect:storage -- audit --data-dir <temp> --target-kind post_observation --target-id <obsId> --event-kind evidence_enrichment_recorded --limit 5`
  - returned the expected system enrichment event
- `npm run inspect:storage -- audit --data-dir <temp> --target-kind listing_record --target-id <listingId> --event-kind address_resolution_recorded --limit 5`
  - returned the expected system resolution event
- disposable Review/API runtime
  - unsupported `POST /api/dashboard/review/manual-overrides` on a non-reviewable listing returned `409`
  - supported Review override create still returned `200` and switched the effective layer to `manual_override`
- `npm run inspect:ui -- --data-dir <temp> --port 0`
  - served successfully
  - `GET /api/dashboard/review/ambiguous:<listingId>?queue=ambiguous` returned `actions.manualOverride.supported: true`
  - `/dashboard/app.js` contains `Open in Review` and no longer contains `Review this listing`
- `npm run inspect:storage -- evidence --data-dir <temp> --observation-id <obsId> --limit 5`
- `npm run inspect:storage -- resolved --data-dir <temp> --target-kind listing_record --target-id <listingId> --limit 5`
- `npm run inspect:storage -- manual --data-dir <temp> --target-kind listing_record --target-id <listingId> --limit 5`
- `npm run inspect:storage -- audit --data-dir <temp> --target-kind listing_record --target-id <listingId> --limit 5`

## Closeout Verdict

The two real blockers from the review are fixed:

- enrichment/resolution auditability is now durable and honest
- unsupported Review edits are rejected at the backend instead of merely hidden in the UI

The small residual debt is also closed:

- Posts no longer shows a misleading Review action when no target exists
- the coordination board now reflects the completed state

This milestone is now honestly closeable.

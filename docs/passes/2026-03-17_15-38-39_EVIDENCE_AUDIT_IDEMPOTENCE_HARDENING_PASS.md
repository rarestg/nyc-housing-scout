# Evidence Audit Idempotence Hardening Pass

Date: 2026-03-17 15:38:39 EDT

## Scope

Final narrow hardening pass for the evidence resolution and review milestone:

- move the final no-op decision for audited enrichment writes inside the storage transaction
- move the final no-op decision for audited resolved-field writes inside the storage transaction
- keep the current Review editing rule and state it explicitly in tests/docs instead of tightening it further

## Files Changed

- `src/storage/sqlite-storage.js`
- `src/processing/run-evidence-enrichment.js`
- `src/processing/run-address-resolution.js`
- `test/evidence-enrichment.test.js`
- `test/address-resolution.test.js`
- `test/dashboard-api.test.js`
- `docs/PIPELINE.md`
- `src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/05_COORDINATION_BOARD.txt`
- `docs/passes/2026-03-17_15-01-14_EVIDENCE_REVIEW_CLOSEOUT_BLOCKER_FIX_PASS.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-17_15-38-39_EVIDENCE_AUDIT_IDEMPOTENCE_HARDENING_PASS.md`

## What Changed

### 1. Audited enrichment writes now re-check producer satisfaction inside the transaction

- `recordEvidenceFragmentsWithAudit(...)` now re-checks whether the observation already has fragments for the same producer kind/version after `BEGIN IMMEDIATE` succeeds.
- If another overlapping run already satisfied that producer-version, the helper now returns `created: []` and skips the audit insert.
- `runEvidenceEnrichment(...)` now treats that transaction-local skip as `skipped_existing` instead of claiming an enrichment happened.

### 2. Audited resolved-field writes now re-check current field state inside the transaction

- `upsertResolvedFieldsWithAudit(...)` now compares each proposed field against the current stored row after `BEGIN IMMEDIATE` succeeds.
- Fields that are already current at commit time are skipped instead of being rewritten, and they do not create a second `address_resolution_recorded` audit row.
- The audit payload is now derived from the fields actually written, not just the caller's pre-transaction candidate set.
- `runAddressResolution(...)` now counts those transaction-local skips as unchanged work instead of implying a write happened.

### 3. Review field-edit contract is now explicit rather than implied

Current rule:

- unsupported Review items reject manual-override writes with `409`
- supported listing-backed Review items may edit the surfaced location fields advertised by `actions.manualOverride.fieldPaths`
- an existing active Review-owned override on the same field can still be updated or cleared even if the original review reason later drops away

This pass keeps that rule intact and locks it in via docs/tests instead of adding stricter per-field gating logic.

## Validation

Syntax and targeted tests:

- `node --check src/storage/sqlite-storage.js`
- `node --check src/processing/run-evidence-enrichment.js`
- `node --check src/processing/run-address-resolution.js`
- `node --check test/evidence-enrichment.test.js`
- `node --check test/address-resolution.test.js`
- `node --check test/dashboard-api.test.js`
- `node --test test/evidence-enrichment.test.js`
- `node --test test/address-resolution.test.js`
- `node --test test/dashboard-api.test.js`

Runtime proof on disposable temp data:

- seeded one accepted listing and one ambiguous listing
- confirmed a stale duplicate `recordEvidenceFragmentsWithAudit(...)` call returned `created: []` and left the enrichment audit count at `1`
- confirmed a stale duplicate `upsertResolvedFieldsWithAudit(...)` call returned `fields: []` and left the resolution audit count at `1`
- `npm run inspect:storage -- audit ...` showed exactly one `evidence_enrichment_recorded` row for the observation and one `address_resolution_recorded` row for the listing
- started the local inspection server against the temp data
- confirmed unsupported `POST /api/dashboard/review/manual-overrides` returned `409`
- confirmed supported `POST /api/dashboard/review/manual-overrides` on another surfaced location field returned `200` and produced `effectiveLayer: "manual_override"`

Full suite:

- `npm test`
  - `112/112` passing

## Closeout

The race-safety caveat from the independent code review is now addressed at the storage boundary where it belonged.

The Review editing rule is no longer ambiguous in the docs or tests:

- support is decided per Review item
- supported listing-backed items may edit the surfaced location fields exposed by the action contract

With this pass, the milestone is honestly closeable without caveating the audited write path as merely serial-rerun safe.

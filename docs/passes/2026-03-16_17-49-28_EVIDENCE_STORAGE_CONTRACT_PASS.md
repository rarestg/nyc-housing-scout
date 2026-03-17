# Evidence Storage Contract Pass

## 1. Scope

Locked the storage contract for the evidence resolution and review milestone:

- add the SQLite migration for `evidence_fragments`, `resolved_fields`, `manual_overrides`, and `audit_events`
- add storage helpers for writing and reading those layers
- define and test the effective-value precedence rule
- keep `post_observations`, `processed_payloads`, and `listing_records` immutable
- update the minimal source-of-truth docs tied to the contract change

Explicit non-goals:

- no evidence enrichment implementation yet
- no address resolution implementation yet
- no review API or frontend correction UI
- no compatibility shims for stale local state

## 2. Files Changed

- `src/storage/migrations/0003_evidence_resolution_and_review.sql`
- `src/storage/sqlite-storage.js`
- `test/evidence-resolution-storage.test.js`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/PIPELINE.md`
- `data/README.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_17-49-28_EVIDENCE_STORAGE_CONTRACT_PASS.md`

## 3. Contract Locked

New durable tables:

- `evidence_fragments`
  - observation-scoped field clues with run/source/stable-post provenance
- `resolved_fields`
  - one current system-produced row per `target_kind` + `target_id` + `field_path`
- `manual_overrides`
  - one current durable operator-authored row per `target_kind` + `target_id` + `field_path`
- `audit_events`
  - append-only event history for review/resolution actions

Storage helpers added:

- `recordEvidenceFragments(...)`
- `listEvidenceFragments(...)`
- `upsertResolvedField(...)`
- `listResolvedFields(...)`
- `setManualOverride(...)`
- `clearManualOverride(...)`
- `listManualOverrides(...)`
- `appendAuditEvent(...)`
- `listAuditEvents(...)`
- `getEffectiveFieldValue(...)`

Precedence rule locked:

1. active manual override
2. accepted resolved field
3. raw extracted listing value
4. raw observation-derived fallback

Important behavior:

- only `manual_overrides.status = 'active'` participates in precedence
- only `resolved_fields.status = 'accepted'` participates in precedence
- raw rows stay unchanged; layered reads sit above them
- `listing_record` targets now auto-resolve source/observation provenance inside storage helpers

## 4. Exact Commands Run

Context reads:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,280p' docs/PIPELINE.md
sed -n '1,280p' docs/LISTING_SCHEMA.md
sed -n '1,260p' data/README.md
sed -n '1,220p' docs/passes/README.md
sed -n '1,260p' docs/notes/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_OVERRIDE_DESIGN.md
sed -n '1,240p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/README.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/01_REPO_STATE_SYNTHESIS.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/02_STORAGE_AND_PRECEDENCE_DESIGN.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/03_EXECUTION_PLAN.txt
sed -n '1,240p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/04_DISPATCH_PROTOCOL.txt
sed -n '1,260p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/05_COORDINATION_BOARD.txt
sed -n '1,220p' src/ui/planning/archived/2026-03-16_17-33-28_EVIDENCE_RESOLUTION_AND_REVIEW_EXECUTION_PLAN/handoffs/worker_1_status.txt
sed -n '1,260p' src/storage/migrations/0001_init.sql
sed -n '1,320p' src/storage/migrations/0002_processing_pipeline.sql
sed -n '1,360p' src/storage/sqlite-storage.js
sed -n '360,760p' src/storage/sqlite-storage.js
sed -n '760,1410p' src/storage/sqlite-storage.js
sed -n '2080,2625p' src/storage/sqlite-storage.js
sed -n '2625,4045p' src/storage/sqlite-storage.js
sed -n '1,280p' test/storage-interface.test.js
sed -n '1,320p' test/storage-inspection.test.js
sed -n '1,220p' docs/passes/2026-03-16_16-34-20_COLLECTION_PROCESSING_BOUNDARY_SIMPLIFICATION_PASS.md
rg --files test
rg -n "evidence_fragments|resolved_fields|manual_overrides|audit_events|effective-value|effective value|precedence" docs src test
rg -n "applyMigrations|withTransaction|listings|processing|dashboard|select|require|nextId|toJson|fromRow" src/storage/sqlite-storage.js
rg -n "counts\\.migrations|schema_migrations|migrations" test src
```

Validation:

```bash
node --check src/storage/sqlite-storage.js
node --check test/evidence-resolution-storage.test.js
node --test test/evidence-resolution-storage.test.js
node --test test/storage-interface.test.js
npm test
```

## 5. Validation Results

- `node --test test/evidence-resolution-storage.test.js`
  - `1/1` passing
- `node --test test/storage-interface.test.js`
  - `2/2` passing
- `npm test`
  - `95/95` passing

## 6. Risks / Follow-ups

- `getEffectiveFieldValue(...)` locks the precedence contract, but it is still a storage-layer helper. Worker 4 still needs to thread this into listing/review read models.
- `resolved_fields` and `manual_overrides` currently keep one current row per target field. Full historical detail belongs in `audit_events`, not in those tables.
- No CLI or UI surface reads the new tables yet. That is intentionally deferred to later workers.

## 7. Recommendation For Worker 2 / Worker 3

- Worker 2 should write only to `evidence_fragments` and treat `recordEvidenceFragments(...)` as the stable batch helper.
- Worker 3 should write only to `resolved_fields` and rely on `upsertResolvedField(...)` plus `supportingFragmentIds`.
- Neither worker should mutate `listing_records` or `post_observations`; they should feed the layered read path instead.

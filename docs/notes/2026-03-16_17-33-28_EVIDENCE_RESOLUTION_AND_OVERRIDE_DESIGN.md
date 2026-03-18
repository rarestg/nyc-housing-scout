# Evidence Resolution And Override Design

This note captured the design input for a milestone that is now complete. Keep using it as historical design context, not as the current "next milestone" source of truth.

## Purpose

This note defined the minimum backend/storage design for the evidence resolution and review milestone:

- observation-scoped evidence enrichment
- NYC-constrained address resolution
- durable manual overrides with auditability
- effective-value read models for `Listings`, `Review`, and later alerts

The goal is to layer these capabilities on top of the current observation-centric SQLite spine without rewriting collection, processing, or the forensic surfaces.

## Non-Negotiables

- SQLite remains canonical.
- `post_observations`, `processed_payloads`, and `listing_records` remain raw/forensic records and are not overwritten.
- Enrichment stays observation-scoped and independently runnable after observation persistence.
- Effective values are layered, not destructive.
- `Debug` remains forensic.
- `Review` becomes the correction/action surface only after durable backend support exists.

## Existing Spine

Today the durable spine is:

- `post_observations`
- `artifact_refs`
- `processing_jobs`
- `processed_payloads`
- `listing_records`

That spine already preserves run/source/observation/job/payload/listing lineage. The missing layer is field-level provenance plus durable resolved/manual state.

## Proposed New Storage Layers

Add one new migration that introduces four generic tables:

1. `evidence_fragments`
2. `resolved_fields`
3. `manual_overrides`
4. `audit_events`

These should layer over existing raw tables, not replace them.

## Table Intent

### `evidence_fragments`

Observation-scoped clues derived from already-persisted evidence.

Suggested shape:

- `id`
- `source_id`
- `observation_id`
- `stable_post_id`
- `run_id`
- `fragment_kind`
- `field_path`
- `source_surface`
- `source_ref`
- `producer_kind`
- `producer_version`
- `raw_text`
- `normalized_json`
- `confidence`
- `metadata_json`
- `created_at`

Key design notes:

- Keep this generic, not address-only.
- One fragment should represent one useful clue for one field path or field family.
- `source_surface` should distinguish where the clue came from:
  - `body_text`
  - `comments`
  - `media`
  - `network_enrichment`
  - `processed_payload`
  - later `ocr`, `llm_parse`, etc.
- `source_ref` should point back to the source location when possible:
  - JSON pointer
  - media index
  - attachment URL
  - payload path

### `resolved_fields`

System-produced candidate or accepted resolved values that sit above raw extraction but below manual overrides.

Suggested shape:

- `id`
- `target_kind`
- `target_id`
- `source_id`
- `observation_id`
- `field_path`
- `status`
- `resolution_kind`
- `resolver_version`
- `value_json`
- `confidence`
- `ambiguity_json`
- `supporting_fragment_ids_json`
- `metadata_json`
- `created_at`
- `updated_at`

Key design notes:

- Keep this generic across fields.
- `target_kind` / `target_id` should support at least `listing_record` from the start.
- `status` should make ambiguity explicit instead of hiding it.
- `supporting_fragment_ids_json` preserves field-level provenance.

### `manual_overrides`

The current active human-authored value for a field.

Suggested shape:

- `id`
- `target_kind`
- `target_id`
- `source_id`
- `observation_id`
- `field_path`
- `value_json`
- `reason`
- `operator_id`
- `status`
- `metadata_json`
- `created_at`
- `updated_at`
- `cleared_at`

Key design notes:

- Keep only the active override here.
- Do not use this as the full history table.
- Clearing an override should not erase history; it should change status and produce an audit event.

### `audit_events`

Append-only event stream for review, resolution, and override actions.

Suggested shape:

- `id`
- `target_kind`
- `target_id`
- `source_id`
- `observation_id`
- `event_kind`
- `actor_kind`
- `actor_id`
- `payload_json`
- `created_at`

Key design notes:

- This is the durable history layer.
- It should capture:
  - enrichment writes
  - resolution proposals / acceptance / rejection
  - override set / clear
  - later review workflow actions

## Effective Value Semantics

Define one explicit precedence rule and reuse it everywhere:

1. active manual override
2. accepted resolved field
3. raw extracted value from `listing_records` / processed payload normalization
4. legacy heuristic / raw observation-derived value

Important consequences:

- `listing_records` stays immutable for forensics.
- dashboard list/detail views should read effective values, not mutate raw rows.
- `Debug` should expose the layered view:
  - raw
  - resolved
  - manual
- alerts and saved searches should later use effective values too.

## Pipeline Boundaries

Recommended stage sequence:

1. observation capture persists raw observation
2. processing pipeline persists jobs, payloads, listing records
3. evidence enrichment stage writes `evidence_fragments`
4. address resolution stage writes `resolved_fields`
5. effective-value read helpers layer raw + resolved + manual
6. review/correction APIs write `manual_overrides` + `audit_events`

Do not push enrichment logic back into collection.

## CLI / Stage Shape

Keep this stage-oriented and independently runnable:

- `enrich:evidence`
  - reads persisted observations and related payload inputs
  - writes `evidence_fragments`

- `resolve:addresses`
  - reads `evidence_fragments`
  - writes `resolved_fields`

- later review/correction commands or local API handlers
  - write `manual_overrides`
  - append `audit_events`

## Field Coverage

Start with the most valuable fields first:

1. address / location clues
2. neighborhood / borough resolution
3. price clues
4. bedrooms / bathrooms
5. availability

The first milestone should focus on location because it is both high-value and currently under-recovered.

## Frontend Boundary

Frontend can honestly do these only after backend support exists:

- display effective values
- show raw vs resolved vs manual badges
- show field-level evidence panels
- offer correction actions from `Review`
- explain why a value won

Frontend should not fake:

- accepted/rejected resolution state
- override precedence
- field-level missing-state explanations
- correction audit history

## Review And Debug Boundary

- `Review` owns action-taking and correction flows.
- `Debug` owns provenance, run/job/artifact/raw-payload inspection.
- `Debug` may link to `Review`, but should not become the default correction surface.

## Recommended Migration Name

Use one new migration for the contract:

- `0003_evidence_resolution_and_review.sql`

## Recommended Execution Order

1. add the new tables and storage helpers
2. define and test effective-value precedence
3. add evidence-fragment extraction
4. add NYC-constrained address resolution
5. update listings/review read models for effective values
6. add override/audit APIs
7. add minimal Review UI for correction

## High-Risk Mistakes To Avoid

- overwriting raw listing rows
- hiding ambiguity instead of storing it
- making override precedence implicit
- mixing editorial actions into `Debug`
- building correction UI before the override/audit model exists
- overbuilding external services when a few SQLite tables and CLIs fit the repo

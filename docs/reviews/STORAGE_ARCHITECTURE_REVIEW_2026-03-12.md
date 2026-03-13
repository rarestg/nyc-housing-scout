# Storage Architecture Review — 2026-03-12

## Scope

This review is based on the current repository state, especially:

- `src/cli/capture-dom-feed.js`
- `src/cli/crawl-dom-latest.js`
- `src/cli/capture-feed.js`
- `src/cli/crawl-latest.js`
- `src/core/artifacts.js`
- `src/core/browser-pipeline.js`
- `src/core/collected-post.js`
- `src/browser/dom-extractor.js`
- `docs/PIPELINE.md`
- current artifacts under `data/`

I also checked the current local runtime. This repo is on Node `v25.8.1`, and `node:sqlite` is available, which materially changes the cost of adopting SQLite now.

## Executive Recommendation

Use SQLite now, but do not wire the app directly to ad hoc SQL from the CLI commands.

The right move for this repository today is:

1. Keep raw browser artifacts as immutable files on disk.
2. Move hot state and queryable records into SQLite.
3. Put a thin storage interface in front of SQLite, with SQLite as the only implementation for now.
4. Keep `data/collected/*` and `data/listings/*` as derived run exports, not the canonical source of truth.
5. Do not add Postgres now.

That gives the project robust seen-post caching, replayable artifacts, incremental collection, and room to grow without paying early operational cost.

## What The Repo Does Well Today

The current DOM path is substantially better than the original flat-file-only shape:

- The DOM collector now cleanly separates raw payloads, collected posts, and listing bundles in the DOM path (`src/core/artifacts.js:4-23`, `src/cli/capture-dom-feed.js:13-55`, `src/cli/crawl-dom-latest.js:15-100`).
- The canonical `CollectedPost` contract is a real improvement over the earlier mixed shapes (`src/core/collected-post.js:4-39`).
- DOM crawl freshness semantics are better than before: fresh, seen, and unidentified are counted separately, and only fresh posts are extracted into listings (`src/cli/crawl-dom-latest.js:23-27`, `src/cli/crawl-dom-latest.js:54-67`).
- Raw artifact references are carried through to collected posts and listing `source.*` metadata (`src/core/collected-post.js:29-37`, `src/extractors/text-extractor.js:248-260`).

Those are the right foundations.

## Current Storage Weaknesses

### 1. Seen-post state is still a single global JSON file

The active DOM commands still load and write `data/cache/seen-post-ids.json` directly (`src/core/browser-pipeline.js:21-23`, `src/cli/capture-dom-feed.js:15-17`, `src/cli/crawl-dom-latest.js:17-19`, `src/cli/crawl-dom-latest.js:97-100`).

That is too weak for the next phase because:

- it is global, not source-scoped
- it only keys on `postId`
- it cannot record first-seen, last-seen, or times-seen
- it cannot answer run-history questions
- it is awkward to extend once there are multiple groups/pages/sources

The current freshness classifier confirms the limitation: if a post has no `postId`, it is always `unidentified`, and if it has a `postId`, freshness is decided only by membership in an in-memory set (`src/core/collected-post.js:45-48`).

### 2. Storage is still capture-method-scoped, not source-scoped

The DOM collectors hardcode `sourceSlug: 'facebook-dom'` (`src/cli/capture-dom-feed.js:14`, `src/cli/crawl-dom-latest.js:16`).

That means the primary storage path is organized around how the data was collected, not what source it came from. That will break down as soon as the same Facebook group is collected by multiple methods or as soon as there are multiple groups/pages.

Related problem: `groupName` exists in the `CollectedPost` shape, but current DOM extraction does not actually populate it (`src/core/collected-post.js:20-23`, `src/browser/dom-extractor.js:56-80`). In the sampled collected artifact at `data/collected/facebook-dom/capture-2026-03-12T20-29-13-023Z.json`, every row has `groupName: null`.

### 3. Run checkpoints are not really persisted

`crawl:dom` builds a useful `stepLog`, but it only emits that in the final console summary (`src/cli/crawl-dom-latest.js:22`, `src/cli/crawl-dom-latest.js:70-83`, `src/cli/crawl-dom-latest.js:102-116`).

That means:

- there is no durable checkpoint record during the run
- a crash loses crawl progress metadata
- there is no persisted run history to debug collection behavior later

Given the fragility of DOM collection, run-step history is important operational data, not just a log line.

### 4. The repo is in a mixed storage era

The newer DOM path has a better artifact split, but the older snapshot path still writes parsed-and-enriched records into `data/raw/*` and uses separate ad hoc storage code (`src/cli/capture-feed.js:10-44`, `src/cli/crawl-latest.js:11-55`).

Current `data/` reflects both worlds:

- newer run-scoped raw DOM artifacts under `data/raw/facebook-dom/<runId>/...`
- older flat raw files under `data/raw/facebook-dom/*.json`
- legacy normalized bundles under `data/normalized/...`
- newer collected/listings bundles under `data/collected/...` and `data/listings/...`

That is fine for prototype history, but it is not a clean long-term storage model.

### 5. The current artifacts show why seen-state must not depend on unstable metadata

The new sampled collected artifact is better structured, but on the five sampled rows:

- `5/5` have `postId`
- `0/5` have `postUrl`
- `0/5` have `authorName`
- `0/5` have `postedAtText`

The older flat raw DOM directory is noisier:

- `24` files total
- `15` with `postId`
- `0` with `postUrl`
- `14` with `author`
- `8` with `postedAtText`

This matters because the collector can rely on stable `postId` when it exists, but it should not promote weak fallback identity into durable seen-cache authority.

## Option Evaluation

| Option | Fit For This Repo Right Now | Strengths | Problems | Verdict |
| --- | --- | --- | --- | --- |
| Flat files only | Poor | Simple, transparent, great for raw artifacts | No transactions, weak indexing, awkward seen-state evolution, hard run history, hard queries across runs, easy drift between files | Keep for raw artifacts only, not for primary state |
| SQLite directly, no abstraction | Good | Local-first, zero service, transactional, enough scale by a wide margin, especially with built-in `node:sqlite` | SQL will spread into CLI files; future migration to Postgres becomes a repo-wide refactor; current persistence duplication will just become SQL duplication | Better than flat files only, but not the best choice |
| Thin interface with SQLite implementation first | Best | Keeps local-first simplicity, contains SQL in one layer, preserves ability to move to Postgres later, avoids overbuilding if the interface stays narrow and domain-shaped | Small upfront design cost | Choose this now |
| Postgres now | Poor | Good for multi-user remote services and many concurrent writers | Operational overhead, worse local dev story, unnecessary for current scale, pushes architecture toward a service too early | Do not do this now |

## Concrete Recommendation

Implement a narrow storage boundary and back it with SQLite first.

Not a generic ORM. Not “support every SQL backend” from day one. A small domain-level interface.

The practical target should be something like:

- `src/storage/storage.js`
  - documents the operations the collector needs
- `src/storage/sqlite-storage.js`
  - the only place that knows about SQL
- `src/storage/migrations/*.sql`
  - explicit schema migration files
- `data/storage/nyc-housing-scout.sqlite`
  - local database file

Recommended SQLite setup:

- use `node:sqlite`
- enable foreign keys
- enable WAL mode
- keep writes transactional per crawl step or per batch

Why this is the right call now:

- the repo is single-machine and local-first
- the scale is tiny by database standards; `100+` posts is trivial for SQLite
- the project needs better state management more than it needs remote infrastructure
- the repo already shows the cost of persistence logic leaking into command files

## Proposed Storage Architecture For The Next Pass

### Storage Principles

1. Raw artifacts are immutable files.
2. Queryable state lives in SQLite.
3. Per-run JSON bundles remain useful, but they are exports, not source of truth.
4. Stable post identity and observed post snapshots are different things and should be stored separately.
5. “Seen” is source-scoped and based on stable identity, not loose fallback dedupe.

### What Stays As Files

Keep these on disk:

- raw browser-origin JSON payloads
- raw HTML captures if added later
- screenshots if added later
- optional end-of-run export bundles for human inspection

Recommended path shape:

- `data/raw/facebook/<source_key>/<run_id>/<artifact>.json`
- `data/collected/facebook/<source_key>/crawl-<run_id>.json`
- `data/listings/facebook/<source_key>/crawl-<run_id>.json`

Important change from current layout:

- organize primarily by platform and source
- store capture method in metadata, not in the top-level directory name

### What Moves To SQLite

SQLite should become the source of truth for:

- source registry
- durable seen-post state
- crawl runs
- crawl run steps/checkpoints
- stable post identity rows
- post observations collected during runs
- extracted listing rows
- artifact references and metadata

### Tables / Records

#### `sources`

One row per Facebook source being tracked.

Suggested fields:

- `id`
- `source_key` unique
- `platform` (`facebook`)
- `source_type` (`group`, `page`, `profile`, `unknown`)
- `display_name`
- `external_url`
- `browser_profile`
- `active`
- `created_at`
- `updated_at`

Why it is needed:

- current storage is not source-scoped
- `groupName` is currently mostly null
- future seen-state and scaling depend on a stable source identifier

#### `crawl_runs`

One row per capture/crawl/replay execution.

Suggested fields:

- `id`
- `source_id`
- `run_kind` (`capture`, `crawl`, `replay`)
- `status` (`running`, `completed`, `aborted`, `failed`)
- `started_at`
- `finished_at`
- `target_fresh`
- `max_scrolls`
- `browser_profile`
- `capture_method`
- `collector_version`
- `summary_json`
- `collected_export_path`
- `listings_export_path`

This replaces today’s implicit run metadata spread across filenames and console output.

#### `crawl_run_steps`

One row per scroll/step/checkpoint within a crawl run.

Suggested fields:

- `id`
- `run_id`
- `step_index`
- `expanded_count`
- `visible_posts`
- `added_count`
- `fresh_count`
- `seen_count`
- `unidentified_count`
- `scroll_y`
- `body_height`
- `page_href`
- `page_title`
- `recorded_at`

This is the durable form of the current `stepLog`.

Checkpoint semantics should be practical, not magical:

- this table is for progress tracking and debugging
- it is not a promise that the DOM session can resume exactly mid-scroll after a crash
- recovery should be “start a new run and rely on seen-state”, not “restore browser position exactly”

#### `artifact_refs`

One row per persisted artifact file.

Suggested fields:

- `id`
- `run_id`
- `source_id`
- `observation_id` nullable
- `artifact_kind` (`raw_post_payload`, `collected_export`, `listing_export`, `html_capture`, `screenshot`)
- `relative_path`
- `sha256`
- `byte_size`
- `created_at`
- `metadata_json`

This is how raw artifacts should be referenced.

Important rule:

- store paths and hashes in the DB
- do not store raw browser payload blobs inside SQLite

#### `stable_posts`

One row per source-scoped post with stable identity.

Suggested fields:

- `id`
- `source_id`
- `platform_post_id`
- `canonical_post_url`
- `first_seen_run_id`
- `first_seen_at`
- `last_seen_run_id`
- `last_seen_at`
- `times_seen`
- `latest_observation_id`

Recommended constraint:

- unique on `(source_id, platform_post_id)`

This table is the durable replacement for the current JSON seen-cache.

#### `post_observations`

One row per collected post snapshot during a run.

Suggested fields:

- `id`
- `run_id`
- `step_index` nullable
- `source_id`
- `stable_post_id` nullable
- `platform_post_id` nullable
- `provisional_dedupe_key`
- `freshness` (`fresh`, `seen`, `unidentified`)
- `identity_confidence` (`stable`, `provisional`)
- `author_name`
- `posted_at_text`
- `body_text`
- `comments_json`
- `media_json`
- `capture_method`
- `captured_at`
- `raw_artifact_id`
- `derived_neighborhood`
- `derived_borough`
- `capture_hints_json`

Why this split matters:

- the same post can be seen across many runs
- metadata can improve over time
- extraction should be tied to an observation, not only to a canonical post row

#### `listing_records`

One row per extracted listing derived from a post observation.

Suggested fields:

- `id`
- `observation_id`
- `ordinal`
- `listing_type`
- `post_intent`
- `borough`
- `neighborhood`
- `price_amount`
- `price_period`
- `available_from_text`
- `confidence_overall`
- `payload_json`
- `extractor_version`
- `created_at`

Recommended constraint:

- unique on `(observation_id, ordinal)`

Important design choice:

- keep a few query-critical columns first-class
- keep the full normalized listing in `payload_json`
- do not fully normalize every nested listing attribute yet

That gives schema stability while the extractor is still changing.

## Seen-Post Tracking Design

### What should count as “seen”

A post is durably seen only when there is a stable identity:

- `source_id`
- `platform_post_id`

That should be the authoritative key.

### What should not count as durable seen-state

Do not treat fallback dedupe as permanent seen-state across runs.

In the current code, fallback dedupe keys are derived from partial text and metadata (`src/core/collected-post.js:120-125`). That is acceptable for within-run duplicate suppression. It is not strong enough for long-term skip decisions.

### Recommended runtime behavior

For each collected record:

1. If `postId` is missing:
   - store a `post_observation`
   - mark it `unidentified`
   - use `provisional_dedupe_key` only for within-run duplicate suppression
   - do not update durable seen-state
2. If `postId` exists and no `(source_id, platform_post_id)` row exists:
   - create or upsert `stable_posts`
   - classify as `fresh`
3. If `postId` exists and the row already exists:
   - classify as `seen`
   - update `last_seen_at`, `times_seen`, and `latest_observation_id`

Optional later, but not now:

- a short-lived provisional fingerprint cache with expiration for unidentified posts

Do not build that yet unless unidentified duplicates become a real operational problem.

## Crawl Runs And Checkpoints

### Start of run

Insert a `crawl_runs` row with:

- source
- mode
- targets
- profile
- status `running`

### During each crawl step

Recommended order:

1. write raw artifact files to disk
2. calculate path/hash/size metadata
3. in one SQLite transaction:
   - write `artifact_refs`
   - write `post_observations`
   - upsert `stable_posts`
   - write `listing_records`
   - write `crawl_run_steps`

This order matters.

It is acceptable to end up with an orphan raw file if the DB transaction fails. It is worse to commit DB rows that point to files that were never written.

### End of run

At run completion:

- write optional JSON exports to `data/collected/*` and `data/listings/*`
- store those export paths in `crawl_runs`
- mark the run `completed`

If the process exits unexpectedly:

- leave the run `running`
- on next startup, stale `running` rows can be marked `aborted`
- start a new run rather than trying to restore exact DOM scroll state

## How Raw Artifacts Should Be Referenced

Raw artifacts should remain first-class replay inputs.

Store these in SQLite for each artifact:

- relative path from repo root or `data/`
- artifact kind
- content hash
- byte size
- run/source link
- optional observation link

Why this matters:

- replay extraction against the exact same input later
- verify file integrity
- regenerate collected/listing exports
- support future raw artifact kinds without changing every table

Use relative paths, not absolute paths. Absolute paths make the dataset harder to move and harder to share across environments.

## Interface Recommendation: What To Abstract

Define a storage interface around domain operations, not database primitives.

Good shape:

- `getOrCreateSource`
- `beginRun`
- `recordObservationBatch`
- `appendRunStep`
- `finishRun`
- `findStablePostByPlatformId`
- `listRunObservations`
- `exportRunArtifacts`

Bad shape:

- generic CRUD repositories for every table
- trying to hide SQL entirely
- pretending SQLite and Postgres are identical

The interface is there to contain persistence decisions, not to simulate a universal database API.

## Migration Risks

### 1. Source identity is not strong enough yet

This is the biggest storage migration risk.

The DOM extractor currently captures post-level fields, but not robust source identity (`src/browser/dom-extractor.js:56-80`). The storage pass should introduce a required `source_key` input for DOM commands, even if group-name extraction remains imperfect.

Practical answer:

- add `--source-key`
- optionally add `--source-name` / `--source-url`
- persist that immediately

Do not wait for DOM auto-detection to be perfect.

### 2. The repo has both old and new artifact layouts

Current data includes:

- legacy `data/raw/facebook-dom/*.json`
- newer `data/raw/facebook-dom/<runId>/*.json`
- legacy `data/normalized/*`
- newer `data/collected/*` and `data/listings/*`

Recommendation:

- do not spend time perfectly migrating every exploratory artifact
- import only what is useful for bootstrap state
- treat the old files as historical evidence, not canonical ongoing storage

### 3. Dual-writing JSON cache and DB state will drift

Once SQLite seen-state exists, the JSON cache should stop being authoritative.

If needed during transition:

- import `data/cache/seen-post-ids.json` once
- write a temporary debug export from SQLite if humans still want a flat file

But do not keep two durable seen-state systems in long-term operation.

### 4. Unidentified posts can create false positives if handled badly

The system should not permanently suppress no-`postId` observations just because a fallback dedupe key looks similar.

That is a correctness risk, not just a cleanup issue.

### 5. Listing schema will keep moving

The extractor is still evolving. If the database schema mirrors every nested listing field as first-class relational columns immediately, migrations will get noisy.

That is why `listing_records` should keep:

- a few key indexable columns
- one full `payload_json`

## What Not To Overbuild Yet

Do not add these in the next pass:

- Postgres deployment
- dual SQLite/Postgres runtime support
- ORM or query-builder heavy stack
- exact resume of a live browser session mid-crawl
- cross-post dedupe across different source groups
- fully normalized child tables for every listing feature
- blob storage of raw artifacts inside the database
- a full scheduler/service architecture

Those are later decisions. They are not required to make the collector robust now.

## Recommended Implementation Order

1. Add SQLite storage with migrations and a `sources` table.
2. Make DOM commands require or infer a stable `source_key`.
3. Replace `loadSeenIds(...)` usage in the DOM path with storage-backed seen checks.
4. Persist `crawl_runs`, `crawl_run_steps`, `artifact_refs`, `post_observations`, and `listing_records`.
5. Keep raw artifacts on disk and store their metadata in SQLite.
6. Generate `data/collected/*` and `data/listings/*` from DB-backed run data.
7. Leave the snapshot path as legacy until the DOM path is stable enough to justify cleanup.

## Bottom Line

Flat files should remain part of the system, but only for immutable artifacts and optional exports.

The project now needs a real local database for state. SQLite is the correct database. A thin storage interface is the correct boundary. Postgres is not the correct move yet.

If this repo does the next pass that way, it will get:

- robust source-scoped seen caching
- replayable artifact references
- durable run/checkpoint history
- cleaner incremental collection
- a migration path to Postgres later if the product actually grows into a shared service

# Pipeline Guide

Current operations guide for the active local-first pipeline.

Use this doc for:
- the current command surface
- the current collection -> queue -> extraction -> review flow
- the current local UI and inspection surfaces
- the current artifact/storage boundaries

Use other docs for adjacent concerns:
- `docs/VISION_AND_ARCHITECTURE.md` for the durable north-star architecture
- `docs/ROADMAP.md` for what is next
- `docs/LISTING_SCHEMA.md` for the normalized listing contract
- `data/README.md` for on-disk layout details
- `src/ui/ARCHITECTURE.md` for dashboard/inspector contributor guidance

## Current Boundary

The active system boundary is:
- local SQLite is the canonical write-side
- raw artifacts stay on disk under `data/`
- collection runs against a live authenticated browser tab
- queue processing writes `processed_payloads` and `listing_records` into SQLite
- local operator surfaces read directly from SQLite

The hosted/public read path is not the active write-side. For the current intended Cloudflare split, see:
- `docs/reviews/2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md`

## Stage Map

1. collection
   - collect DOM posts from a Facebook group page
   - persist runs, observations, raw artifacts, and collected exports
2. processing queue
   - enqueue eligible observations
   - claim jobs atomically
   - process jobs into structured payloads and listing rows
3. evidence and resolution
   - enrich observations into reusable evidence fragments
   - resolve selected fields into layered effective values
4. local operator surfaces
   - inspect storage, jobs, review state, and artifacts
   - operate the dashboard and inspector

## Prerequisites

### Collection path

The active collection path still depends on:
- an authenticated Chrome tab already open on the target Facebook group
- the current browser-control bridge (`openclaw browser ...`)
- a `--source-key` for the source being collected

For `ingest:loop`, you also need:
- `--display-name`
- `--group-url`

### Processing path

Gemini-backed processing requires one of:
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `data/cache/gemini/gemini.env`

## Collection

### Primary commands

- capture the current visible DOM slice:
  - `npm run capture:dom -- --source-key <key> --limit 20`
- crawl until enough fresh posts are collected:
  - `npm run crawl:dom -- --source-key <key> --target 20 --max-scrolls 20`
- run the long-lived ingest controller loop:
  - `npm run ingest:loop -- --source-key <key> --display-name "<name>" --group-url https://www.facebook.com/groups/<group>/ --max-cycles 1`

### Legacy debug commands

These older snapshot-era commands still exist for fallback/debug:
- `npm run capture:feed -- --limit 20`
- `npm run crawl:latest -- --target 20 --max-scrolls 20`
- `npm run expand:posts`

### What collection writes

Collection writes:
- `crawl_runs`
- `crawl_run_steps`
- `post_observations`
- `artifact_refs`
- raw post payload files
- collected-post run exports

Collection does not create listings.

The collection/processing boundary is explicit:
- `capture:dom` and `crawl:dom` stop at observations, artifacts, and run metadata
- `enqueue:processing`, `process:jobs`, and `validate:queue` are the supported path for producing `listing_records`

### Current browser-runtime model

The current implementation is still browser-tab mediated:
- DOM extraction runs through `openclaw browser evaluate`
- `crawl:dom` can pin later browser actions to a selected target tab when network assist is active
- `ingest:loop` is still primarily profile-scoped and validates the attached page against the requested group URL

Treat this browser bridge as a current implementation detail, not a permanent architectural commitment.

### CDP network assist

`crawl:dom` supports a CDP-backed network assist path for Facebook GraphQL recovery.

Current behavior:
- enabled by default during `crawl:dom`
- CDP is the only active network-assist transport
- filtered `/api/graphql/` responses are captured from the selected tab
- high-signal envelopes are normalized into Facebook post candidates
- recovered `postId`, `postUrl`, author, body, and attachment hints are merged into DOM-collected posts before persistence
- a run-scoped `network_capture_export` artifact is written under `data/raw/facebook/<sourceKey>/<runId>/`

Operator-facing flags:
- `--disable-network-capture`
- `--navigate-before-crawl`
- `--network-target-group-id <numericGroupId>`
- `--network-max-high-signal-full-response-chars <n>`
- `--network-max-full-text-envelopes <n>`

Additional lower-level `--network-*` tuning flags exist in `src/cli/crawl-dom-latest.js`. Treat them as debug knobs rather than the stable operator surface.

Current default behavior:
- `crawl:dom` uses CDP-only network capture when assist is enabled
- the older `--network-capture-mode` flag has been removed
- if CDP is unavailable, the crawl records the error and disables network assist instead of switching transports
- `--navigate-before-crawl` arms CDP capture before `openclaw browser navigate` so startup GraphQL traffic can be captured on first load

### Identity canonicalization

Post identity is normalized through `src/core/facebook-post-identity.js`.

Current rules:
- normalize Facebook post URLs to a canonical desktop form when possible
- prefer `/groups/<group>/posts/<postId>/`
- support group post URLs, permalink URLs, `story.php`, `permalink.php`, and `multi_permalinks`
- normalize `m.facebook.com` origins to desktop equivalents
- build fallback canonical post URLs from `postId` plus `groupId` or `groupUrl` when the visible card does not expose a good permalink

The collection and merge path relies on normalized identity keys such as:
- `post_id:<id>`
- `post_url:<normalized-url>`
- network-only aliases like `story_id:<id>` and `feedback_id:<id>`

### Network integration model

Network candidates are merged into DOM-collected posts conservatively.

The current model uses three main strategies:
- exact identity match
  - merge when normalized post identity already matches
- resolved duplicate reuse
  - reuse a previously resolved rich candidate for compatible same-source duplicates
- fuzzy recovery
  - recover identity from strong author/body evidence when exact identity is missing

Other current behaviors:
- fresher/richer network candidates win over weaker duplicates
- fuzzy recovery is step-bounded rather than unbounded across the whole run
- recovered identities are counted separately in run/step summaries

### CollectedPost contract

The active DOM path normalizes raw feed records into a canonical `CollectedPost` shape before persistence and downstream processing.

Most fields are assembled in `createCollectedPost(...)` and then location enrichment adds `derivedLocation` through `enrichPostLocation(...)` in `src/core/post-cleaning.js`.

Current fields include:

Identity and source:
- `dedupeKey`
- `platform`
- `sourceKey`
- `groupName`
- `groupId`
- `groupUrl`
- `postId`
- `postUrl`
- `storyId`
- `feedbackId`

Author and time:
- `authorName`
- `authorId`
- `authorUrl`
- `postedAtText`
- `postedAtTimestamp`
- `postedAtIso`

Content:
- `bodyText`
- `comments`
- `media`
- `attachmentSummary`
- `derivedLocation`

Capture and provenance:
- `captureMethod`
- `captureRunId`
- `captureIndex`
- `capturedAt`
- `rawArtifactPath`
- `captureHints`

### Crawl semantics

For `crawl:dom`, `--target` means fresh posts, not total unique posts seen during the run.

The crawl loop keeps separate counts for:
- `freshCollected`
- `seenCollected`
- `unidentifiedCollected`

When network capture is enabled, run summaries and step checkpoints also include:
- captured network envelope counts
- normalized network candidate counts
- conservative merge counts
- recovered-identity counts for DOM posts that would otherwise have landed as `unidentified`

Seen posts are still collected and persisted in the collected export, but listing creation does not happen during collection.

Run steps are checkpointed into SQLite during the crawl so source/run history survives process completion.

### ingest:loop

`ingest:loop` is a thin controller around the existing collection and processing surfaces.

Current cycle behavior:
1. browser preflight against the attached tab and current browser profile
2. CDP/browser health check plus current page URL/title validation
3. deterministic reset to the requested group URL
4. `crawl:dom` execution
5. optional fresh-only `validate:queue --freshness fresh` processing
6. state/log writing plus optional `openclaw system event` callbacks

Current control files and runtime artifacts:
- state file:
  - `data/state/ingest-loop/<source-key>.json`
- append-only cycle log:
  - `data/state/ingest-loop/<source-key>.jsonl`
- graceful stop file:
  - `data/state/ingest-loop/<source-key>.stop`

Useful flags:
- `--browser-profile <profile>`
- `--target <n>`
- `--max-scrolls <n>`
- `--process-limit <n>`
- `--sample-limit <n>`
- `--poll-interval-ms <n>`
- `--idle-interval-ms <n>`
- `--max-cycles <n>`
- `--max-idle-cycles <n>`
- `--state-file <path>`
- `--stop-file <path>`
- `--log-file <path>`
- `--notify off|important|verbose`
- `--skip-processing`
- `--dry-run`

## Processing Queue

### Primary commands

- enqueue jobs for collected observations:
  - `npm run enqueue:processing -- --run-id <runId>`
- validate queue coverage and exercise enqueue -> process -> inspect:
  - `npm run validate:queue -- --run-id <runId>`
- inspect queue state:
  - `npm run inspect:jobs -- --status pending --limit 20`
- claim and process a batch:
  - `npm run process:jobs -- --limit 10`
  - optional explicit Gemini env file:
    - `npm run process:jobs -- --limit 10 --env-file data/cache/gemini/gemini.env`
- requeue failed/retryable work:
  - `npm run retry:jobs -- --status failed`

### Queue semantics

Current semantics:
- the unit of work is one collected observation
- jobs dedupe on `(observation_id, processor_version, schema_version, model_name)`
- `postUrl` is required for queue eligibility
- `process:jobs` runs the Gemini harness by default with the canonical structured schema
- queued Gemini extraction uses `thinkingLevel: minimal` by default
- queued Gemini extraction uses an explicit abortable request timeout, clamped below `--lease-ms`
- Gemini output is persisted in `processed_payloads`
- normalized `listing_records` are derived and inserted atomically on successful completion

`process:jobs` and `validate:queue` emit batch metrics including:
- `claimToCompleteMs`
- per-job `latencyMs`
- `timeoutCount`
- `retryCount`
- aggregated Gemini `tokenUsage`
- outcome counts split into `processed`, `retryable`, and `failed`

`validate:queue` is the preferred real-data regression surface because it exercises:
- enqueue
- claim/process
- payload persistence
- listing mapping

### Processing job states

The processing queue uses a small explicit lifecycle:
- `pending`
  - ready to be claimed
- `processing`
  - currently leased by a worker
- `processed`
  - completed successfully and has a `processed_payloads` row
- `retryable`
  - failed but can be requeued or reclaimed once `available_at` is due
- `failed`
  - terminal failure until manually retried

Claim semantics are atomic:
- `claimProcessingJobs(...)` runs inside `BEGIN IMMEDIATE`
- expired leases are swept to `retryable` or `failed`
- `process:jobs` and `validate:queue` currently claim one job at a time for sequential Gemini batches
- each claimed job records `claimed_by`, `claimed_at`, and `lease_expires_at`

## Evidence And Resolution

### Primary commands

- enrich observations into reusable evidence fragments:
  - `npm run enrich:evidence -- --run-id <runId>`
- resolve address/location evidence into layered field state:
  - `npm run resolve:addresses -- --run-id <runId>`

### Layered tables

The current storage contract reserves four layered tables above the raw spine:
- `evidence_fragments`
  - observation-scoped clues derived from persisted observations and payloads
- `resolved_fields`
  - current system-produced field values keyed by `target_kind`, `target_id`, and `field_path`
- `manual_overrides`
  - current durable operator-authored field values for the same target/field contract
- `audit_events`
  - append-only history for enrichment, resolution, and override actions

Canonical field precedence is fixed:
1. active manual override
2. accepted resolved field
3. raw extracted listing value
4. raw observation-derived fallback

`post_observations`, `processed_payloads`, and `listing_records` remain immutable forensic records.

### Current evidence enrichment stage

`enrich:evidence`:
- reads persisted observations, comments, media metadata, capture-derived metadata, and network-enrichment metadata
- writes reusable observation-scoped `evidence_fragments`
- skips observations already enriched by the same producer version by default
- does not mutate `post_observations`

### Current address-resolution stage

`resolve:addresses`:
- reads persisted observation-scoped `evidence_fragments` and listing targets in scope
- writes one `resolved_fields` row per listing for:
  - `location.address`
  - `location.neighborhood`
  - `location.borough`
  - `location.city`
  - `location.state`
- constrains accepted results to NYC-supported neighborhood / borough evidence
- stores explicit `accepted`, `candidate`, `ambiguous`, or `unresolved` status with confidence, ambiguity payload, and supporting fragment IDs
- does not mutate `listing_records`

### Effective-value dashboard behavior

Current dashboard listing/review reads layer location values from:
- active manual override
- accepted resolved field
- raw extracted listing value
- raw observation-derived fallback

Non-accepted resolved rows remain visible in location state/detail views:
- `candidate`, `ambiguous`, and `unresolved` rows do not win precedence
- they still surface in Review rather than being flattened away

### Review override write surface

The Review route is the current narrow write surface for manual correction.

Current endpoints:
- `GET /api/dashboard/review/:reviewId`
  - returns review detail and `actions.manualOverride`
- `POST /api/dashboard/review/manual-overrides`
  - creates or updates a durable `manual_overrides` row and appends an audit event in the same transaction
- `POST /api/dashboard/review/manual-overrides/clear`
  - clears the durable override row and appends an audit event in the same transaction

## Inspection Surfaces

### Storage inspection CLI

The local inspection CLI sits on top of storage read helpers so you do not need ad hoc SQLite queries.

Available subcommands:
- `sources`
  - list registered sources with run / observation / listing counts
- `runs`
  - list recent runs with per-run observation, listing, step, and artifact counts
- `run-steps`
  - inspect persisted crawl checkpoints for a run
- `observations`
  - inspect collected-post observations with freshness, source metadata, artifact references, and optional full payloads
- `listings`
  - inspect extracted listing rows with observation/source context and optional payloads
- `artifacts`
  - inspect raw/export artifact references for a run or observation
- `evidence`
  - inspect evidence fragments by observation, field path, source surface, or producer version
- `resolved`
  - inspect resolved-field rows by target, observation, field path, status, resolution kind, or resolver version
- `manual`
  - inspect manual override rows by target, field path, observation, source, or status
- `audit`
  - inspect audit-event rows by target, observation, source, actor, or event kind
- `validate-run`
  - compare stored collection summary counts against persisted observations/artifacts

Useful flags:
- `--source-key <key>`
- `--run-id <runId>`
- `--limit <n>`
- `--observation-id <obsId>`
- `--field-path <path>`
- `--source-surface <surface>`
- `--target-kind <kind>`
- `--target-id <id>`
- `--status <status>`
- `--resolution-kind <kind>`
- `--resolver-version <value>`
- `--full`
- `--data-dir <path>`

### Jobs inspection CLI

- inspect jobs:
  - `npm run inspect:jobs -- --status pending --limit 20`
- this surface supports filtering by status, source, run, observation, freshness, and specific job id

### Local operator UI

Launch:
- `npm run inspect:ui`
- optional bind overrides:
  - `npm run inspect:ui -- --host 127.0.0.1 --port 4310 --data-dir data`

Current shape:
- one local Node process
- built-in `node:http` server
- React dashboard as the primary surface at `/`
- legacy vanilla inspector at `/inspector`
- SQLite-backed JSON endpoints served by the same process

Current dashboard routes:
- `Listings`
  - primary listing search/detail surface
- `Posts`
  - source evidence and processing-status view
- `Review`
  - ambiguous/low-confidence/incomplete/pending/failed review queues
- `Debug`
  - run forensics and inspector handoff

Current dashboard behavior:
- route-specific filters for things like source, freshness, borough, neighborhood, price range, beds, baths, confidence, ambiguities, queue type, processing status, posted-within windows, sorting, and pagination
- detail panes load linked observations, jobs, variants, provenance, and layered field state
- Review supports the narrow manual-override write flow described above

Current inspector role:
- deep run/observation/job/listing/artifact forensics
- legacy fallback for data not yet ported into the React dashboard

For contributor-level UI structure, routing, and API shape, see:
- `src/ui/ARCHITECTURE.md`

## Active Paths On Disk

Key active paths:
- raw browser-origin DOM payloads:
  - `data/raw/facebook/<sourceKey>/<runId>/<post-key>.json`
- per-run collected post bundles:
  - `data/collected/facebook/<sourceKey>/capture-<runId>.json`
  - `data/collected/facebook/<sourceKey>/crawl-<runId>.json`
- canonical local database:
  - `data/storage/nyc-housing-scout.sqlite`
- ingest-loop runtime state:
  - `data/state/ingest-loop/<source-key>.json`
  - `data/state/ingest-loop/<source-key>.jsonl`
  - `data/state/ingest-loop/<source-key>.stop`

Current listing output lives in SQLite:
- `processed_payloads`
- `listing_records`

There is intentionally no active `data/processed/` tree.

For the fuller artifact/storage map, see:
- `data/README.md`

## Validation Surfaces

Useful validation commands:
- full test suite:
  - `npm test`
- inspect the local UI:
  - `npm run inspect:ui`
- validate a crawl run against stored observations/artifacts:
  - `npm run inspect:storage -- validate-run --run-id <runId>`
- validate queue coverage and process a real scope:
  - `npm run validate:queue -- --run-id <runId>`
- spot-check heuristic extraction:
  - `npm run extract:text -- <path-to-text-file>`
  - `npm run extract:html -- <path-to-html-file>`
- spot-check Gemini structured extraction:
  - `npm run gemini:extract -- --input <path>`

## See Also

- `README.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/LISTING_SCHEMA.md`
- `data/README.md`
- `src/ui/ARCHITECTURE.md`

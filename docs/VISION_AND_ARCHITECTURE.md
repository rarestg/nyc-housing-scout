# Vision and Architecture

## What We Are Building

`nyc-housing-scout` is a local-first pipeline for collecting housing posts from Facebook groups, storing them durably, extracting structured housing data, and serving that data through both local operator surfaces and a future hosted public frontend.

The goal is not just to scrape pages. The goal is to build a system that can:

- keep up with ongoing post volume across multiple groups
- run continuously on one always-on laptop with minimal operator intervention
- keep several authenticated group feeds healthy in parallel without cross-source confusion
- avoid reprocessing the same posts unnecessarily
- extract structured housing data reliably from messy free-form posts
- preserve enough provenance to debug or reprocess later
- stay simple, modular, and operable by one person on one machine

## Product Shape

The system should support a workflow like this:

1. keep one or more configured Facebook sources attached to healthy authenticated browser tabs
2. sweep those sources continuously and incrementally
3. persist raw observations and canonical post state locally
4. queue unprocessed posts for extraction
5. process posts into structured listing data
6. expose local operator views for inspection, review, and debugging
7. publish a curated hosted read model for a public-facing frontend

## Guiding Principles

### 1. Each pipeline stage should stand alone
Every major stage should be independently operable and testable.

Examples:
- scrape latest 5 posts from one source
- inspect newly collected posts
- enqueue unprocessed posts for extraction
- dry-run extraction on N queued posts
- store processed output without running the crawler

This means each stage should have its own CLI surface and clear input/output contract.

### 2. Local SQLite is the canonical write-side
Use local SQLite for operational state and queryable application data.

Use files on disk for:
- raw artifacts
- collected/listing exports
- debugging and replay

The local database should track the durable entities and workflow state; artifacts should remain inspectable outside the DB.

Hosted databases and public APIs should be treated as published read models, not as the primary collection-time source of truth.

### 3. Separate discovery from enrichment
Collection and extraction are different jobs.

- **Discovery / ingestion** should be fast, incremental, and dedupe-aware.
- **Extraction / enrichment** can be slower and more expensive, including LLM processing.

Do not entangle crawl logic with heavy extraction work.

### 4. Keep browser control explicit and replaceable
The collector runtime depends on a live authenticated browser session, but the rest of the pipeline should not depend on one specific browser-control vendor or opaque relay.

What matters architecturally is:
- explicit source identity
- explicit browser/tab ownership
- explicit target selection
- recoverable browser/session health

The browser bridge should be a narrow, swappable boundary.

### 5. Prefer robust boring workflows over fancy orchestration
We do not need Airflow, Temporal, or a distributed queue system.

We do want:
- explicit job state
- atomic claim semantics for workers
- retries
- replayability
- source-scoped crawl state
- source-scoped browser/tab leases
- good local inspection tools

### 6. Preserve provenance
For every processed listing, we should be able to answer:
- what source post did this come from?
- when was it seen?
- what raw text/media did we base this on?
- what extractor/model version produced it?
- what confidence/ambiguity came with it?

### 7. Separate local operator state from hosted public state
The local operator workflow and the hosted public product are related, but they are not the same surface.

The local system should retain:
- runs
- raw artifacts
- observations
- queue state
- debug and review detail

The hosted product should expose a curated public-safe read model shaped for listing search and detail views.

## Near-Term Delivery Boundary

The near-term shipping boundary is:

- local collection and canonical write-side state on one operator laptop
- central local queue and processing
- a hosted public read model derived from local canonical SQLite

The immediate engineering risks are now:

- crawl coverage and stopping policy
- Facebook identity correctness and duplicate reuse
- operator workflow clarity
- minimal reliability guardrails for crawl, queue, and publish health

Replacing the current browser-control dependency and promoting the full multi-source runtime remain part of the intended end state, but they are not the blocker for the first deploy slice.

## Current Architecture Direction

## Stage A — Source crawling / ingestion
Input:
- a configured Facebook source (group)
- an explicit browser context/tab lease for that source
- crawl policy (incremental / backfill / limits / stop conditions)

Output:
- canonical post records
- post observations
- raw artifact references
- crawl run / run step records

Primary concerns:
- source identity
- browser session / tab identity
- post identity
- latest-vs-seen detection
- efficient stopping rules
- source crawl state and overlap anchors
- source/tab health, recovery, and drift detection

The collector runtime should support multiple sources in parallel on one machine.

A source may be associated with one browser tab at a time, but the exact browser-control implementation is not the architectural center; explicit ownership and recoverability are.

## Stage B — Processing queue
Input:
- collected posts that have not been processed for the current processor/schema version

Output:
- queued processing jobs with claim/retry semantics

Primary concerns:
- atomic claiming
- avoiding double processing
- status tracking (`pending`, `processing`, `processed`, `failed`, `retryable`)
- versioned processor/model/schema execution

Multiple collectors should be able to publish into one central local queue without coupling crawl progress to extractor throughput.

## Stage C — Structured extraction
Input:
- canonical post text
- metadata
- optionally media/image inputs

Output:
- structured processed payload
- normalized listing rows
- confidence + ambiguity metadata

Primary concerns:
- schema stability
- provenance
- testability
- ability to reprocess later

### Extraction strategy
Use two layers:
1. heuristic extraction
2. LLM structured extraction

The LLM stage should be core to the design, not an afterthought.

Gemini structured output is a good fit for this, especially with strict JSON schema and local validation.

## Stage D — Operator query / review layer
The local database should already be shaped for operator queries and for the fields that will later power hosted listing search.

Important filterable fields include:
- source/group
- borough
- neighborhood
- price
- bedrooms / rooms available
- listing type
- offering vs wanted intent
- furnished / pets / laundry
- availability dates
- freshness / confidence

This stage is about local inspection, review, and operational visibility.

## Stage E — Published read model / hosted frontend
The system should be able to derive a curated hosted read model from the canonical local store.

That published model should:
- contain the fields needed for public listing search and detail pages
- exclude operator-only and raw forensic state by default
- be safe to sync incrementally
- support a hosted frontend without coupling that frontend to the local operator database

## Recommended Core Data Model

### Sources
One row per tracked Facebook group/source.

### Stable posts
Canonical post identity across observations.

### Post observations
Each time a post is encountered during a crawl.

### Crawl runs / crawl run steps
Operational records for what happened during a run.

### Artifact references
Paths + hashes + metadata for raw artifacts and exports.

### Browser runtime / source leases
Runtime ownership records that map sources to active browser contexts/tabs with heartbeat and recovery metadata.

### Processing jobs
Queue state for extraction/enrichment work.

### Processed payloads
Structured extractor/LLM outputs with versioned provenance.

### Listing records
Frontend-facing normalized housing records.

### Published public records
Curated public-facing listing/source rows derived from the canonical local store.

### Publish / sync state
State that tracks what has already been published to a hosted read model.

### Evidence fragments
Observation-scoped field clues layered above raw observations and processed payloads.

### Resolved fields
Current system-produced field values keyed by target kind/id and field path.

### Manual overrides
Current durable operator-authored field values without mutating raw listing rows.

### Audit events
Append-only history for enrichment, resolution, and override actions.

### Effective value rule
For any field, reads should prefer:
1. active manual override
2. accepted resolved field
3. raw extracted listing value
4. raw observation-derived fallback

`post_observations`, `processed_payloads`, and `listing_records` remain forensic and immutable.

## Crawl Strategy Direction

The crawler should not be one generic infinite scroll loop.

It should support at least two modes:
- **incremental latest sweep**
- **backfill**

Recommended stopping logic for incremental mode:
- start from top of source feed sorted by newest
- stop after a configurable stale threshold (for example 10 seen in a row)
- use overlap anchors from prior runs to detect already-covered territory
- only enter deeper backfill mode when needed

## Scaling Outlook

The likely target is not “scrape 20k in one pass.”
It is more like:
- ~200 posts/day per source
- ~5 sources
- ~1000 posts/day total

That is very manageable if we keep the architecture disciplined:
- fast incremental discovery
- stable multi-source browser runtime
- source-scoped state
- async processing queue
- selective LLM enrichment
- strong dedupe and replayability
- one-way publication of a hosted read model

The scaling risk is not SQLite.
The scaling risk is crawl/orchestration policy and browser runtime behavior.

## What We Explicitly Want To Avoid

- giant workflow/orchestration systems
- mixing scrape logic with heavy extraction logic
- treating raw JSON exports as the source of truth
- tightly coupling the frontend to scrape-time artifacts
- tightly coupling the local collector to one opaque browser-control dependency
- overbuilding for remote/distributed scale before the local pipeline is excellent

## Working Practices

The repo has moved fastest when we keep the implementation process as disciplined as the architecture.

- Keep delegation narrow.
  Use a named pass, an explicit reading list, a bounded scope, and a concrete validation requirement.
- Require real-data validation on live paths.
  For crawl, queue, review, and UI behavior, tests alone are not enough when the surface depends on real stored observations or real browser/runtime state.
- Prefer explainers before broad implementation in fast-moving areas.
  A read-only review pass often sharpens the actual work and prevents low-signal edits.
- Promote durable guidance into the canonical docs.
  Temporary planning bundles and handoff notes are fine, but the stable rules should end up here, in `ROADMAP.md`, or in `PIPELINE.md`.

## Definition of “Good” For This Project

A good version of this system lets us do things like:
- `collect latest 5 posts from source X`
- `run continuous ingest across 5 sources without source/tab collisions`
- `inspect newly collected posts`
- `enqueue all unprocessed posts`
- `dry-run structured extraction on 3 posts`
- `process pending jobs`
- `query listings filtered by borough/price/bedrooms`
- `publish the public read model for the hosted frontend`

Each of those should be a clean, composable step.

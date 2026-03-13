# Vision and Architecture

## What We Are Building

`nyc-housing-scout` is a local-first pipeline for collecting housing posts from Facebook groups, storing them durably, extracting structured housing data, and serving that data to a frontend for filtering, review, and eventually mapping.

The goal is not just to scrape pages. The goal is to build a system that can:

- keep up with ongoing post volume across multiple groups
- avoid reprocessing the same posts unnecessarily
- extract structured housing data reliably from messy free-form posts
- preserve enough provenance to debug or reprocess later
- stay simple, modular, and operable by one person on one machine

## Product Shape

The system should support a workflow like this:

1. scrape the latest posts from a configured Facebook group
2. persist raw observations and canonical post state
3. queue unprocessed posts for extraction
4. process posts into structured listing data
5. expose listings and source posts to a frontend for filtering/review

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

### 2. SQLite is the system of record
Use SQLite for operational state and queryable application data.

Use files on disk for:
- raw artifacts
- collected/listing exports
- debugging and replay

The database should track the durable entities and workflow state; artifacts should remain inspectable outside the DB.

### 3. Separate discovery from enrichment
Collection and extraction are different jobs.

- **Discovery / ingestion** should be fast, incremental, and dedupe-aware.
- **Extraction / enrichment** can be slower and more expensive, including LLM processing.

Do not entangle crawl logic with heavy extraction work.

### 4. Prefer robust boring workflows over fancy orchestration
We do not need Airflow, Temporal, or a distributed queue system.

We do want:
- explicit job state
- atomic claim semantics for workers
- retries
- replayability
- source-scoped crawl state
- good local inspection tools

### 5. Preserve provenance
For every processed listing, we should be able to answer:
- what source post did this come from?
- when was it seen?
- what raw text/media did we base this on?
- what extractor/model version produced it?
- what confidence/ambiguity came with it?

## Current Architecture Direction

## Stage A — Source crawling / ingestion
Input:
- a configured Facebook source (group)
- crawl policy (incremental / backfill / limits / stop conditions)

Output:
- canonical post records
- post observations
- raw artifact references
- crawl run / run step records

Primary concerns:
- source identity
- post identity
- latest-vs-seen detection
- efficient stopping rules
- source crawl state and overlap anchors

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

## Stage D — Frontend/query layer
The database should already be shaped for frontend filters.

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

### Processing jobs
Queue state for extraction/enrichment work.

### Processed payloads
Structured extractor/LLM outputs with versioned provenance.

### Listing records
Frontend-facing normalized housing records.

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
- source-scoped state
- async processing queue
- selective LLM enrichment
- strong dedupe and replayability

The scaling risk is not SQLite.
The scaling risk is crawl/orchestration policy and browser runtime behavior.

## What We Explicitly Want To Avoid

- giant workflow/orchestration systems
- mixing scrape logic with heavy extraction logic
- treating raw JSON exports as the source of truth
- tightly coupling the frontend to scrape-time artifacts
- overbuilding for remote/distributed scale before the local pipeline is excellent

## Definition of “Good” For This Project

A good version of this system lets us do things like:
- `collect latest 5 posts from source X`
- `inspect newly collected posts`
- `enqueue all unprocessed posts`
- `dry-run structured extraction on 3 posts`
- `process pending jobs`
- `query listings filtered by borough/price/bedrooms`

Each of those should be a clean, composable step.

# Scale Architecture Review — 2026-03-12

## Scope

This review is based on the current repository implementation and docs, with emphasis on:

- `src/core/browser-pipeline.js`
- `src/browser/dom-extractor.js`
- `src/browser/dom-helpers.js`
- `src/cli/capture-dom-feed.js`
- `src/cli/crawl-dom-latest.js`
- `src/storage/sqlite-storage.js`
- `src/storage/migrations/0001_init.sql`
- `docs/PIPELINE.md`
- `docs/LIVE_BROWSE_2026-03-12.md`

I also checked the current local runtime state:

- `npm test` passes (`26/26`)
- current SQLite state shows `1` source, `8` runs, `108` observations, `36` stable posts, `37` listing rows
- current sample artifact footprint is small:
  - `data/raw`: `724K` across `143` files
  - `data/collected`: `328K`
  - `data/listings`: `112K`
  - `data/storage`: `896K`

## Executive Summary

`nyc-housing-scout` can grow to a corpus of 20k posts on the current local storage model. It cannot grow to *reliably collecting* 20k posts on the current browser/orchestration model.

The important distinction is:

- `SQLite + disk artifacts + canonical collected-post shape` are fundamentally fine.
- `Attached Chrome tab + synchronous browser CLI + implicit current page/tab` are not fine for true scale.

My opinionated conclusion:

- Do **not** redesign storage first.
- Do **not** jump to Postgres, queues, or distributed infrastructure.
- Do **redesign the collector runtime** around explicit source jobs, browser worker ownership, and source-level crawl state.

If the goal is "20k posts in the corpus on one machine", a realistic path is:

1. keep SQLite as the source of truth
2. keep raw artifacts on disk
3. split collection into `discovery` and `detail` work
4. run a small browser worker pool with explicit profile/session ownership
5. stop treating "the attached tab" as the system boundary

## Current Architecture, As Implemented

The current collector is already materially better than a prototype:

- DOM extraction is the primary path, not terminal snapshot parsing (`src/cli/capture-dom-feed.js:1-148`, `src/cli/crawl-dom-latest.js:1-223`)
- collected posts, listings, runs, run steps, stable posts, and artifact refs are persisted in SQLite (`src/storage/migrations/0001_init.sql:6-165`)
- SQLite is configured sanely for local write-heavy usage with WAL and foreign keys (`src/storage/sqlite-storage.js:973-978`)
- stable post identity is source-scoped on `(source_id, platform_post_id)` (`src/storage/migrations/0001_init.sql:40-52`)
- listing extraction only runs for fresh posts in the DOM crawl path (`src/cli/crawl-dom-latest.js:100-140`)

That is enough foundation to support a much larger corpus.

The current runtime shape is still narrow:

- browser commands are synchronous `execFileSync(...)` calls to `openclaw browser ...` (`src/core/browser-pipeline.js:4-18`)
- browser operations are addressed only by `--browser-profile`, not by explicit tab/session handle (`src/core/browser-pipeline.js:16-18`)
- the DOM helpers and extractor operate against the current page's `location.href`, `location.pathname`, and scroll state (`src/browser/dom-helpers.js:18-35`, `src/browser/dom-extractor.js:44-50`, `src/browser/dom-extractor.js:418-423`)
- the main crawl loop is a single sequential loop with hard-coded waits and page scroll (`src/cli/crawl-dom-latest.js:54-180`)
- source registration still defaults to `facebook-default` unless the operator passes flags (`src/storage/source-config.js:1-8`)

That is why this works as a local assisted crawler and not yet as collection infrastructure.

## Bottom Line By Area

### What Can Stay As-Is

- **SQLite as primary state.** 20k posts is trivial for SQLite. The current schema is already in the right family.
- **Raw artifacts on disk.** Immutable JSON artifacts are still the correct debugging and replay surface.
- **The `CollectedPost -> Listing` pipeline shape.** The separation between collected post observations and extracted listing rows is correct.
- **Source-scoped stable identity.** `stable_posts` keyed by `(source_id, platform_post_id)` is a good base for incremental collection.
- **Run-step persistence.** `crawl_run_steps` is the right place to keep operational breadcrumbs.
- **DOM-based extraction.** Continuing to invest in DOM extraction is the right choice. Do not spend more serious effort on the legacy snapshot path.

### What Should Be Refactored Soon

- **Make source metadata mandatory, not optional.**
  - `sourceKey`, `externalUrl`, and a human display name should be required for real collection.
  - The current `facebook-default` default is fine for experiments and wrong for multi-source operation.
- **Batch persistence in the crawl path.**
  - `capture:dom` already batches observations.
  - `crawl:dom` currently calls `recordObservationBatch(...)` one post at a time (`src/cli/crawl-dom-latest.js:83-97`), which is unnecessary overhead at larger scale.
- **Add source-level crawl state.**
  - The repo has `sources`, `runs`, and `stable_posts`, but not an explicit "what should I crawl next and from where?" record.
- **Make raw artifact policy more selective.**
  - Right now a seen post still writes a raw artifact if it is newly encountered within the run (`src/cli/crawl-dom-latest.js:78-97`).
  - At scale, raw artifacts for unchanged seen posts should become policy-driven, not automatic.
- **Make debug payload size configurable.**
  - The DOM extractor returns `debugMetadata` for every record (`src/browser/dom-extractor.js:578-593`).
  - That is useful now and should become sampled or error-only later.
- **Add more scheduler-facing indexes.**
  - Current indexes are enough for inspection, not yet ideal for prioritization and larger browsing workloads.

### What Must Be Redesigned Before True Scale

- **The attached-browser execution model.**
  - The repo assumes a live attached Chrome profile and effectively the active/current page.
- **The active-tab assumption.**
  - There is no explicit tab identity in the current code path.
- **The single-loop feed crawler as the orchestration model.**
  - One process, one profile, one current page, one scroll loop is not enough.
- **Manual page-state preparation.**
  - Today the operator is still responsible for having the right group page open and in the right sort state.
- **Failure recovery semantics.**
  - A crashed process leaves a partial run, but there is no heartbeat/lease model for workers.

## The Real Scaling Constraint

The hard part of 20k is not "can SQLite hold 20k rows?" It obviously can.

The hard part is:

- keeping one or more Facebook-authenticated browser sessions healthy
- navigating many sources reliably
- collecting incrementally without rescanning the same feed slices forever
- recovering from DOM drift, scroll stalls, profile problems, and process failure
- doing that without the crawler confusing one group/page context for another

The browser layer is the scarce resource. The database is not.

## Browser Control Analysis

### How The Scraper Currently Connects To Chrome

The browser boundary is currently:

- `openclaw browser ...` invoked synchronously from Node (`src/core/browser-pipeline.js:4-18`)
- selection by `--browser-profile` only (`src/core/browser-pipeline.js:16-18`)
- no explicit tab id, page id, or browser-session lease in the repo

Operationally, that means the crawler is bound to "whatever page OpenClaw will evaluate for this attached profile right now."

That is reinforced by the DOM helper layer:

- page state is read from `location.href`, `document.title`, and `window.scrollY` (`src/browser/dom-helpers.js:29-35`)
- permalink recovery can reconstruct URLs from the current page's group pathname (`src/browser/dom-extractor.js:418-423`)

That last point matters: the extractor is not only reading post cards. It is also using current page context to infer canonical group post URLs.

### What This Implies

- The current crawler is effectively **single-active-page**.
- It assumes the active page already belongs to the intended source.
- It assumes the page is already in the right sort/view state.
- It assumes no other automation or human activity is mutating that attached browser context during the run.

That is acceptable for local assisted collection of 20 posts.
It is not an acceptable assumption boundary for 20k-post collection.

### Can It Operate Across Multiple Tabs / Groups Today?

Not reliably as implemented.

The repo has no architecture for:

- enumerating tabs
- selecting a specific tab for a job
- persisting which tab belongs to which source
- proving that the active tab still matches the source the run thinks it is collecting
- leasing a tab so two jobs do not interfere with the same browser context

So the honest answer is:

- **multiple tabs can exist**
- **multiple tabs cannot currently be treated as safe crawl workers**

At best, tabs are currently a manual convenience.

### Is One-Group-Per-Tab A Good Idea?

Not as the main scaling architecture.

My recommendation is:

- **No** for "this is how we scale the system."
- **Maybe** for "this is a short-term operator convenience while the system is still human-assisted."

Why I do not recommend one-group-per-tab as the core design:

- the current control surface is profile-scoped, not tab-scoped
- wrong-tab execution would silently contaminate source/run data
- the extractor uses current group page context for URL reconstruction
- Facebook tabs are heavy; dozens of open group tabs are memory-expensive and unstable
- tab-local UI state like sort mode can drift
- one browser crash takes out many staged jobs at once

If explicit tab targeting later becomes available, tabs should be treated as an optimization inside a browser worker, not as the first-class unit of orchestration.

### What Multi-Tab Would Need Architecturally

To make one-group-per-tab safe, the system would need at minimum:

- a browser session registry
- explicit tab handles stored in state
- a mapping of `tab -> source_id`
- tab lease / ownership semantics so only one worker controls a tab at a time
- preflight checks on every job:
  - current URL matches expected source URL
  - expected sort mode is active
  - authentication state is valid
- recovery logic for closed tabs, stale tabs, and navigation drift

That is a real subsystem. The current repo does not have it.

## Concrete Assessment Of Scale Readiness

### What Already Scales Well Enough

- **Corpus size in storage.**
  - 20k stable posts and their observations are well within current SQLite territory.
- **Artifact layout.**
  - `raw`, `collected`, `listings`, and DB refs are conceptually fine.
- **Source/run/observation/listing separation.**
  - The system already has the right basic entities.

### What Becomes Inefficient Around 20k

- **Per-post transactions in `crawl:dom`.**
  - Fine at tens of posts, noisy at thousands.
- **Always-on debug metadata in raw payloads.**
  - Useful for collector tuning, wasteful at long-running scale.
- **Per-run full JSON exports.**
  - Still useful, but should stop being mandatory for every larger run.
- **Re-observing seen posts with full raw artifact persistence.**
  - The DB history is useful. Rewriting full raw payloads for unchanged seen posts is less useful.

### What Breaks Conceptually Before 20k

- **Implicit active-tab ownership**
- **single attached profile as the collector runtime**
- **manual source preparation**
- **lack of scheduler state**
- **lack of worker heartbeat / stale-run recovery**

## Recommended Target Architecture

This is the architecture I would actually build next. It is intentionally local-first and not overbuilt.

### 1. Keep SQLite And File Artifacts

Keep the current storage direction.

Do not move to Postgres yet.

Extend SQLite with a small number of tables/fields for orchestration:

- `source_crawl_state`
  - `source_id`
  - `last_started_at`
  - `last_succeeded_at`
  - `last_failed_at`
  - `failure_count`
  - `next_eligible_at`
  - `priority`
  - `crawl_mode` (`incremental`, `backfill`, `paused`)
  - `checkpoint_json`
- `browser_workers` or `worker_leases`
  - `worker_id`
  - `browser_profile`
  - `status`
  - `leased_source_id`
  - `heartbeat_at`
- optionally add hashes on observations:
  - `body_hash`
  - `payload_hash`

Also add indexes for:

- recent observations by source and time
- stable posts by `last_seen_at`
- sources by `next_eligible_at`
- listings by common filter fields

### 2. Introduce A Scheduler, Not A Bigger CLI

Stop using ad hoc CLI runs as the orchestration model.

Add one local scheduler process that:

- selects eligible sources
- chooses `incremental` vs `backfill`
- assigns a source job to an available browser worker
- records lease/heartbeat state
- marks stale jobs/runs as failed or recoverable

The scheduler can still live in this repo and still be single-machine.

### 3. Promote Browser Workers To First-Class Infrastructure

Use a small pool of browser workers, each with exclusive control of one browser profile/session.

My recommendation:

- start with `1-2` workers
- grow to `3-4` only if profile health is good
- keep one active feed crawl per worker
- optionally allow a second detail/permalink tab **inside** a worker later

The important abstraction is:

- `worker owns browser session`
- `job owns source`
- `source job owns navigation state for the duration of the job`

Not:

- `every tab is a worker`

### 4. Split Discovery From Detail Capture

The current system mixes "find posts in the feed" and "extract listing-ready body text" inside one loop. At scale, that should be split logically:

- **Discovery crawler**
  - navigates group feed
  - verifies sort is correct
  - expands visible cards
  - extracts lightweight collected posts
  - records stable identity and observations
  - decides what needs more detail
- **Detail fetcher**
  - opens the permalink or detail view for selected posts
  - used only when needed:
    - post is truncated
    - id/url is missing
    - body changed materially
    - post is high-value or ambiguous

This keeps feed crawling fast and makes expensive page-detail work selective.

### 5. Separate Incremental Crawls From Backfills

This is critical.

The system should not use the same job shape for:

- "give me the newest 20-50 fresh posts from this group"
- "walk historical inventory until we have 20k corpus coverage"

Use two modes:

- **Incremental**
  - frequent
  - shallow scroll budget
  - stop after enough fresh posts or after `N` no-progress steps
- **Backfill**
  - infrequent
  - lower priority
  - deeper scroll/permalink budget
  - resumable from source checkpoint

The checkpoint should be source-level logical state, not `scrollY`.

`scrollY` is a debug metric. It is not a durable crawl cursor.

### 6. Make Source State Explicit

Today a source is mostly registry metadata plus run history. That is not enough.

A source record should eventually carry or be joined to:

- canonical feed URL
- source type
- display name
- expected browser profile
- active/paused flag
- crawl priority
- last successful incremental crawl time
- last successful backfill time
- failure streak
- expected sort mode
- checkpoint/cursor state

Without that, multi-source scheduling turns into guesswork.

## Scheduling And Crawl Orchestration Recommendations

### Scheduling

- prioritize sources by `next_eligible_at`, freshness velocity, and failure state
- run short incremental crawls frequently instead of long monolithic runs
- run backfills opportunistically when workers are idle
- keep source concurrency conservative:
  - at most one active job per source
  - at most one active feed crawl per browser worker

### Crawl Slice Design

A single source job should have bounded budgets:

- `targetFresh`
- `maxScrolls`
- `maxRuntimeSeconds`
- `detailBudget`

This keeps jobs preemptable and easier to retry.

### Stop Conditions

Incremental crawl should stop when any of these are true:

- target fresh posts reached
- no scroll progress for `N` steps
- no new stable identities for `N` steps
- oldest visible post is already older than the incremental freshness window
- runtime budget exceeded

### Failure Recovery

Add worker heartbeats and stale-run recovery:

- `crawl_runs` should have heartbeat or lease metadata
- if a worker dies, the run is marked `failed` or `abandoned`
- the source returns to the scheduler after backoff
- partial observations already committed remain valid

This is especially important because raw files are written before or alongside DB refs. Orphan raw files are acceptable. Orphaned job state is not.

## State Management And Data Model Implications

### Keep These Core Tables

- `sources`
- `crawl_runs`
- `crawl_run_steps`
- `stable_posts`
- `post_observations`
- `listing_records`
- `artifact_refs`

These are the right backbone.

### Add These Fields / Concepts

- source crawl state / scheduling metadata
- worker lease / heartbeat state
- observation hashes for change detection
- policy flags for whether raw artifact capture was full, sampled, or skipped
- optional "needs detail fetch" signal on an observation or stable post

### What To Avoid Right Now

- cross-source dedupe as a prerequisite for scale
- over-normalizing every listing subfield into child tables
- moving raw artifacts into the DB
- distributed queues/services
- Postgres migration

None of those are required to make this system handle 20k posts.

## Throughput, Rate, And Operational Risk

### Throughput

Current local evidence already shows the real constraint:

- a recent crawl took about `82s` to collect roughly `29-33` observed cards and `12-19` fresh ones

That is acceptable for "latest 20" collection.
It is not an efficient shape for large backfills.

The scaling move is not "make SQLite faster."
The scaling move is "do fewer expensive browser actions per useful post."

That means:

- batch visible-card processing
- separate discovery from detail fetch
- stop persisting full raw artifacts for unchanged seen posts
- stop treating a single long scroll session as the whole system

### Rate / Platform Risk

The biggest operational risk is not CPU or disk. It is Facebook account/session durability.

The current model uses an attached logged-in browser profile. At larger unattended scale, expect:

- auth expiration
- checkpoint/challenge risk
- transient DOM changes
- unpredictable feed/sort behavior

Realistic mitigation:

- keep concurrency conservative per profile
- use a small profile pool only if necessary
- add health checks before each job
- make runs resumable
- prefer more frequent shallow incremental crawls over huge continuous sessions

### Disk And Retention

Disk is not the first blocker, but retention policy still matters.

At the current sample size, raw artifacts are small. The bigger issue is duplication:

- raw artifact per observation
- DB payload JSON per observation
- per-run collected export
- per-run listings export

At 20k posts this is still manageable on one machine, but it becomes sloppy unless the system decides:

- which raw artifacts are always kept
- which are sampled
- which are only kept on fresh/changed/error cases
- whether run exports are compressed or optional

## Concrete Recommendations

### Keep

- SQLite + WAL
- source/run/observation/listing schema shape
- immutable raw artifacts on disk
- DOM-first extraction
- extraction only on fresh posts

### Refactor Soon

- require `sourceKey`, `source URL`, and display name for real collection jobs
- add `source_crawl_state`
- add worker lease / heartbeat state
- batch writes in `crawl:dom`
- add hashes for content-change detection
- make debug/raw artifact capture policy-driven
- add scheduling/filtering indexes
- make per-run exports optional or compressed for larger runs

### Redesign Before True Scale

- the attached active-tab browser model
- the assumption that `browser profile == collector context`
- the manual source/tab preparation model
- the single sequential scroll loop as the top-level orchestration design

## Opinionated Answer On Multi-Tab Scraping

If the question is:

> Can this scraper scale by opening multiple Facebook groups in multiple tabs and scraping one group per tab?

My answer is:

- **Not with the current implementation**
- **Not as the primary architecture even after modest refactoring**

The better architecture is:

- one browser worker per browser session/profile
- one active source job per worker
- optionally one feed tab plus one detail tab inside that worker

If later tooling exposes strong tab addressing, then one-group-per-tab can become a controlled optimization. It should not be the foundational design decision.

## Final Verdict

The repository is already past the "toy parser" stage. The storage model and data contracts are good enough to grow.

The blocker to 20k is the collector runtime:

- implicit active-tab execution
- lack of source scheduling state
- lack of browser-worker ownership
- lack of incremental vs backfill separation

If I were prioritizing the next architecture pass, I would do this in order:

1. formalize source crawl state and worker leases in SQLite
2. move browser control behind explicit worker/session ownership
3. batch crawl writes and add change-detection hashes
4. split discovery crawls from detail fetches
5. only then consider controlled multi-worker concurrency

That path is realistic, local-first, and enough to move this repo from "collect the latest 20 from an attached tab" to "maintain and grow a 20k-post corpus without pretending the browser is not the real bottleneck."

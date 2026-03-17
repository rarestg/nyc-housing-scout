# Ship Plan

Definitive plan for getting `nyc-housing-scout` from the current local operator pipeline to a shipped product.

Use this doc to:

- align work across collection, processing, publication, and frontend
- sequence major milestones without dropping into implementation minutiae
- benchmark progress against the actual shipped end state

Use other docs for adjacent concerns:

- `docs/VISION_AND_ARCHITECTURE.md` for the durable architectural principles
- `docs/ROADMAP.md` for short-form status
- `docs/PIPELINE.md` for the current command surface and operational behavior
- `docs/LISTING_SCHEMA.md` for the normalized listing contract
- `docs/reviews/2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md` for the detailed Cloudflare assessment

## Product Definition

The product is shipped when it can do all of the following reliably:

1. keep multiple Facebook housing groups attached to healthy browser tabs on one always-on laptop
2. collect new posts continuously without source/tab collisions
3. persist canonical local observations, artifacts, queue state, payloads, and listings in SQLite
4. process observations into normalized listing data through the central downstream pipeline
5. publish a curated public read model from local canonical state to the cloud
6. serve a public-facing Cloudflare frontend from that published read model
7. preserve a private local operator workflow for inspection, review, and debugging

This is not a “deploy the current local UI” plan. It is a “ship the actual product” plan.

## Locked Decisions

These decisions are no longer provisional:

- The laptop remains the canonical write-side for collection, raw artifacts, queue state, and operator state.
- SQLite remains the system of record locally.
- The browser-control dependency on OpenClaw should be replaced, not entrenched.
- The replacement browser bridge should be a thin repo-owned MV3 extension plus a localhost relay.
- One signed-in Chrome session with one group tab per source is the intended operator layout.
- Source-to-tab ownership must be explicit.
- The preferred runtime topology is one collector manager process that manages `N` source-scoped tab lanes, not `N` unrelated collector processes competing over one browser session.
- Collection and heavy processing remain separate stages.
- A central local queue/process path remains the extraction boundary.
- Cloudflare is the intended hosted read-side.
- D1 is the first cloud database target for the public read model.
- The public frontend is a separate hosted surface, not the current operator/debug UI deployed unchanged.

## End-State Architecture

```text
Signed-in Chrome + MV3 bridge
  -> one logical collector lane per source/tab
  -> shared local SQLite + raw artifacts
  -> central local processing queue/workers
  -> curated public read-model publisher
  -> Cloudflare D1
  -> Cloudflare Worker + Static Assets public frontend

Local-only surfaces:
  - raw artifacts
  - crawl runs / run steps
  - queue internals
  - debug / review detail

Public cloud surfaces:
  - listing search
  - listing detail
  - public-safe source metadata
```

## Collector Process Topology

Preferred current shape:

- one signed-in Chrome session
- one group tab per source
- one collector manager process
- one logical collector lane per source/tab inside that manager
- separate central queue/process workers downstream

This is intentionally not:

- one unrelated collector OS process per tab, each competing for the same browser session

### Why this is the preferred shape right now

- The browser bridge naturally wants one place that owns tab discovery, attach/detach, target tracking, and relay health.
- Explicit source-to-tab leases are easier to enforce when one runtime owns the browser session.
- Recovery is simpler when tab drift, login drift, and relay reconnect logic are coordinated in one place.
- A single manager reduces the risk of collector calls accidentally colliding on the same browser session or active tab.
- Shared local SQLite plus a separate central processing worker pool already gives us the right stage split without multiplying browser owners.

### Tradeoffs

Benefits:

- cleaner source ownership model
- simpler browser-session coordination
- easier central health visibility
- less contention around browser control and runtime state

Costs:

- the collector manager becomes a stronger single failure domain
- per-source fault isolation is weaker than with fully separate processes
- the manager needs internal scheduling and lane isolation discipline

### When we should revisit this decision

We should reconsider a more isolated per-source process model if:

- one bad source or wedged tab can too easily destabilize the whole manager
- per-source restart/isolation needs become operationally dominant
- the browser bridge or runtime model proves materially simpler with true process isolation

Until that happens, the manager-plus-lanes model is the better fit for a single-user, single-browser-session system.

## Major Workstreams

### 1. Multi-Source Collector Runtime

Goal:
- turn the current single-attached-tab collector into a safe multi-source runtime

Required capabilities:
- first-class source metadata
- explicit source-to-tab targeting
- source/tab leases with heartbeat and recovery metadata
- one logical collector lane per source
- clean restart/recovery without duplicate ownership

Completion gate:
- the system can run multiple sources continuously on one machine without source collisions or active-tab ambiguity

### 2. MV3 Browser Bridge

Goal:
- replace the OpenClaw dependency with a thin repo-owned Chrome bridge

Required capabilities:
- tab discovery via `chrome.tabs`
- explicit tab attach/detach and target tracking via `chrome.debugger`
- raw CDP command/event forwarding for evaluate, navigate, lifecycle waits, and network capture
- persisted `tabId` / `targetId` / session state across MV3 worker restarts
- loopback-only local relay surface

Guardrails:
- no “first active tab” fallback for collector calls
- prefer loopback relay over native messaging unless loopback proves insufficient
- keep the extension thin; browser semantics stay in repo code, not in extension-specific abstractions

Completion gate:
- the active collection path can run without any OpenClaw dependency while preserving the current DOM + CDP-assisted capabilities

### 3. Crawl Policy And Runtime Hardening

Goal:
- make continuous collection trustworthy instead of merely functional

Required capabilities:
- deterministic source preflight
- top-of-feed reset
- incremental latest sweep vs backfill split
- overlap-anchor stop rules
- stale-zone stopping policy
- source-scoped health and recovery signals
- usable runtime metrics for freshness, coverage, and crawl drift

Completion gate:
- the collector can stay up for long-running sessions and recover cleanly from tab drift, navigation drift, and transient browser failures

### 4. Central Queue And Processing

Goal:
- keep collection fast and make downstream processing the only listing-production boundary

Required capabilities:
- collectors persist observations and enqueue work
- central workers claim and process jobs atomically
- concurrent writer behavior remains stable under always-on multi-source ingest
- reprocessing stays versioned and provenance-preserving

Completion gate:
- collection throughput and extraction throughput are operationally independent

### 5. Public Read Model Publication

Goal:
- publish only the cloud-safe subset of the local canonical store

Required capabilities:
- explicit public contract for listings and sources
- explicit redaction boundary
- incremental publication from local SQLite to D1
- idempotent sync state and retry behavior
- clear handling for updates, removals, and listing visibility changes

The public read model should include:
- listing search fields
- listing detail fields
- public-safe source metadata
- stable identifiers and timestamps needed for incremental sync

The public read model should not include by default:
- raw artifacts
- queue internals
- run/debug detail
- operator comments or audit internals
- local file paths

Completion gate:
- public D1 data can be regenerated from local canonical state and updated incrementally without cloning the entire operator database

### 6. Cloudflare Public Frontend

Goal:
- ship a public listings product, not a hosted copy of the operator console

Required capabilities:
- Cloudflare Worker + Static Assets deployment
- small read-only API over D1
- public listing search and detail views
- redacted, product-shaped routes only
- staging and production environments

Public scope:
- listings index
- filters and sorting
- listing detail
- source attribution where safe

Out of scope for first launch:
- public debug views
- public review/editorial surfaces
- raw payload inspection
- operator-only audit or override history

Completion gate:
- the public app is fast, read-only, and sourced entirely from the published D1 model

### 7. Launch Operations And Reliability

Goal:
- make the product operable as a real always-on system

Required capabilities:
- startup/restart procedures for the laptop collector
- basic health visibility for sources, tabs, queue lag, and publish lag
- failure playbooks for browser disconnects, login drift, D1 publish failures, and queue backlogs
- privacy review of what is public vs local-only
- backup/restore posture for local SQLite

Completion gate:
- the system has an operator workflow for normal restarts, incident recovery, and public-data verification

## Milestone Sequence

The work should land in this order.

For PM planning purposes, the current roadmap item `multi-source collector runtime / ingest hardening` spans the first part of this ship sequence, especially Milestones 1 through 3 below. The roadmap is using a broader near-term milestone label, not a competing sequencing model.

### Milestone 1: Own The Browser Boundary

Deliver:
- source runtime model
- explicit source/tab targeting
- MV3 bridge skeleton
- relay protocol

Exit when:
- one source can crawl end to end through the new bridge
- the bridge exposes the primitives needed to replace OpenClaw

### Milestone 2: Prove Parallel Local Collection

Deliver:
- multi-source leases
- one logical collector lane per source
- preflight/reset/recovery behavior
- central enqueue-first collection loop behavior

Exit when:
- multiple sources can run in parallel on one signed-in browser session
- local SQLite remains healthy under continuous ingest

### Milestone 3: Harden Downstream Processing

Deliver:
- central processing worker shape
- concurrent writer hardening
- extraction-quality review pass against real outputs

Exit when:
- collection stays fast even when processing slows
- listing production remains downstream-only and replayable

### Milestone 4: Publish The Public Read Model

Deliver:
- public schema
- local-to-D1 publisher
- sync state and backfill strategy
- redaction rules

Exit when:
- new local listings can appear in D1 incrementally
- public rows can be rebuilt from local state

### Milestone 5: Ship The Cloudflare Frontend

Deliver:
- Worker + Static Assets app
- D1-backed read API
- public listing search/detail views
- staging/prod deployment path

Exit when:
- the hosted app reads only from D1
- operator-only state is not exposed publicly

### Milestone 6: Launch Readiness

Deliver:
- soak validation
- failure playbooks
- privacy boundary review
- operator handoff/runbook

Exit when:
- the system can stay up, recover, and publish reliably enough to trust with daily unattended operation

## Benchmark Criteria

Use these to judge whether the plan is actually working.

### Local collection

- supports an initial production target of `2-4` Facebook groups in parallel before expanding further
- each source has explicit ownership of one tab
- no collector call depends on whichever tab happens to be active

### Data pipeline

- new observations flow into the queue without blocking collection
- processed listings remain traceable back to observations and source posts
- reprocessing remains possible without mutating forensic raw rows

### Publication

- public rows are incremental, idempotent, and rebuildable
- publish lag is measured and visible
- the public database is clearly a read model, not the canonical operator store

### Public product

- only public-safe fields are exposed
- the hosted app does not depend on the laptop being directly queryable by users
- the public frontend remains usable even if local operator/debug surfaces change

### Operations

- the collector can recover from browser restarts and transient disconnects
- the operator can tell which source is unhealthy and why
- there is a clear manual path to pause, recover, and resume publication

## What We Are Explicitly Not Doing

- using D1 as the primary ingest/write store first
- coupling public reads directly to the local operator database
- shipping the current operator dashboard as the public product
- overbuilding a distributed orchestration stack for a single-user local tool
- hiding the browser boundary inside a large custom abstraction before the required primitives are stable

## Immediate Next Planning Outputs

This doc should drive the next concrete specs:

1. MV3 browser bridge design
2. source/tab lease and runtime-state design
3. public read-model schema
4. local-to-D1 publisher design
5. Cloudflare frontend/API deployment plan

## External References

- Chrome `chrome.debugger`: https://developer.chrome.com/docs/extensions/reference/api/debugger
- Chrome `chrome.tabs`: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome remote-debugging change note: https://developer.chrome.com/blog/remote-debugging-port
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare D1 overview: https://developers.cloudflare.com/d1/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 read replication: https://developers.cloudflare.com/d1/best-practices/read-replication/

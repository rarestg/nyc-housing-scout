# PM Planning Brief: Multi-Source Collector Runtime

Use this note when a future PM needs to create the execution bundle for the next milestone.

This is not the execution bundle itself. It is the map for producing one without depending on session memory.

## Goal

Create a planning bundle for:

- multi-source collector runtime
- source/tab lease and recovery model
- replacement of the current OpenClaw dependency with a thin repo-owned browser bridge
- ingest/runtime hardening for continuous multi-group collection

## What Is Already Decided

These points should be treated as current working decisions unless a new review explicitly reopens them.

### 1. This is the next milestone

Current sequencing is:

1. multi-source collector runtime / ingest hardening
2. later enrichment/geocoding follow-up and other backlog items
3. later saved searches / alerts

Do not start by planning another frontend sprint.

### 2. This is backend/runtime work, not primarily UI work

Primary code areas for the future bundle:

- `src/browser/`
- `src/core/`
- `src/processing/`
- `src/storage/`
- `src/cli/`

Frontend impact is secondary and should stay limited to operational visibility if needed.

### 3. OpenClaw is a current implementation detail, not the desired long-term boundary

The intended direction is:

- replace the OpenClaw dependency
- use a thin repo-owned Chrome MV3 browser bridge
- expose a loopback-only local relay surface
- keep browser semantics in repo code, not in a fat extension abstraction

### 4. Explicit source ownership matters more than the browser vendor/tool choice

Architectural emphasis should remain on:

- source-to-tab targeting
- source/tab lease state
- recovery and health semantics
- avoiding active-tab ambiguity

The browser bridge is important because it supports those guarantees, not because “rolling our own extension” is a goal by itself.

### 5. `docs/SHIP_PLAN.md` is the canonical source for locked topology decisions

Use `docs/SHIP_PLAN.md` as the canonical source when the PM needs to confirm:

- the intended collector manager plus tab-lanes runtime shape
- the fact that OpenClaw replacement is already a locked direction
- the requirement that source-to-tab ownership be explicit
- the fact that the milestone is about reliable multi-source ingest, not just browser parity

This note and the MV3 recommendation note are planning inputs that interpret those locked decisions for dispatch purposes. They should not be treated as overrides of `docs/SHIP_PLAN.md`.

## Source Docs To Read First

Read these in order before planning:

1. `README.md`
2. `docs/INDEX.md`
3. `docs/VISION_AND_ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. `docs/SHIP_PLAN.md`
6. `docs/PIPELINE.md`
7. `docs/notes/2026-03-17_16-40-27_PM_HANDOFF_AND_NEXT_MILESTONE.md`
8. `docs/notes/2026-03-17_18-39-19_MV3_BROWSER_BRIDGE_RECOMMENDATION.md`

Then read the most relevant reviews:

1. `docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md`
2. `docs/reviews/2026-03-12_20-48-15_SCALE_ARCHITECTURE_REVIEW.md`
3. `docs/reviews/2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md`

Then read the most relevant implementation logs:

1. `docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md`
2. `docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md`
3. `docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md`
4. `docs/passes/2026-03-17_10-35-10_FALLBACK_TRANSPORT_DECISION_SIMPLIFICATION_PASS.md`
5. `docs/passes/2026-03-16_23-27-22_CRAWL_WORKING_SET_ORCHESTRATION_SIMPLIFICATION_PASS.md`
6. `docs/passes/2026-03-16_23-45-46_NETWORK_CAPTURE_FINALIZATION_SIMPLIFICATION_PASS.md`
7. `docs/passes/2026-03-17_00-09-42_NETWORK_CAPTURE_SETUP_SIMPLIFICATION_PASS.md`

Then inspect the current code seams:

- `src/core/browser-pipeline.js`
- `src/browser/cdp-network-capture.js`
- `src/cli/ingest-loop.js`
- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.network-integration.js`
- `src/cli/crawl-latest.js`
- `src/cli/capture-feed.js`

## What The PM Should Understand Before Planning

### Current dependency shape

The current active collector still depends on:

- OpenClaw browser control
- an attached authenticated Chrome tab/profile
- relay/CDP readiness coming from the external tooling path

The planning bundle should not pretend this has already been replaced.

### Desired replacement shape

The intended replacement is:

- repo-owned MV3 extension
- loopback relay
- explicit tab discovery / attach / detach
- raw CDP forwarding sufficient for evaluate, navigate, waits, and network capture
- repo-owned runtime semantics for leases, recovery, and source ownership

For the current recommended browser-boundary shape and phasing, use:

- `docs/notes/2026-03-17_18-39-19_MV3_BROWSER_BRIDGE_RECOMMENDATION.md`

### Workstream boundaries

The planning bundle should likely separate:

1. multi-source runtime / source ownership
2. MV3 browser bridge
3. crawl policy and runtime hardening
4. collection vs queue/processing concurrency semantics

Do not collapse everything into one vague “rewrite browser control” task.

## Milestone Completion Boundary

The future execution bundle should make one thing unambiguous:

- Phase 1 browser parity is not the milestone by itself.
- Phase 2 network-capture parity is not the milestone by itself.
- The milestone is only complete when the system can run multiple sources continuously on one machine with explicit source ownership and without browser-context collisions.

Treat the milestone as complete only when all of the following are true:

1. the active collection path no longer requires OpenClaw
2. collector operations are bound to explicit source-to-tab leases rather than profile-level ambiguity
3. the MV3 bridge supports the active DOM collection path and the CDP-assisted recovery path the repo currently relies on
4. the runtime can keep multiple sources active on one machine without wrong-tab or wrong-source contamination
5. collection and downstream queue/processing can run concurrently without unsafe ownership or write collisions

If a future bundle scopes only DOM-only bridge parity, that should be presented as an intermediate phase deliverable, not as milestone completion.

## Questions The PM Should Resolve In The Bundle

The planning bundle should answer these explicitly:

1. What is the smallest viable Phase 1 that proves explicit source ownership without a giant rewrite?
2. Should the runtime and MV3 bridge land sequentially or partially in parallel?
3. What current OpenClaw capabilities are required on day one of the replacement?
4. What state must be durable for source/tab leases and recovery?
5. How will the runtime detect and recover from:
   - tab drift
   - login drift
   - detached targets
   - relay reconnects
   - browser restarts
6. What validation proves “multiple sources continuously on one machine without collisions” is actually true?

## Minimum Validation Matrix For The Future Bundle

The future execution bundle should include a concrete validation plan, not just a statement that “we will test multi-source ingest.”

At minimum, keep these validation cases unless a newer review explicitly changes them:

1. **Two-source steady-state run**
   - run at least two real Facebook groups in two separate leased tabs
   - prove each source stays bound to its own tab lease
   - prove observations and runs are recorded under the correct source only
2. **Unattended soak**
   - keep the multi-source runtime up long enough to observe normal crawl, wait, and retry behavior
   - recommended initial floor: `30` minutes minimum on a real local session
3. **Collector-manager restart recovery**
   - restart the manager process while the browser session and tabs remain open
   - prove leases, target identities, and runtime state recover without duplicate ownership
4. **Browser-bridge reconnect recovery**
   - prove recovery after transient relay disconnect or MV3 service-worker restart
   - prove the runtime does not silently fall back to the wrong tab during reconnect
5. **Navigation / detach recovery**
   - prove navigation-triggered detach and reattach do not orphan a source lane
   - prove the runtime either resumes the same lease safely or pauses the lane with an explicit health signal
6. **Drift protection**
   - verify that wrong-page, logged-out, or detached-target states are detected as unhealthy
   - verify the runtime pauses or fails the affected source instead of collecting ambiguous data
7. **Queue concurrency**
   - run collection and downstream queue/processing at the same time
   - prove concurrent operation does not create source collisions, duplicate ownership, or unsafe writes
8. **OpenClaw removal gate**
   - prove the active collection path can run end-to-end without any OpenClaw dependency remaining in the runtime path

The execution bundle should turn these into named acceptance checks with exact commands, expected outputs, and ownership.

## Guardrails For The Future Bundle

The planning bundle should keep these guardrails:

- do not redesign the whole product while planning this milestone
- do not widen into another frontend overhaul
- do not make “build an extension” the goal; make explicit source ownership and reliable ingest the goal
- do not introduce heavy orchestration or hosted complexity
- do not turn this into a broad async rewrite unless the boundary truly requires it
- preserve the current local-first, SQLite-canonical architecture

## Suggested Shape Of The Future Planning Bundle

The future execution bundle should probably include:

- `README.txt`
- repo-state synthesis for browser/runtime control
- runtime and lease model design
- MV3 browser bridge design
- phased implementation plan
- milestone exit criteria and validation matrix
- dispatch protocol
- coordination board
- worker briefs and handoff files

Likely first worker scopes:

1. runtime state / lease model and storage contract
2. browser bridge protocol / extension skeleton
3. CLI/runtime migration from implicit attached-tab control
4. recovery/validation pass

## What Counts As A Good Bundle

A good planning bundle for this milestone will make it obvious:

- what is already decided
- what still needs a product/engineering decision
- what the implementation phases are
- what can be delegated in parallel vs what is a hard dependency
- how success will be validated in live local runs
- what the milestone completion gate is vs what counts as an intermediate phase close

If the PM cannot point a worker to a single brief and have them understand:

- what to read
- what they own
- what they must not change
- what “done” means

then the planning bundle is not ready yet.

## Relationship To Other Deferred Backlog

This milestone should happen before returning to:

- deferred operator UI backlog
- `sqlite-storage.js` modularization / SQL pushdown
- saved searches / alerts

Those items are tracked elsewhere and should not be mixed into this runtime bundle.

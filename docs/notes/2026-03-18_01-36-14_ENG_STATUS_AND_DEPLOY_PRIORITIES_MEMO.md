# Eng Status And Deploy Priorities Memo

Date: March 18, 2026

## Purpose

This memo is a stand-alone engineering status summary for the current `nyc-housing-scout` product shape.

It is intended to answer:

- where the repo currently is
- what is materially better now
- what is still lacking
- what the P0 and P1 priorities should be
- why those priorities matter if the goal is to deploy a useful version soon

This is not a historical pass log. It is a current-state memo for planning and execution.

## Current State

`nyc-housing-scout` is no longer just an exploratory scraper. It is now a real local-first pipeline with a mostly coherent staged shape:

1. collection writes raw artifacts and canonical observations to SQLite
2. queue processing turns observations into structured listings
3. evidence enrichment, resolution, and manual overrides layer above raw records instead of mutating them
4. local inspection surfaces exist for runs, observations, jobs, listings, artifacts, and review state

Recent simplification work materially improved the active collector:

- the collection versus processing boundary is cleaner
- Facebook identity canonicalization is better centralized
- working-set orchestration is simpler
- network-capture bootstrap, live drain flow, and finalization are smaller and easier to follow
- the old `page_context` fallback/debug transport has now been removed from the active `crawl:dom` path

That last point matters because `crawl:dom` is now CDP-only for network assist. The collector no longer carries a second active transport path that made setup, drain, and finalization harder to reason about.

In short:

- the repo has crossed from “prototype with several overlapping experiments” into “real pipeline with a few remaining high-risk gaps”
- the main remaining work is now operational correctness and deploy readiness, not broad architectural cleanup

## What Is Already Strong

The repo already has the core pieces needed for a usable product:

- DOM-first Facebook collection
- network-assisted identity recovery
- SQLite as the system of record
- raw artifacts on disk for replay and inspection
- queued processing for structured extraction
- Gemini-backed extraction path
- evidence enrichment
- NYC-constrained address resolution
- layered effective values and manual overrides
- local inspection CLI and dashboard surfaces

This is important context for prioritization. The project does not need another foundational rewrite before it can become useful. It needs a smaller set of high-impact reliability and deployment decisions.

## What Is Still Lacking

The main gaps are now concentrated in six areas:

1. crawl policy is not hardened enough for trustworthy repeated operation
2. Facebook identity merge/reuse logic is still the main collector correctness risk
3. storage organization is still too dependent on one giant mixed-concern SQLite file
4. the operator workflow is still too dependent on repo context and tribal knowledge
5. the deployment boundary is not yet fully locked down
6. reliability signals are still too thin for unattended or semi-attended operation

These are not polish issues. These are the issues that determine whether the system can be trusted.

## Why The Recent Collector Simplifications Matter

The recent simplification passes were not cosmetic.

They removed a large amount of accidental complexity from the active collector path:

- transport hierarchy cleanup
- collection versus processing cleanup
- identity canonicalization cleanup
- resolver model cleanup
- working-set orchestration cleanup
- network-capture finalization cleanup
- network-capture setup/bootstrap cleanup
- live drain/settle/refresh cleanup
- fallback transport removal from `crawl:dom`

That means the next engineering work should not drift back into low-value cleanup for its own sake.

The collector is now simple enough that the remaining high-impact work is much easier to see:

- reliable crawl coverage
- identity correctness
- storage/schema clarity
- operator path clarity
- deployment boundary clarity

## P0 Priorities

### 1. Crawl policy hardening

This is the top product risk.

The current collector can crawl, but it is not yet disciplined enough about how it should behave over repeated runs. The project still needs a more explicit and trustworthy incremental crawl policy.

What still needs to happen:

- deterministic source preflight before crawl
- top-of-feed reset behavior that is explicit and reliable
- overlap anchors so a new run can detect already-covered territory
- a stale/seen stop policy instead of relying mostly on `target` and `max-scrolls`
- explicit distinction between “latest sweep” and “backfill”
- a few core crawl metrics such as:
  - first fresh position
  - observed-per-fresh ratio
  - seen streak
  - stop reason quality

Why this is P0:

- if crawl policy is weak, the whole pipeline becomes unreliable
- repeated operation across days and across groups will otherwise be hard to trust
- downstream extraction and review quality do not matter much if source coverage is inconsistent

### 2. Facebook identity merge/reuse simplification and hardening

The remaining collector correctness hotspot is the Facebook-specific network integration cluster in `src/cli/crawl-dom-latest.network-integration.js`.

That code currently does several high-value but still complex jobs:

- exact identity matching
- fuzzy recovery when DOM identity is weak but network evidence is strong
- duplicate reuse across overlap zones and later steps
- same-step late recovery before persistence

This logic is still justified, but it remains the highest-risk part of the collector.

Why this is P0:

- wrong merges collapse different posts into one canonical record
- missed merges create duplicates and duplicate downstream work
- both failures pollute SQLite state, queue processing, and listing outputs

What should happen next:

- simplify the internal state model again without weakening the conservative matching behavior
- expand regression fixtures around known real failure families
- make match provenance and match rules easier for engineers to audit

This is the next narrow simplification pass I would run.

### 3. Storage modularization and schema cleanup

`src/storage/sqlite-storage.js` is still a very large mixed-concern file.

That is worth moving up in priority now because the team still expects to make data-model and DB interaction changes before the first deploy model is fully settled.

Why this is P0:

- a 5k+ line mixed-concern file makes schema changes harder to reason about and review
- storage refactors become more expensive the longer new features and fields pile into the monolith
- the public read-side work will benefit from a clearer separation between canonical writes, queue/evidence operations, and read/query helpers

What should happen next:

- split `sqlite-storage.js` into focused modules by concern
- move dashboard/read-model presentation helpers out of the storage layer
- keep the local write-side on raw SQL and `node:sqlite`
- make the first-deploy data model explicit enough that we can later reset the local DB baseline and squash historical migrations into one clean starting migration

The goal is not an ORM migration and not a storage redesign. The goal is to make the schema and DB interaction layer easier to change safely while the first deploy model is still moving.

### 4. One supported operator workflow

The repo has several useful stage CLIs, but the real operator story is still too context-heavy.

A deploy-adjacent system needs one clearly supported path for normal operation. That path should make it obvious how to:

- preflight the browser/runtime state
- run collection
- validate the resulting run
- hand off into queue processing
- respond to common failure modes

This does not require a large orchestration framework. It does require a clean answer to:

- what is the normal run command or controller?
- what are the expected prerequisites?
- what does success look like?
- what should an engineer do on failure?

Why this is P0:

- a product cannot rely on expert repo knowledge to operate reliably
- operational confusion creates reliability issues even when the underlying code is sound

### 5. Deployment boundary and publish path

If the team wants to deploy soon, the right move is not to deploy the Facebook collector itself.

The near-term deployable shape should be:

- keep Facebook collection local
- keep SQLite as the canonical write-side state
- publish a hosted read-side or exported read model from the local pipeline

What still needs to be decided:

- what data gets published
- how often it gets published
- what the publish mechanism is
- what the stable hosted contract is for effective listing values

Why this is P0:

- it determines the first real deployment architecture
- it prevents the team from spending time trying to cloud-host the least deployable part of the system
- it aligns with the repo’s local-first design instead of fighting it

### 6. Minimal reliability guardrails

The system does not need a full observability platform right now. It does need a minimal health story.

High-value signals still needed:

- browser or CDP preflight failure
- suspiciously low or zero crawl yield
- `validate-run` failure
- growing processing backlog
- extraction failure or retry spikes
- publish failure

Why this is P0:

- without these signals, failures can be silent
- if the team publishes a hosted read side, local collection health becomes a production concern even if collection itself remains local

## P1 Priorities

### 1. Extraction quality tuning on real failures

The extraction stack is present and useful, but it still needs failure-driven tuning on real outputs.

This should focus on:

- recurring misclassification patterns
- ambiguity handling
- prompt and normalization tuning
- confidence behavior on messy real posts

This is P1 rather than P0 because coverage and identity correctness are more fundamental. Better extraction on the wrong or duplicated observations does not solve the core product risk.

### 2. Review and correction loop hardening

The foundations are now there:

- evidence fragments
- resolved fields
- manual overrides
- effective value precedence
- review-oriented read surfaces

What is still needed is not more architecture. It is a more reliable operator experience around inspection and correction.

This is P1 because the review layer becomes much more valuable once upstream coverage and identity are more trustworthy.

### 3. Explicit latest-sweep versus backfill split

This is closely related to crawl policy hardening, but I still treat it as slightly secondary to the most urgent incremental reliability work.

The collector should not keep one overloaded crawl loop for every purpose. Once the incremental path is hardened, backfill behavior should become explicit and separately reasoned about.

### 4. Source onboarding and source management hygiene

If the team expects to expand across multiple groups soon, source configuration and validation need to be more structured.

This matters, but it sits behind:

- crawl reliability
- identity correctness
- operator workflow clarity

## What Is Not P0 Right Now

These are not the highest-value next tasks:

- more transport work
- more collector abstraction
- UI polish
- image enrichment
- broader geocoding
- legacy collector cleanup unless it directly blocks the active path
- trying to deploy Facebook scraping in the cloud

The recent simplification work was valuable because it cleared the way for the actual P0 work. The team should now spend most of its time on reliability and deployment readiness, not more internal cleanup unless it directly reduces correctness risk.

## Recommended Execution Order

If the goal is to get to a reliable deployable version soon, I would recommend this sequence:

1. crawl policy hardening
2. identity merge/reuse simplification plus stronger regression fixtures
3. one supported operator workflow
4. publish/read-side deployment path
5. minimal reliability guardrails
6. extraction quality tuning on real deployed data

Why this order:

- first make sure the system sees the right posts
- then make sure it identifies those posts correctly
- then make sure engineers can run it reliably
- then expose the read side
- then improve output quality based on real usage and real data

This keeps the team focused on the shortest path to a trustworthy first deployment.

## Deployment Guidance

The recommended near-term deployment shape is:

- local collection
- local canonical SQLite write-side
- hosted read-side or published export layer

That keeps the hardest and most Facebook-specific operational dependency local, while still allowing the product to ship something real to end users or internal consumers.

This is consistent with the repo’s architecture and with the current product maturity.

## Bottom Line

The project is no longer blocked by unclear architecture.

It is now blocked by a smaller, more concrete set of execution problems:

- reliable crawl coverage
- correct Facebook post identity handling
- one supported operator workflow
- a clear local-write / hosted-read deployment boundary
- minimal reliability guardrails

If the team stays focused on those items, a first deployable version is realistic without wasting time on low-value frills.

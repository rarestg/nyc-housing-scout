# Crawl Working-Set Orchestration Simplification Pass

## 1. Scope

Narrow simplification pass for the active DOM crawl loop in `src/cli/crawl-dom-latest.js`.

Goals:

- make the per-step lifecycle read as one explicit sequence
- collapse duplicated step-phase and step-metric shaping
- preserve current DOM collection, network-assisted enrichment, late-drain resolution, persistence, run-step logging, and run summary/artifact behavior

Explicit non-goals:

- no resolver redesign
- no parser or transport rewrite
- no storage or queue redesign
- no CDP/page-context behavior changes
- no frontend or legacy collector cleanup

## 2. Files Changed

- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.step-helpers.js`
- `test/crawl-dom-latest-step-helpers.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_23-27-22_CRAWL_WORKING_SET_ORCHESTRATION_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and source-of-truth reads:

```bash
git status --short
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,240p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_16-34-20_COLLECTION_PROCESSING_BOUNDARY_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_17-43-08_FACEBOOK_IDENTITY_CANONICALIZATION_SIMPLIFICATION_PASS.md
sed -n '1,280p' docs/passes/2026-03-16_18-03-31_NETWORK_RESOLVER_SIMPLIFICATION_PASS.md
sed -n '1,220p' docs/passes/README.md
```

Code and test reads:

```bash
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '261,520p' src/cli/crawl-dom-latest.js
sed -n '521,840p' src/cli/crawl-dom-latest.js
sed -n '841,1120p' src/cli/crawl-dom-latest.js
sed -n '1,360p' src/cli/crawl-dom-latest.network-integration.js
sed -n '361,760p' src/cli/crawl-dom-latest.network-integration.js
sed -n '761,1040p' src/cli/crawl-dom-latest.network-integration.js
sed -n '1,260p' src/browser/cdp-network-capture.js
sed -n '1,280p' src/browser/network-capture.js
sed -n '1,260p' src/core/browser-pipeline.js
sed -n '1,320p' src/core/collected-post.js
sed -n '1,320p' test/crawl-dom-network-integration.test.js
sed -n '321,640p' test/crawl-dom-network-integration.test.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '1,320p' test/network-capture.test.js
sed -n '1,280p' test/storage-inspection.test.js
sed -n '120,240p' test/storage-interface.test.js
rg -n "appendRunStep|validate-run|crawl_run_steps|stepLog|networkCapture" test src/storage src/cli
rg -n "networkCapture|capturedThisStep|normalizedCandidatesThisStep|lateDrainPasses|withIdentityOnFinalize|provisionalBeforeResolution" test src
rg -n "^(async )?function |^function |^const .* = \\{" src/cli/crawl-dom-latest.js
nl -ba src/cli/crawl-dom-latest.js | sed -n '1,220p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '520,780p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '340,760p'
sed -n '1,260p' src/cli/crawl-dom-latest.step-helpers.js
git diff -- src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js
```

Checks and tests:

```bash
node --check src/cli/crawl-dom-latest.js
node --check src/cli/crawl-dom-latest.step-helpers.js
node --check test/crawl-dom-latest-step-helpers.test.js
node --test test/crawl-dom-latest-step-helpers.test.js
node --test test/crawl-dom-network-integration.test.js
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-17T03-26-42-445Z
npm run inspect:storage -- run-steps --run-id 2026-03-17T03-26-42-445Z --limit 5
TZ=America/New_York date '+%Y-%m-%d_%H-%M-%S'
```

## 4. Old Orchestration Shape Vs New Orchestration Shape

### Old shape

The active loop mixed all step responsibilities inline:

1. expand DOM
2. read page state
3. extract visible posts
4. construct the working set
5. seed duplicate-reuse state
6. drain network after expand
7. resolve the working set
8. branch into target-stop vs max-scroll finalize vs scroll path
9. late-drain again
10. resolve again
11. write raw artifacts
12. persist observations
13. update freshness counters and merge metrics
14. register resolved-post reuse
15. manually shape `stepLog`
16. manually shape `appendRunStep(...)`

The behavior was correct, but the lifecycle was spread across one long block with several temporary counters and two separate hand-built reporting payloads.

### New shape

The loop now reads as one explicit sequence:

1. `executeCrawlStep(stepIndex)`
   - build the DOM working set
   - stage resolved-post reuse
   - drain after expand
   - resolve
   - compute the stop/scroll plan
   - run the late drain
   - resolve unresolved entries one final time
   - return one step result object
2. `persistWorkingSetStep(stepResult)`
   - write raw artifacts for new observations only
   - persist the observation batch
   - update freshness totals
   - record accepted network merges
   - re-register persisted identity-bearing posts for reuse
   - return the same step result with persistence counts attached
3. `buildCrawlStepReport(stepResult)`
   - shape one shared network-capture summary
   - derive both `stepLog` and `appendRunStep(...)` payloads from that shared summary

The step loop itself is now:

1. execute the step
2. persist the step
3. report the step
4. break if the step has a stop reason

## 5. Logic / State Removed Or Collapsed

- Collapsed raw-post normalization into `createDomCollectedPost(...)` so working-set construction no longer reassembles the collected-post options inline.
- Collapsed visible-post staging into `createWorkingSetForVisiblePosts(...)` so the step now gets one explicit `{ workingSet, provisionalBeforeResolution }` payload.
- Collapsed stop-branch logic into `createCrawlStepAdvancePlan(...)` so the target-stop / max-scroll finalize / normal scroll decision is assembled in one place.
- Collapsed persistence preparation into `createPersistedWorkingSetEntries(...)` and `recordStepObservations(...)` so raw artifact writing and observation batching are not interleaved with reporting.
- Collapsed persistence counters into `persistWorkingSetStep(...)` so `added/fresh/seen/unidentified/networkMerged/networkRecovered` are attached to the step result instead of kept as ad hoc locals in the main loop.
- Collapsed duplicated step reporting into `buildCrawlStepReport(...)`, which now produces:
  - the shared `networkCapture` step summary
  - the `stepLog` entry
  - the persisted `crawl_run_steps` input
- Deleted the redundant late-loop `if (!stoppedReason && counters.fresh >= target)` branch. It was not affecting behavior because `counters` are only updated during persistence after that point.
- Replaced repeated zero-valued drain literals with `createEmptyNetworkDrainResult(...)` so step/drain defaults share one shape.

## 6. New Step Lifecycle Invariants

1. Every crawl step now produces one explicit step result before persistence.
2. A step resolves the working set at most twice:
   - once after the first post-expand drain
   - once after the late drain, only for unresolved/unmatched entries
3. Persistence only happens after the step’s late drain and final resolution pass.
4. The startup drain belongs only to step `0`; later steps always get an explicit empty startup-drain contribution.
5. `stepLog` and persisted `crawl_run_steps.metadata.networkCapture` are now derived from the same step-level network summary object.
6. Freshness totals remain run-scoped and are only updated during persistence, not during DOM extraction or network drain phases.
7. Duplicate/reuse registration still happens twice where it matters:
   - identity-bearing DOM entries are staged before the network match pass
   - persisted identity-bearing entries are re-registered after observation persistence

## 7. Test Coverage Added Or Updated

Added:

- `test/crawl-dom-latest-step-helpers.test.js`
  - locks the explicit stop-plan behavior for target-stop, max-scroll finalize, and normal scroll steps
  - locks the shared step-report shaping so `stepLog` and persisted run-step metadata cannot drift apart on network-capture fields

Preserved by existing focused suites:

- `test/crawl-dom-network-integration.test.js`
  - exact identity enrichment
  - conservative fuzzy identity recovery
  - resolved duplicate reuse for overlapping DOM copies
  - same-step late-drain recovery before persistence
  - preservation of original recovery provenance on late passes
- `test/network-capture.test.js`
  - network envelope capture and summary behavior
- `test/cdp-network-capture.test.js`
  - CDP capture, idle/wait, and drain semantics

Results:

- targeted step/network suites: `27/27` passing
- full suite: `100/100` passing

## 8. Live Validation Run

Command:

```bash
node src/cli/crawl-dom-latest.js \
  --browser-profile chrome \
  --source-key williamsburggreenpointhousing \
  --source-name "Williamsburg Greenpoint Housing" \
  --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --target 20 \
  --max-scrolls 2 \
  --network-target-group-id 2664056243718928
```

Run id:

- `2026-03-17T03-26-42-445Z`

Observed result:

- `collected = 12`
- `freshCollected = 0`
- `seenCollected = 12`
- `unidentifiedCollected = 0`
- `withIds = 12`
- `networkCapture.transport = "cdp"`
- `networkCapture.summary.capturedCount = 1`
- `networkCapture.integration.candidatesExtracted = 7`
- `networkCapture.integration.mergedPosts = 0`
- `stepLog.length = 3`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T03-26-42-445Z`
- result: healthy, `issues = []`

Run-step inspection:

- `npm run inspect:storage -- run-steps --run-id 2026-03-17T03-26-42-445Z --limit 5`
- confirmed the persisted `metadata.networkCapture` fields remained coherent and aligned with the CLI `stepLog`

## 9. Did Any Summary / Artifact / Run-Step Fields Change Materially?

No intentional external field contract changed in this pass.

Preserved:

- `stepLog` field names
- `crawl_run_steps` top-level columns
- `crawl_run_steps.metadata.networkCapture` field names
- run summary `networkCapture` shape
- `network_capture_export` artifact shape

What changed was only where those values are assembled:

- step reporting now comes from one shared step-result summary instead of two hand-built payloads

## 10. Risks Or Remaining Complexity

Remaining justified complexity in `crawl-dom-latest.js`:

- network capture install/startup/final-flush lifecycle is still imperative because it coordinates real browser/CDP state
- final run/artifact summary shaping is still sizable because the crawl exports several truthful operator-facing surfaces from one run
- persistence still mutates shared run totals and collected-identity registries because the collector’s dedupe/freshness behavior is inherently run-scoped

Residual risks:

- the new helper file only unit-tests step planning/report shaping, not full browser orchestration
- the bounded live crawl was all-seen, so it validated orchestration/reporting integrity and storage health, not a fresh identity-recovery case

## 11. Recommendation For The Next Simplification Pass

Take the next narrow pass at run finalization and network-capture reporting in `src/cli/crawl-dom-latest.js`.

Why this is next:

- the per-step lifecycle is now materially clearer
- the biggest remaining reasoning hotspot in the file is no longer the loop itself
- what still feels heavy is the startup/install/final-flush/final-summary/artifact shaping around `networkCapture`

A good next pass would:

- keep the current capture behavior
- keep the current artifact and summary fields
- collapse the final `networkCaptureSummary` / `graphQlRequestSummary` / artifact / run-summary shaping into one explicit finalize result the same way this pass did for per-step reporting

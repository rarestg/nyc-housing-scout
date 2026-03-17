# Network Capture Live Session Simplification Pass

## 1. Scope

Narrow simplification pass for the remaining live network session operation cluster in the active collector path.

Goals:

- make the live drain/settle/refresh lifecycle read as one explicit flow
- reduce duplicated drain result shaping and repeated completion aggregation
- preserve current CDP drain semantics, page-context drain semantics, startup capture behavior, late/final drain behavior, and final artifact flush correctness

Explicit non-goals:

- no resolver redesign
- no parser or transport redesign
- no storage, queue, or frontend changes
- no collection/processing boundary changes
- no legacy collector cleanup

## 2. Files Changed

- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.step-helpers.js`
- `test/crawl-dom-latest-step-helpers.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-17_10-02-59_NETWORK_CAPTURE_LIVE_SESSION_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and source-of-truth reads:

```bash
sed -n '1,220p' README.md
sed -n '1,260p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,260p' docs/ROADMAP.md
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_23-45-46_NETWORK_CAPTURE_FINALIZATION_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-17_00-09-42_NETWORK_CAPTURE_SETUP_SIMPLIFICATION_PASS.md
sed -n '1,240p' docs/passes/README.md
git status --short
```

Code and test reads:

```bash
rg -n "settleNetworkCaptureEvents|drainNetworkCapture|drainNetworkCaptureToCompletion|refreshInstalledNetworkCaptureState|waitForIdle|finalArtifactDrain|startupNetworkDrain|drain" src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js src/browser/cdp-network-capture.js src/browser/network-capture.js test/crawl-dom-latest-step-helpers.test.js test/crawl-dom-network-integration.test.js test/cdp-network-capture.test.js test/network-capture.test.js
sed -n '1,260p' src/cli/crawl-dom-latest.step-helpers.js
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '260,520p' src/cli/crawl-dom-latest.js
sed -n '520,820p' src/cli/crawl-dom-latest.js
sed -n '260,420p' src/cli/crawl-dom-latest.step-helpers.js
sed -n '1,260p' test/crawl-dom-latest-step-helpers.test.js
rg -n "createFacebookNetworkCaptureDrainFn|drainFacebookNetworkCaptureState|summarizeFacebookNetworkCapture|install" src/browser/network-capture.js
sed -n '520,860p' src/browser/network-capture.js
sed -n '1,260p' test/network-capture.test.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '260,420p' test/cdp-network-capture.test.js
sed -n '430,560p' test/crawl-dom-network-integration.test.js
tail -n 20 docs/passes/README.md
nl -ba src/cli/crawl-dom-latest.js | sed -n '130,360p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '360,560p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '560,780p'
nl -ba src/cli/crawl-dom-latest.step-helpers.js | sed -n '1,180p'
nl -ba test/crawl-dom-latest-step-helpers.test.js | sed -n '1,220p'
nl -ba test/crawl-dom-latest-step-helpers.test.js | sed -n '220,360p'
git diff --stat -- src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js test/crawl-dom-latest-step-helpers.test.js
git status --short src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js test/crawl-dom-latest-step-helpers.test.js docs/passes/README.md
TZ=America/New_York date '+%Y-%m-%d_%H-%M-%S'
```

Validation and test commands:

```bash
node --check src/cli/crawl-dom-latest.js
node --check src/cli/crawl-dom-latest.step-helpers.js
node --check test/crawl-dom-latest-step-helpers.test.js
node --test test/crawl-dom-latest-step-helpers.test.js
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
node --test test/cdp-network-capture.test.js
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
npm test
```

Live validation commands:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key "williamsburggreenpointhousing" --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-17T14-00-33-608Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T14-00-33-608Z/network-capture-2026-03-17T14-00-33-608Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ transport:data.transport, requestedMode:data.requestedMode, startup:data.startup, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain, summary:data.summary, graphQlRequestSummary:data.graphQlRequestSummary, integration:data.integration }, null, 2));"
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key "williamsburggreenpointhousing" --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --navigate-before-crawl
npm run inspect:storage -- validate-run --run-id 2026-03-17T14-02-01-838Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T14-02-01-838Z/network-capture-2026-03-17T14-02-01-838Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ transport:data.transport, requestedMode:data.requestedMode, startup:{ navigationRequestedAt:data.startup?.navigationRequestedAt, navigationCompletedAt:data.startup?.navigationCompletedAt, firstRequestTimestamp:data.startup?.firstRequestTimestamp, firstResponseTimestamp:data.startup?.firstResponseTimestamp, capturedCount:data.startup?.capturedCount, normalizedCandidates:data.startup?.normalizedCandidates, drainPasses:data.startup?.drainPasses, graphQlRequestCount:data.startup?.graphQlRequestCount, graphQlInspectableCount:data.startup?.graphQlInspectableCount }, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain, summary:data.summary, graphQlRequestSummary:data.graphQlRequestSummary, startupGraphQlSummary:data.startup?.graphQlSummary, integration:data.integration }, null, 2));"
```

## 4. Old Live-Session Shape Vs New Live-Session Shape

### Old shape

The live session flow in `src/cli/crawl-dom-latest.js` was split across five helpers with overlapping responsibility:

1. `settleNetworkCaptureEvents(...)` decided how to wait for idle.
2. `drainNetworkCapture(...)` waited, drained, normalized item fields, refreshed controller state in one branch, and assembled a partial result inline.
3. `drainNetworkCaptureToCompletion(...)` re-aggregated the same fields by hand with a separate zero/default shape.
4. `refreshInstalledNetworkCaptureState()` refreshed only installed/startup/target state.
5. `refreshNetworkCaptureControllerStateAfterIdle()` added one more settle + refresh + GraphQL sync path for finalization.

That made the relationship between:

- idle waiting
- one drain
- repeated drains
- controller refresh
- GraphQL request refresh

harder to follow than it needed to be.

### New shape

The live session now reads as one smaller lifecycle:

1. `waitForNetworkCaptureIdle(...)`
2. `drainInstalledNetworkCapture()`
3. `recordDrainedNetworkItems(...)`
4. `drainNetworkCapture(...)`
   - owns idle wait
   - owns transport-specific drain dispatch
   - owns one explicit live drain result
   - owns post-drain controller refresh through `syncNetworkCaptureControllerState()`
5. `drainNetworkCaptureToCompletion(...)`
   - owns repeated passes
   - owns one explicit completion result via helper aggregation
6. `syncNetworkCaptureControllerState({ waitForIdle: true })`
   - is the single refresh boundary used when a fresh idle snapshot is needed

Startup capture and final artifact flush now both consume the same live drain/completion path instead of having bespoke partial logic around it.

## 5. Logic / State Removed Or Collapsed

Collapsed:

- ad hoc drain result assembly in `drainNetworkCapture(...)`
- ad hoc repeated completion aggregation in `drainNetworkCaptureToCompletion(...)`
- the separate final-only `refreshNetworkCaptureControllerStateAfterIdle()` path into `syncNetworkCaptureControllerState(...)`
- repeated controller-vs-page-context drain branching into `drainInstalledNetworkCapture()`
- repeated post-drain item tagging, startup item collection, and persisted-drop trimming into `recordDrainedNetworkItems(...)`

Made explicit:

- one live drain operation result shape via `createNetworkDrainOperationResult(...)`
- one drain-to-completion result shape via `accumulateNetworkDrainCompletionResult(...)`
- one controller refresh boundary that can optionally wait for idle before refreshing installed state plus GraphQL request state

Deleted from the main file:

- the separate `settleNetworkCaptureEvents(...)` name
- the separate `refreshNetworkCaptureControllerStateAfterIdle()` helper
- the manual field-by-field completion accumulator locals for captured counts, remaining counts, stats, settle timeout, and pass count

## 6. Test Coverage Added Or Updated

Added in `test/crawl-dom-latest-step-helpers.test.js`:

- live drain operation result normalization:
  - counts captured items
  - preserves phase/step identity
  - defaults zero-result drains to one stable shape
- drain-to-completion aggregation:
  - sums captured items and normalized candidates across passes
  - keeps the final remaining/buffered/pending/body-read state explicit
  - preserves the latest stats snapshot
  - ORs `settleTimedOut`
  - increments pass count directly from the shared helper

Preserved by existing focused suites:

- `test/cdp-network-capture.test.js`
  - CDP drain correctness
  - in-flight body-read accounting
  - idle waiting semantics
  - startup request window filtering
- `test/network-capture.test.js`
  - page-context drain and summary semantics
  - bounded envelope retention and reinstall behavior
- `test/crawl-dom-network-integration.test.js`
  - same-step late drains still recover identity before persistence
  - exact/fuzzy recovery behavior remains unchanged

Results:

- helper suite: `8/8` passing
- focused network/live-session suite: `33/33` passing
- full suite: `109/109` passing

## 7. Live Validation Run

### 7.1 Default bounded crawl

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

- `2026-03-17T14-00-33-608Z`

Observed result:

- `transport = "cdp"`
- `summary.capturedCount = 1`
- `integration.mergedPosts = 1`
- `integration.recoveredIdentityCount = 1`
- startup remained zeroed without navigation timestamps
- `finalDrain.remainingBuffered = 0`
- `finalDrain.pendingRequests = 0`
- `finalDrain.inFlightBodyReads = 0`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T14-00-33-608Z`
- result: healthy, `issues = []`

### 7.2 Startup-armed bounded crawl

Command:

```bash
node src/cli/crawl-dom-latest.js \
  --browser-profile chrome \
  --source-key williamsburggreenpointhousing \
  --source-name "Williamsburg Greenpoint Housing" \
  --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --target 20 \
  --max-scrolls 2 \
  --network-target-group-id 2664056243718928 \
  --navigate-before-crawl
```

Run id:

- `2026-03-17T14-02-01-838Z`

Observed result:

- `transport = "cdp"`
- startup timestamps populated:
  - `navigationRequestedAt = 2026-03-17T14:02:05.470Z`
  - `navigationCompletedAt = 2026-03-17T14:02:17.008Z`
  - `firstRequestTimestamp = 2026-03-17T14:02:08.637Z`
  - `firstResponseTimestamp = 2026-03-17T14:02:09.071Z`
- startup window stayed scoped:
  - `startup.capturedCount = 2`
  - `startup.normalizedCandidates = 7`
  - `startup.graphQlRequestCount = 15`
  - `startup.graphQlInspectableCount = 2`
- overall summary remained coherent:
  - `summary.capturedCount = 3`
  - `graphQlRequestSummary.count = 16`
  - `integration.mergedPosts = 4`
  - `integration.recoveredIdentityCount = 1`
- `finalDrain.remainingBuffered = 0`
- `finalDrain.pendingRequests = 0`
- `finalDrain.inFlightBodyReads = 0`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T14-02-01-838Z`
- result: healthy, `issues = []`

## 8. Risks Or Remaining Complexity

Remaining complexity that is still justified:

- CDP still needs real idle accounting for buffered items, pending requests, and in-flight body reads.
- The collector still needs same-step late drains before persistence because weak-identity DOM posts can legitimately become durable only after later network traffic arrives.
- Startup navigation remains a distinct phase because `--navigate-before-crawl` changes the capture window, not just a wait duration.
- Page-context remains a real fallback/debug transport, so one small transport branch is still justified for now.

Residual risks:

- the repo still carries both `cdp` and `page_context` through the live session path, even though the operational center is now clearly CDP
- live Facebook timing is still inherently noisy, so bounded run outcomes vary even when drain invariants hold

Material output changes:

- none intended at the artifact/run-summary/stdout contract level
- the pass changed internal assembly and refresh boundaries, not the meaning of top-level fields

## 9. Recommendation For The Next Simplification Pass

The next simplification pass should target the remaining transport duality in the active collector path:

1. keep `cdp` as the only normal-path live session mental model
2. quarantine `page_context` more aggressively behind an explicit fallback/debug boundary
3. remove any remaining active-flow branching that exists only to keep the fallback path feeling co-equal

After this pass, the biggest remaining justified complexity is the network-assisted identity recovery itself, not the live session drain lifecycle around it.

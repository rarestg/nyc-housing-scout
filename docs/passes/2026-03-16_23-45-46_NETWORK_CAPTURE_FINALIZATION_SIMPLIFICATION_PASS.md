# Network Capture Finalization Simplification Pass

## 1. Scope

Narrow simplification pass for the active `crawl:dom` network-capture/session tail in `src/cli/crawl-dom-latest.js`.

Goals:

- make install/startup/finalize/close read as one explicit lifecycle
- collapse duplicated startup summary, final drain, artifact payload, and top-level summary shaping
- preserve current CDP-default behavior, explicit page-context fallback/debug mode, startup capture semantics, final artifact flush correctness, and truthful run/artifact reporting

Explicit non-goals:

- no resolver redesign
- no parser or transport redesign
- no CDP/page-context semantic changes
- no storage or queue redesign
- no collection/processing boundary changes
- no frontend or legacy collector cleanup

## 2. Files Changed

- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.step-helpers.js`
- `test/crawl-dom-latest-step-helpers.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_23-45-46_NETWORK_CAPTURE_FINALIZATION_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and source-of-truth reads:

```bash
git status --short
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,240p' docs/ROADMAP.md
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_15-40-04_TARGETED_STARTUP_RECOVERY_VALIDATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_23-27-22_CRAWL_WORKING_SET_ORCHESTRATION_SIMPLIFICATION_PASS.md
sed -n '1,240p' docs/passes/README.md
```

Code and test reads:

```bash
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '261,520p' src/cli/crawl-dom-latest.js
sed -n '521,820p' src/cli/crawl-dom-latest.js
sed -n '821,1120p' src/cli/crawl-dom-latest.js
sed -n '1,260p' src/cli/crawl-dom-latest.step-helpers.js
sed -n '1,220p' src/browser/cdp-network-capture.js
sed -n '220,520p' src/browser/cdp-network-capture.js
sed -n '1,220p' src/browser/network-capture.js
sed -n '220,520p' src/browser/network-capture.js
sed -n '1,240p' src/core/browser-pipeline.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '1,260p' test/network-capture.test.js
sed -n '1,220p' test/crawl-dom-latest-step-helpers.test.js
rg -n "startupNetworkDrain|finalArtifactDrain|networkCaptureSummary|startupCaptureSummary|graphQlRequestSummary|startupGraphQlSummary|controller.close|finishRun|outputPayload|network_capture_export|startupGraphQlRequests|refreshInstalledNetworkCaptureState|settleNetworkCaptureEvents" src/cli/crawl-dom-latest.js
rg -n "getInstalledSummary|getGraphQlRequests|close\\(|noteNavigationStart|noteNavigationComplete|waitForIdle|drain\\(" src/browser/cdp-network-capture.js
rg -n "networkCapture|network_capture_export|startupGraphQl|startup.*captured|topGraphQl|finalArtifactDrain|graphQlRequestSummary|run-steps|validate-run" test src
```

Validation and local checks:

```bash
node --check src/cli/crawl-dom-latest.js
node --check src/cli/crawl-dom-latest.step-helpers.js
node --check test/crawl-dom-latest-step-helpers.test.js
node --test test/crawl-dom-latest-step-helpers.test.js
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
npm test
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-17T03-43-58-274Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T03-43-58-274Z/network-capture-2026-03-17T03-43-58-274Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ enabled:data.enabled, transport:data.transport, summary:data.summary, startup:data.startup, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain, graphQlRequestSummary:data.graphQlRequestSummary }, null, 2));"
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --navigate-before-crawl
npm run inspect:storage -- validate-run --run-id 2026-03-17T03-44-40-243Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T03-44-40-243Z/network-capture-2026-03-17T03-44-40-243Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ transport:data.transport, startup:{ capturedCount:data.startup.capturedCount, normalizedCandidates:data.startup.normalizedCandidates, graphQlRequestCount:data.startup.graphQlRequestCount, graphQlInspectableCount:data.startup.graphQlInspectableCount, firstRequestTimestamp:data.startup.firstRequestTimestamp, firstResponseTimestamp:data.startup.firstResponseTimestamp, topFriendlyNames:data.startup.summary.topFriendlyNames, topGraphQlFriendlyNames:data.startup.graphQlSummary.topFriendlyNames }, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain, summary:data.summary, graphQlRequestSummary:data.graphQlRequestSummary }, null, 2));"
TZ=America/New_York date '+%Y-%m-%d_%H-%M-%S'
```

## 4. Old Finalization Shape Vs New Finalization Shape

Old shape:

- startup navigation capture lived inline in the main file and directly mutated `startupNetworkDrain`, `networkCapture.startup`, and `networkCapture.startupGraphQlRequests`
- end-of-run finalization then separately:
  - conditionally ran the final drain
  - conditionally waited for controller idle and refreshed installed state
  - shaped four parallel summary locals
  - shaped a separate integration summary local
  - shaped the artifact payload inline
  - shaped the persisted run summary inline
  - shaped stdout JSON inline
  - closed the controller afterward

New shape:

- `navigateBeforeCrawlIfRequested()` now owns the optional startup arm/navigate/capture/reinstall path
- `captureStartupNetworkWindow()` owns the startup drain plus stable startup request snapshot
- `finalizeNetworkCaptureSession(startupDrain)` now owns:
  - final artifact flush
  - controller idle/refresh
  - one explicit `networkCaptureFinalization` result
- `buildNetworkCaptureFinalizationResult(...)` now shapes:
  - the full `network_capture_export` payload
  - the storage artifact metadata
  - the persisted top-level `summary.networkCapture`
  - the stdout `outputPayload.networkCapture`

The end of the file now reads as:

1. write collected artifact
2. finalize network capture session
3. write network-capture artifact from the finalization result
4. finish the run using the same finalization result
5. build stdout payload from the same finalization result
6. close the controller

## 5. Logic / State Removed Or Collapsed

Collapsed:

- the parallel end-of-run locals:
  - `networkCaptureSummary`
  - `startupCaptureSummary`
  - `graphQlRequestSummary`
  - `startupGraphQlSummary`
  - `networkIntegrationSummary`
- duplicated startup summary shaping across:
  - `network_capture_export.startup`
  - `summary.networkCapture.startup`
- duplicated top-level capture summary shaping across:
  - artifact payload
  - persisted run summary
  - stdout payload
- scattered controller settle/refresh/read logic into one `refreshNetworkCaptureControllerStateAfterIdle()` step

Made more explicit:

- startup capture is now one named phase with one returned drain result
- final artifact flush is now always part of one explicit finalization function
- the helper result makes the contract split explicit:
  - artifact payload gets the richer startup/finalization detail
  - persisted run summary keeps the narrower existing startup view
  - stdout keeps its existing debug-oriented summary view

Deleted from the main file:

- ad hoc inline startup capture summary assembly
- ad hoc final artifact metadata assembly
- direct parallel shaping of artifact/run-summary/stdout network-capture fields

## 6. Test Coverage Added Or Updated

Added:

- `test/crawl-dom-latest-step-helpers.test.js`
  - new finalization test locks one shared finalization result across:
    - artifact payload
    - artifact metadata
    - persisted run summary
    - stdout `networkCapture`
  - also locks that run-summary startup stays narrow and does not inherit artifact-only fields such as `capturedCount`, `summary`, or `graphQlSummary`

Preserved by existing focused suites:

- `test/cdp-network-capture.test.js`
  - startup timestamps
  - idle/drain correctness
  - startup timestamp-window filtering
- `test/network-capture.test.js`
  - envelope shaping
  - retained summary counts
  - reinstall/reset behavior
- `test/crawl-dom-network-integration.test.js`
  - exact identity merges
  - conservative fuzzy recovery
  - same-step late-drain recovery before persistence
  - duplicate reuse behavior

Results:

- helper tests: `3/3` passing
- focused network/orchestration tests: `28/28` passing
- full suite: `101/101` passing

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

- `2026-03-17T03-43-58-274Z`

Observed result:

- `collected = 14`
- `freshCollected = 0`
- `seenCollected = 14`
- `unidentifiedCollected = 0`
- `withIds = 14`
- `networkCapture.transport = "cdp"`
- `networkCapture.summary.capturedCount = 0`
- `networkCapture.startup.capturedCount = 0`
- `networkCapture.finalArtifactDrain.remainingBuffered = 0`
- `networkCapture.finalArtifactDrain.pendingRequests = 0`
- `networkCapture.finalArtifactDrain.inFlightBodyReads = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T03-43-58-274Z`
- result: healthy, `issues = []`

Artifact inspection confirmed:

- startup remained a zeroed startup window without navigation timestamps
- `finalDrain` and `finalArtifactDrain` stayed coherent

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

- `2026-03-17T03-44-40-243Z`

Observed result:

- `collected = 5`
- `freshCollected = 1`
- `seenCollected = 3`
- `unidentifiedCollected = 1`
- `withIds = 4`
- `networkCapture.transport = "cdp"`
- `networkCapture.summary.capturedCount = 3`
- `networkCapture.graphQlRequestSummary.count = 17`
- `networkCapture.startup.capturedCount = 2`
- `networkCapture.startup.normalizedCandidates = 7`
- `networkCapture.startup.graphQlRequestCount = 15`
- startup first-request / first-response timestamps were populated
- `networkCapture.finalArtifactDrain.remainingBuffered = 0`
- `networkCapture.finalArtifactDrain.pendingRequests = 0`
- `networkCapture.finalArtifactDrain.inFlightBodyReads = 0`
- `networkCapture.finalArtifactDrain.settleTimedOut = false`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T03-44-40-243Z`
- result: healthy, `issues = []`

Artifact inspection confirmed:

- startup summary stayed scoped to the startup window and did not collapse into the later overall summary
- artifact startup counts, top-friendly-name summaries, and GraphQL request counts remained coherent
- final drain and final artifact drain both reflected a settled controller state before artifact write

## 8. Risks Or Remaining Complexity

- `crawl-dom-latest.js` still owns real browser-session complexity:
  - transport install failure handling
  - pinned target browser commands
  - pre-navigation capture arming
  - DOM extraction timing
- keeping both `cdp` and `page_context` in one file still adds some conditional branching, but that branching is justified because the fallback/debug mode remains a supported surface
- controller close still happens after the final payloads are shaped so the reported installed/final stats reflect the active session rather than the post-close state; that is intentional, but it remains an imperative sequencing detail
- there is still no end-to-end unit test for `crawl-dom-latest.js` itself; the new helper test reduces drift risk, but the full CLI contract is still primarily guarded by focused helper tests plus live validation

## 9. Recommendation For The Next Simplification Pass

Take the next pass at the network-capture install/setup boundary near the top of `crawl-dom-latest.js`:

- collapse transport installation, target pinning, and browser command wrappers into one smaller capture-session setup block
- keep `cdp` primary and `page_context` fallback semantics unchanged
- leave the now-cleaner step loop and finalization flow alone

After this pass, the biggest remaining complexity in `crawl-dom-latest.js` is no longer the step loop or session tail. It is the startup/setup/browser-control plumbing that still lives alongside the crawl logic.

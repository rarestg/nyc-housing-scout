# Network Capture Setup Simplification Pass

## 1. Scope

Narrow simplification pass for the collector bootstrap path at the top of `src/cli/crawl-dom-latest.js`.

Goals:

- make the session bootstrap read as one explicit flow before the crawl loop starts
- collapse scattered network-capture setup state, transport install branching, pinned-target browser wrappers, and startup-navigation plumbing
- preserve current CDP-default behavior, explicit `page_context` fallback/debug mode, pinned target correctness, and explicit `--navigate-before-crawl` semantics

Explicit non-goals:

- no resolver redesign
- no parser rewrite
- no transport semantic changes
- no storage/queue redesign
- no collection/processing boundary changes
- no frontend or legacy collector cleanup

## 2. Files Changed

- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.step-helpers.js`
- `test/crawl-dom-latest-step-helpers.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-17_00-09-42_NETWORK_CAPTURE_SETUP_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and source-of-truth reads:

```bash
pwd && git status --short
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,240p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' data/README.md
sed -n '1,240p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_23-27-22_CRAWL_WORKING_SET_ORCHESTRATION_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_23-45-46_NETWORK_CAPTURE_FINALIZATION_SIMPLIFICATION_PASS.md
```

Code and test reads:

```bash
sed -n '1,240p' src/cli/crawl-dom-latest.js
sed -n '241,520p' src/cli/crawl-dom-latest.js
sed -n '1,260p' src/cli/crawl-dom-latest.step-helpers.js
sed -n '1,240p' src/browser/network-capture.js
sed -n '1,260p' test/crawl-dom-latest-step-helpers.test.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '1,260p' test/network-capture.test.js
rg -n "network-capture|navigate-before-crawl|targetId|pinned|createFacebookCdpNetworkCaptureController|page_context|requestedMode" test src/cli src/browser test/crawl-dom-latest-step-helpers.test.js test/network-capture.test.js test/cdp-network-capture.test.js
sed -n '1,260p' test/crawl-dom-latest-step-helpers.test.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '1,260p' test/network-capture.test.js
nl -ba src/cli/crawl-dom-latest.js | sed -n '1,260p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '620,760p'
sed -n '1,90p' src/cli/crawl-dom-latest.js
sed -n '640,735p' src/cli/crawl-dom-latest.js
rg -n "^(async )?function |^const .* = \\{" src/cli/crawl-dom-latest.js
rg -n "getInstalledSummary|getTargetId|noteNavigationStart|noteNavigationComplete|getGraphQlRequests|close\\(" src/browser/cdp-network-capture.js
sed -n '820,910p' src/browser/cdp-network-capture.js
rg -n "function summarizeFacebookCdpCaptureInstalledState|export function summarizeFacebookCdpCaptureInstalledState" src/browser/cdp-network-capture.js
sed -n '500,560p' src/browser/cdp-network-capture.js
rg -n "evaluateJsonForPinnedTarget|runBrowserForPinnedTarget|installPageContextCapture\\(|installRequestedNetworkCaptureTransport|bootstrapCollectorSession|navigateBeforeCrawlIfRequested|requestedNetworkCaptureMode|networkCaptureBootstrap|pinnedBrowser" src/cli/crawl-dom-latest.js
git diff -- src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js
git diff --stat -- src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js test/crawl-dom-latest-step-helpers.test.js
git status --short src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js test/crawl-dom-latest-step-helpers.test.js docs/passes/README.md
sed -n '1,220p' docs/passes/README.md
TZ=America/New_York date '+%Y-%m-%d_%H-%M-%S'
```

Validation and local checks:

```bash
node --check src/cli/crawl-dom-latest.js
node --check src/cli/crawl-dom-latest.step-helpers.js
node --check test/crawl-dom-latest-step-helpers.test.js
node --test test/crawl-dom-latest-step-helpers.test.js
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --navigate-before-crawl
npm run inspect:storage -- validate-run --run-id 2026-03-17T04-09-24-830Z
npm run inspect:storage -- validate-run --run-id 2026-03-17T04-09-56-372Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T04-09-24-830Z/network-capture-2026-03-17T04-09-24-830Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ requestedMode:data.requestedMode, transport:data.transport, fallbackActive:data.fallbackActive, installedTargetId:data.installed?.targetId, startup:data.startup, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain }, null, 2));"
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T04-09-56-372Z/network-capture-2026-03-17T04-09-56-372Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ requestedMode:data.requestedMode, transport:data.transport, fallbackActive:data.fallbackActive, installedTargetId:data.installed?.targetId, startup:{ navigationRequestedAt:data.startup?.navigationRequestedAt, navigationCompletedAt:data.startup?.navigationCompletedAt, capturedCount:data.startup?.capturedCount, normalizedCandidates:data.startup?.normalizedCandidates, graphQlRequestCount:data.startup?.graphQlRequestCount, firstRequestTimestamp:data.startup?.firstRequestTimestamp, firstResponseTimestamp:data.startup?.firstResponseTimestamp }, finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain }, null, 2));"
```

## 4. Old Bootstrap Shape Vs New Bootstrap Shape

### Old shape

The top of `crawl-dom-latest.js` mixed several bootstrap responsibilities inline:

1. parse network mode into one local
2. build a large mutable `networkCapture` object inline
3. derive fallback/debug flags directly in that object
4. expose three separate pinned-target wrappers:
   - `getPinnedBrowserTargetId()`
   - `runBrowserForPinnedTarget(...)`
   - `evaluateJsonForPinnedTarget(...)`
5. branch inline between page-context install and CDP install
6. later branch again inside startup navigation for:
   - CDP startup arming
   - pinned navigation
   - page-context reinstall after navigation
7. mutate `startupNetworkDrain` separately from install/bootstrap

The behavior was correct, but understanding the collector bootstrap required following state and control flow across several small helpers that only made sense together.

### New shape

The collector bootstrap now reads as one explicit sequence:

1. create `networkCapture` session state with `createNetworkCaptureSessionState(...)`
2. derive one `networkCaptureBootstrap` plan with `createNetworkCaptureBootstrapPlan(...)`
3. create one `pinnedBrowser` boundary with `createPinnedBrowserSession(...)`
4. `bootstrapCollectorSession()`
   - install the requested transport via `installRequestedNetworkCaptureTransport()`
   - run optional startup navigation via `navigateBeforeCrawlIfRequested()`
   - return one stable `startupNetworkDrain`
5. enter the crawl loop

That leaves the top of the file with one explicit session-bootstrap story before the active crawl begins.

## 5. Logic / State Removed Or Collapsed

Collapsed:

- the inline `networkCapture` bootstrap object into `createNetworkCaptureSessionState(...)`
- the setup decision tree into `createNetworkCaptureBootstrapPlan(...)`
- the pinned-target wrappers into one `pinnedBrowser` session helper
- the install branch into one explicit transport dispatcher:
  - `installPageContextCaptureTransport()`
  - `installCdpNetworkCaptureTransport()`
  - `installRequestedNetworkCaptureTransport()`
- the mutable `startupNetworkDrain = empty; startupNetworkDrain = await ...` pattern into one `const startupNetworkDrain = await bootstrapCollectorSession()`

Deleted from `crawl-dom-latest.js`:

- `getPinnedBrowserTargetId()`
- `runBrowserForPinnedTarget(...)`
- `evaluateJsonForPinnedTarget(...)`

Made more explicit:

- whether startup navigation should arm CDP before navigation
- whether startup navigation should reinstall page-context after navigation
- that pinned `navigate`, `wait`, and `evaluate` all resolve target id through the same boundary
- that install decisions come from one bootstrap plan instead of being re-derived in multiple branches

Bootstrap invariants after this pass:

1. Session state is created once, before install, from one helper.
2. Transport install behavior comes from one explicit bootstrap plan, not scattered conditionals.
3. All pinned browser actions route through the same target-id resolver.
4. `--navigate-before-crawl` stays explicit and always runs through one startup-navigation boundary.
5. CDP startup capture is armed only when the bootstrap plan says it should be.
6. Page-context reinstall after navigation only happens when the bootstrap plan says it should.

No artifact or top-level summary field changed materially in this pass. The change is in bootstrap structure, not output contract.

## 6. Test Coverage Added Or Updated

Added coverage in `test/crawl-dom-latest-step-helpers.test.js` for:

- session-state initialization for explicit fallback/debug mode
- bootstrap-plan semantics for:
  - default CDP bootstrap
  - explicit page-context fallback/debug bootstrap
  - disabled network capture plus explicit startup navigation
- pinned browser session routing so `run(...)` and `evaluate(...)` share one target-id boundary

Preserved by existing focused suites:

- `test/network-capture.test.js`
  - transport parsing and page-context fallback contract
  - capture envelope shaping and summary behavior
- `test/cdp-network-capture.test.js`
  - target pinning helper behavior
  - startup timestamps and startup-window filtering
  - idle/drain correctness
- `test/crawl-dom-network-integration.test.js`
  - exact/fuzzy/late-drain merge behavior stayed untouched by the bootstrap cleanup

Results:

- helper bootstrap/orchestration tests: `6/6` passing
- focused capture/orchestration suite: `31/31` passing
- full suite: `107/107` passing

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

- `2026-03-17T04-09-24-830Z`

Observed result:

- `networkCapture.requestedMode = "cdp"`
- `networkCapture.transport = "cdp"`
- `networkCapture.fallbackActive = false`
- `networkCapture.installed.targetId = "BDCF9B52327BAA44E7CF66DEB2903CF7"`
- `networkCapture.startup.navigationRequestedAt = null`
- `networkCapture.summary.capturedCount = 1`
- `networkCapture.integration.mergedPosts = 1`
- `networkCapture.integration.recoveredIdentityCount = 1`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T04-09-24-830Z`
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

- `2026-03-17T04-09-56-372Z`

Observed result:

- `networkCapture.requestedMode = "cdp"`
- `networkCapture.transport = "cdp"`
- `networkCapture.fallbackActive = false`
- `networkCapture.installed.targetId = "BDCF9B52327BAA44E7CF66DEB2903CF7"`
- `networkCapture.startup.navigationRequestedAt = "2026-03-17T04:09:58.406Z"`
- `networkCapture.startup.navigationCompletedAt = "2026-03-17T04:10:08.456Z"`
- `networkCapture.startup.capturedCount = 2`
- `networkCapture.startup.normalizedCandidates = 7`
- `networkCapture.startup.graphQlRequestCount = 16`
- `networkCapture.startup.firstRequestTimestamp = "2026-03-17T04:10:00.540Z"`
- `networkCapture.startup.firstResponseTimestamp = "2026-03-17T04:10:00.851Z"`
- `networkCapture.summary.capturedCount = 3`
- `networkCapture.integration.mergedPosts = 4`
- `networkCapture.integration.recoveredIdentityCount = 1`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T04-09-56-372Z`
- result: healthy, `issues = []`

Artifact inspection confirmed:

- the written artifact kept the same `requestedMode` / `transport` / `fallbackActive` contract
- the installed target id matched the active Facebook tab for both runs
- startup stayed zeroed when navigation was not requested
- startup gained real navigation timestamps and startup-window counts when `--navigate-before-crawl` was used

## 8. Risks Or Remaining Complexity

- `crawl-dom-latest.js` still has justified imperative complexity around live browser timing:
  - controller idle waits
  - network drains
  - late-drain safety passes
  - controller refresh after real browser activity
- dual transport handling is still real complexity because `page_context` remains a supported explicit fallback/debug mode
- the bootstrap helpers improved readability, but there is still no end-to-end unit test for the full CLI bootstrap; the main protection remains focused helper tests plus live validation
- setup failures are still reported through runtime state mutation because the CLI needs to keep running honestly after transport install problems

## 9. Recommendation For The Next Simplification Pass

Take the next narrow pass at the live network session operations in `crawl-dom-latest.js`:

- `settleNetworkCaptureEvents(...)`
- `drainNetworkCapture(...)`
- `drainNetworkCaptureToCompletion(...)`
- controller-state refresh around those drains

That is now the main remaining transport-specific reasoning hotspot between the cleaned bootstrap and the cleaned finalization path.

# Fallback Transport Decision Simplification Pass

## 1. Scope

Narrow simplification pass for the remaining explicit `page_context` fallback/debug transport branching in the active `crawl:dom` collector.

Goals:

- decide whether `page_context` still earns its cost in the active crawl path
- simplify the active collector path based on that decision
- preserve current CDP-first network recovery behavior, startup capture semantics, and artifact/final-drain correctness

Explicit non-goals:

- no parser rewrite
- no resolver redesign
- no CDP semantic redesign
- no storage or queue redesign
- no collection/processing boundary changes
- no frontend or legacy collector cleanup outside this transport decision

## 2. Files Changed

- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.step-helpers.js`
- `src/browser/network-capture.js`
- `test/network-capture.test.js`
- `test/crawl-dom-latest-step-helpers.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-17_10-35-10_FALLBACK_TRANSPORT_DECISION_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and source-of-truth reads:

```bash
git status --short
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,220p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,240p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_23-45-46_NETWORK_CAPTURE_FINALIZATION_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-17_00-09-42_NETWORK_CAPTURE_SETUP_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-17_10-02-59_NETWORK_CAPTURE_LIVE_SESSION_SIMPLIFICATION_PASS.md
```

Code and test reads:

```bash
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '261,620p' src/cli/crawl-dom-latest.js
sed -n '621,1040p' src/cli/crawl-dom-latest.js
sed -n '1,340p' src/cli/crawl-dom-latest.step-helpers.js
sed -n '1,340p' src/browser/network-capture.js
sed -n '1,320p' src/browser/cdp-network-capture.js
sed -n '1,260p' src/core/browser-pipeline.js
sed -n '1,260p' test/network-capture.test.js
sed -n '1,320p' test/cdp-network-capture.test.js
sed -n '1,340p' test/crawl-dom-latest-step-helpers.test.js
sed -n '1,520p' test/crawl-dom-network-integration.test.js
rg -n "page_context|PRIMARY_NETWORK_CAPTURE_MODE|FALLBACK_NETWORK_CAPTURE_MODE|network-capture-mode|parseNetworkCaptureMode|createFacebookNetworkCaptureDrainFn|createFacebookNetworkCaptureInstallFn|fallbackActive|fallbackReason" src/cli/crawl-dom-latest.js src/cli/crawl-dom-latest.step-helpers.js src/browser/network-capture.js src/browser/cdp-network-capture.js src/core/browser-pipeline.js test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-latest-step-helpers.test.js test/crawl-dom-network-integration.test.js README.md docs/PIPELINE.md
rg -n "createFacebookNetworkCaptureInstallFn|createFacebookNetworkCaptureDrainFn|parseNetworkCaptureMode\\(|FALLBACK_NETWORK_CAPTURE_MODE|page_context|network-capture-mode" src test docs README.md package.json
sed -n '680,1045p' src/browser/network-capture.js
nl -ba src/cli/crawl-dom-latest.js | sed -n '1,240p'
nl -ba src/cli/crawl-dom-latest.js | sed -n '300,720p'
nl -ba src/cli/crawl-dom-latest.step-helpers.js | sed -n '1,420p'
nl -ba src/browser/network-capture.js | sed -n '1,120p'
```

Validation and CLI checks:

```bash
node --check src/cli/crawl-dom-latest.js
node --check src/cli/crawl-dom-latest.step-helpers.js
node --check src/browser/network-capture.js
node --check test/network-capture.test.js
node --check test/crawl-dom-latest-step-helpers.test.js
node src/cli/crawl-dom-latest.js --help
node src/cli/crawl-dom-latest.js --network-capture-mode page_context
node --test test/network-capture.test.js test/cdp-network-capture.test.js test/crawl-dom-network-integration.test.js test/crawl-dom-latest-step-helpers.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-17T14-34-27-335Z
node -e "const fs=require('node:fs'); const p='data/raw/facebook/williamsburggreenpointhousing/2026-03-17T14-34-27-335Z/network-capture-2026-03-17T14-34-27-335Z.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({ transport:data.transport, hasRequestedMode:Object.hasOwn(data,'requestedMode'), hasFallbackActive:Object.hasOwn(data,'fallbackActive'), hasFallbackReason:Object.hasOwn(data,'fallbackReason'), finalDrain:data.finalDrain, finalArtifactDrain:data.finalArtifactDrain, summary:data.summary, graphQlRequestSummary:data.graphQlRequestSummary, startup:data.startup }, null, 2));"
TZ=America/New_York date '+%Y-%m-%d_%H-%M-%S'
```

## 4. Decision: Keep-And-Isolate Vs Remove

Decision: remove `page_context` from the active `crawl:dom` path.

`crawl:dom` is now CDP-only when network capture is enabled. The old `--network-capture-mode` fallback/debug flag now errors clearly, and the in-page shim install/drain runtime was removed from the active collector codebase rather than left behind as dead negotiation.

## 5. Evidence For That Decision

Evidence that `page_context` no longer earned its cost:

- repo search showed no active consumer outside `crawl-dom-latest.js`, its helper file, and transport-specific tests
- the fallback did not protect another CLI, service, or shared lower-level browser surface
- `page_context` could not provide the one transport-specific operator value that still matters: pre-navigation startup capture
- keeping it alive still forced top-level branching in:
  - CLI parsing/help
  - session bootstrap planning
  - transport install
  - drain dispatch
  - post-navigation behavior
  - artifact/run-summary/stdout transport metadata
- existing tests mainly proved that the fallback could still be selected, not that it materially protected against a real CDP failure mode in this repo

Evidence that removal was safe:

- focused transport/helper/integration tests passed after removing the fallback path
- `npm test` stayed green
- a bounded live CDP run completed successfully
- `validate-run` stayed healthy
- the final network artifact still ended with zero `remainingBuffered`, `pendingRequests`, and `inFlightBodyReads`

## 6. Logic / State Removed Or Collapsed

Removed:

- `--network-capture-mode` from the active `crawl:dom` CLI
- the page-context install branch from `crawl-dom-latest.js`
- the page-context drain branch from `crawl-dom-latest.js`
- the post-navigation page-context reinstall branch
- `parseNetworkCaptureMode(...)`
- `FALLBACK_NETWORK_CAPTURE_MODE`
- `createFacebookNetworkCaptureInstallFn(...)`
- `createFacebookNetworkCaptureDrainFn(...)`
- the in-page install/drain runtime that only existed to support that fallback

Collapsed:

- session state no longer carries `requestedMode`, `fallbackActive`, or `fallbackReason`
- bootstrap planning no longer carries `installTransport` or `reinstallsPageContextAfterNavigation`
- artifact/run-summary/stdout payloads no longer carry the old negotiation-only fields above
- transport install now reads as one explicit CDP install boundary instead of a dispatcher over two transports

Old active-path shape:

1. parse transport mode
2. build session state with requested/fallback metadata
3. branch between CDP install and page-context install
4. branch between controller drain and in-page drain
5. branch again during startup navigation for page-context reinstall
6. carry requested/fallback metadata through artifact, run summary, and stdout output

New active-path shape:

1. reject the removed fallback flag with a clear CLI error
2. build one CDP-oriented session state
3. install CDP if network assist is enabled
4. use one controller-backed drain path
5. optionally arm startup capture before navigation
6. emit transport output without dead negotiation metadata

## 7. Test Coverage Added Or Updated

Updated:

- `test/crawl-dom-latest-step-helpers.test.js`
  - session-state coverage now locks the smaller CDP-only session shape
  - bootstrap-plan coverage now locks the smaller CDP-only startup-navigation contract
  - finalization coverage now locks artifact/run-summary/stdout output without `requestedMode`, `fallbackActive`, or `fallbackReason`
- `test/network-capture.test.js`
  - removed the now-obsolete transport-mode parsing coverage

Preserved by existing focused suites:

- `test/cdp-network-capture.test.js`
  - CDP drain semantics
  - idle waiting
  - in-flight body-read accounting
  - startup request window filtering
- `test/crawl-dom-network-integration.test.js`
  - network-first recovery remains transport-agnostic once envelopes are captured
  - late same-step recovery still happens before persistence

Results:

- focused transport/crawl suite: `32/32` passing
- full suite: `109/109` passing

## 8. Live Validation Run(s)

### 8.1 CLI/help validation after removal

- `node src/cli/crawl-dom-latest.js --help`
  - help now documents CDP-only network capture plus `--disable-network-capture`
- `node src/cli/crawl-dom-latest.js --network-capture-mode page_context`
  - now exits with a clear removal message instead of silently ignoring the old flag

### 8.2 Default bounded crawl

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

- `2026-03-17T14-34-27-335Z`

Observed result:

- `collected = 5`
- `freshCollected = 0`
- `seenCollected = 5`
- `unidentifiedCollected = 0`
- `withIds = 5`
- `networkCapture.transport = "cdp"`
- `networkCapture.summary.capturedCount = 1`
- `networkCapture.integration.mergedPosts = 1`
- `networkCapture.integration.recoveredIdentityCount = 1`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-17T14-34-27-335Z`
- result: healthy, `issues = []`

Artifact inspection confirmed:

- `requestedMode`, `fallbackActive`, and `fallbackReason` are absent
- `finalDrain.remainingBuffered = 0`
- `finalDrain.pendingRequests = 0`
- `finalDrain.inFlightBodyReads = 0`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`

## 9. Risks Or Remaining Complexity

- CDP still depends on OpenClaw relay readiness plus an attached Chrome tab/profile. That dependency is real, but it is now explicit instead of masked by a second crawl transport.
- The Facebook-specific resolver/match/reuse logic in `crawl-dom-latest.network-integration.js` remains the biggest justified collector complexity. It is still carrying conservative exact/fuzzy/duplicate behavior that protects correctness.
- Startup capture plus pinned-target orchestration is still justified complexity because it is the only way the collector can truthfully claim startup GraphQL visibility.

The remaining transport risk is no longer “which transport are we really running?” It is the simpler and more honest question: “is CDP available right now, or should the operator rerun without network assist?”

## 10. Recommendation For The Next Simplification Pass

Take the next narrow pass at the remaining Facebook-specific identity merge/reuse cluster in `crawl-dom-latest.network-integration.js`.

Reason:

- transport choice is now settled
- live drain/bootstrap/finalization are already smaller
- the main remaining collector complexity is the conservative exact/fuzzy/duplicate reuse logic and the provenance it carries

That next pass should simplify the resolver/readability story without weakening the conservative recovery behavior that this transport-decision cleanup preserved.

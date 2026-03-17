# Pre-Navigation CDP Capture Corrective Pass

## Scope

Address Anscombe's review findings on the first CDP pre-navigation capture pass without widening into a broader browser-control redesign.

Findings addressed in this pass:

- async CDP body reads could miss the drain/artifact window
- controller and crawl navigation could silently diverge across tabs
- startup request telemetry was only lower-bounded and could include later scroll traffic
- startup envelope summaries were derived from the final retained ring buffer instead of a stable startup snapshot

## Files Changed

- `src/browser/cdp-network-capture.js`
- `src/core/browser-pipeline.js`
- `src/cli/crawl-dom-latest.js`
- `test/cdp-network-capture.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md`

## What Changed

### 1. Drains now account for in-flight body reads and pending requests

In `src/browser/cdp-network-capture.js`:

- `loadingFinished` now registers each async `Network.getResponseBody` read in `pendingBodyReads`
- drain state now reports:
  - `remainingBuffered`
  - `pendingRequests`
  - `inFlightBodyReads`
  - `remaining`
- the controller now exposes `waitForIdle(...)` so the crawl loop can wait on real transport state instead of a blind sleep

In `src/cli/crawl-dom-latest.js`:

- CDP drains now wait for a fresh idle window and for in-flight body reads to settle
- drain completion no longer stops just because a pass captured zero items
- the crawl performs a final `final-artifact-flush` drain before writing artifacts

This closes the high-severity race where a response body could finish just after a drain and never make it into the written artifact.

### 2. Browser commands are now pinned to the same target as the CDP controller

In `src/core/browser-pipeline.js`:

- added `appendBrowserTargetId(...)`
- `evaluateJson(...)` now accepts an optional `targetId`

In `src/cli/crawl-dom-latest.js`:

- `navigate`
- `wait`
- `evaluate`

all now run against the controller-selected `targetId` when CDP capture is active.

This closes the multi-tab mismatch where capture could attach to one tab while the crawl navigated and evaluated another.

### 3. Startup telemetry is now scoped to a real startup window

The earlier pass treated startup requests as "anything after navigation started".

Now:

- startup request telemetry is snapshotted between:
  - `navigationRequestedAt`
  - `captureCompletedAt`
- a stable `startupGraphQlRequests` snapshot is stored immediately after the startup drain completes

Result:

- later `after-scroll` feed traffic is no longer mislabeled as startup

### 4. Startup envelope summaries are now derived from a stable startup snapshot

Instead of recomputing startup summaries from the final retained `items` ring buffer, the crawl now stores:

- `startupItems`
- `startupGraphQlRequests`

at startup time.

Result:

- later retained-item drops or later drains no longer rewrite startup reporting

## Tests Added / Updated

### `test/cdp-network-capture.test.js`

- delayed body reads keep `remaining > 0` until the envelope is actually stored
- startup request filtering now applies both start and end timestamps
- target pinning injects `--target-id` into browser subcommand args
- idle waiting observes a fresh quiet window instead of returning immediately on stale pre-navigation activity

## Commands Run

### Validation

- `node --check src/core/browser-pipeline.js`
- `node --check src/browser/cdp-network-capture.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node --test test/cdp-network-capture.test.js`
- `node --test test/network-capture.test.js`
- `node --test test/crawl-dom-network-integration.test.js`
- `npm test`

### Live validation

- `openclaw browser navigate --help`
- `openclaw browser wait --help`
- `openclaw browser evaluate --help`
- `openclaw browser --browser-profile chrome navigate about:blank`
- `openclaw browser --browser-profile chrome wait --time 1500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-capture-mode cdp --navigate-before-crawl`
- `jq ... data/raw/facebook/williamsburggreenpointhousing/2026-03-16T14-58-58-454Z/network-capture-2026-03-16T14-58-58-454Z.json`

## Test Result

- `npm test`: `90/90` passing

## Live Validation

### Final run

- `2026-03-16T14-58-58-454Z`

Important results:

- transport remained `cdp`
- target stayed pinned to `BDCF9B52327BAA44E7CF66DEB2903CF7`
- startup timestamps were populated:
  - `firstRequestTimestamp = 2026-03-16T14:59:02.433Z`
  - `firstResponseTimestamp = 2026-03-16T14:59:02.759Z`
- overall captured envelopes: `3`
- overall GraphQL request summary: `15`
- startup GraphQL request summary: `13`
- startup inspectable request count: `1`
- startup captured envelopes: `1`
- `finalArtifactDrain.remainingBuffered = 0`
- `finalArtifactDrain.pendingRequests = 0`
- `finalArtifactDrain.inFlightBodyReads = 0`
- `finalArtifactDrain.settleTimedOut = false`

## Before / After

Before this corrective pass:

- startup GraphQL summaries could include later `after-scroll` feed requests
- startup summaries were recomputed from the final retained buffer
- drains could miss async response bodies
- controller/DOM commands were not explicitly pinned to the same target

After this corrective pass:

- startup request telemetry is snapshot-scoped to the real startup window
- startup envelope summaries are stable snapshots
- final artifact flush confirms no pending/in-flight CDP work remains
- browser control and CDP capture run on the same explicit target

Concrete example from the final run:

- overall GraphQL summary still includes `GroupsCometFeedRegularStoriesPaginationQuery` (`doc_id=26731644009775127`, count `2`)
- startup GraphQL summary no longer includes that feed query at all
- startup summary now correctly reflects only the earlier burst, dominated by messenger/config queries plus `useGroupsCometVisitMutation`

## Remaining Limitation

The corrective pass fixed the accounting and tab-binding problems, but it did not change the recovery outcome in the bounded Williamsburg run:

- `recoveredIdentityCount` remained `0`
- the startup burst still produced only one startup envelope, `useGroupsCometVisitMutation`
- the story-bearing `GroupsCometFeedRegularStoriesPaginationQuery` envelopes still arrived in the first scroll phase, not the startup drain

## Recommendation

This CDP path is now correct enough to treat as a real capture primitive.

The next useful pass is no longer "fix the CDP plumbing"; it is:

1. run the corrected CDP startup path against a window known to contain top-slice weak-identity posts
2. decide whether `cdp + --navigate-before-crawl` should become the default Facebook capture mode
3. only after that, decide whether to simplify the current blocking OpenClaw control path with a more async-friendly browser-control layer

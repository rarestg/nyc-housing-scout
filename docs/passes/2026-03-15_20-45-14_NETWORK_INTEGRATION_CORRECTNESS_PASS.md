# Network Integration Correctness Pass

## Scope

Tight cleanup pass on the first network-first crawl integration:

- allow recovered network candidates to be reused across overlapping DOM copies
- reset page-context capture budget/counters cleanly on reinstall
- close the terminating-drain identity gap without adding storage backpatch machinery

This pass explicitly did **not** take on pre-navigation/CDP capture.

## Files Changed

- `src/browser/network-capture.js`
- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.network-integration.js`
- `test/network-capture.test.js`
- `test/crawl-dom-network-integration.test.js`

## What Changed

### 1. Candidate reuse fix

- Removed the one-shot `consumed` behavior from crawl-time network candidates.
- Added a small shared network-integration helper so matching/merge logic is testable without a live browser.
- Result: later overlapping DOM copies can reuse the same recovered identity and collapse onto the same `postId` key instead of falling through as a second provisional observation.

### 2. Reinstall reset fix

- Added explicit helpers for installed capture state creation/reset.
- Reinstall now clears:
  - buffered `items`
  - `nextSequence`
  - `captured`
  - `fetchCandidates`
  - `xhrCandidates`
  - `responsesInspected`
  - `fullTextCaptured`
  - `fullTextBudgetExhausted`
  - other run-scoped counters
- Reinstall preserves the underlying fetch/XHR patch state and increments `installCalls`.

### 3. Terminating-drain merge fix

- Reworked `crawl-dom-latest` so DOM posts that still lack `postId` are staged as deferred provisional entries for the rest of the step.
- The crawl now drains network again at the end of the step (`after-scroll`, `before-finalize`, or `before-target-stop`) and only then finalizes those deferred provisional posts.
- The old post-loop `final` drain no longer acts as a half-integrated normalization/export path after persistence. The artifact now records the last real drain that happened before finalization.

## Regression Tests Added

- `test/network-capture.test.js`
  - reinstall reset clears run-scoped counters, buffer, and sequence state
- `test/crawl-dom-network-integration.test.js`
  - recovered candidates remain reusable across overlapping DOM copies
  - deferred provisional entries can absorb a later drain before finalization

## Commands Run

### Verification

- `node --check src/browser/network-capture.js`
- `node --check src/cli/crawl-dom-latest.network-integration.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node --test test/network-capture.test.js`
- `node --test test/crawl-dom-network-integration.test.js`
- `npm test`

### Live validation

- `openclaw browser --browser-profile chrome --json status`
- `openclaw browser --browser-profile chrome --json tabs`
- `openclaw browser --browser-profile chrome navigate "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"`
- `openclaw browser --browser-profile chrome wait --time 2500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-max-full-text-envelopes 2`
- `openclaw browser --browser-profile chrome navigate "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"`
- `openclaw browser --browser-profile chrome wait --time 2500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-max-full-text-envelopes 2`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-max-full-text-envelopes 2`
- `openclaw browser --browser-profile chrome navigate "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"`
- `openclaw browser --browser-profile chrome wait --time 2500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 999 --max-scrolls 15 --network-target-group-id 2664056243718928`

## Live Run IDs

- `2026-03-16T00-39-53-822Z`
- `2026-03-16T00-40-35-453Z`
- `2026-03-16T00-41-21-173Z`
- `2026-03-16T00-42-09-876Z`

## Before / After

### Candidate reuse / Pamela duplicate

Before:

- Run `2026-03-16T00-07-20-690Z` produced both:
  - `obs_000964` with recovered `platformPostId=24495759786788593`
  - `obs_000965` as a second later `unidentified` Pamela copy
- Collected export also contained:
  - one Pamela row with `postId=24495759786788593`
  - one second Pamela row with `postId=null`

After:

- Run `2026-03-16T00-42-09-876Z` still recovered Pamela at `obs_001017` with:
  - `platformPostId=24495759786788593`
  - `matchedCaptureId=netcap_0006`
  - `matchedPhase=after-scroll`
  - `identityRecovered=true`
- The same run has only two `unidentified` observations, both `Holyn Thigpen`.
- There is no second Pamela provisional observation in the run or collected export.

### Budget reset

Sequential bounded runs in the same Chrome session:

- `2026-03-16T00-39-53-822Z`
  - `summary.byCaptureMode.full_text = 2`
  - `finalStats.fullTextCaptured = 2`
  - `finalStats.fullTextBudgetExhausted = 0`
- `2026-03-16T00-40-35-453Z`
  - `summary.byCaptureMode.full_text = 2`
  - `finalStats.fullTextCaptured = 2`
  - `finalStats.fullTextBudgetExhausted = 0`

Reinstall-path reset check:

- `2026-03-16T00-41-21-173Z`
  - `installed.reinstalled = true`
  - `finalStats.captured = 0`
  - `finalStats.fullTextCaptured = 0`
  - `finalStats.fullTextBudgetExhausted = 0`
  - `finalStats.resetAt = 2026-03-16T00:41:22.105Z`

This confirmed the run-scoped counters were reset instead of inheriting the prior run’s exhausted state.

## Final-Drain Decision

I chose restructure over backpatch:

- provisional DOM posts now wait for the late step drain before classification
- the old post-persistence `final` drain is gone as an integration path
- already-identified posts are still persisted immediately, so this pass closes the identity gap without adding storage mutation logic

## Remaining Limitations

- Startup traffic is still missed because capture still begins after page-context installation.
- Already-identified DOM posts are not back-enriched if a richer network payload arrives later in the same run; this pass only closed the identity-classification gap for provisional posts.
- Top-slice Holyn-style cases remain limited by the page-context startup blind spot.

## Next Pass

Highest-value next step remains pre-navigation capture below page context:

- register capture before navigation via CDP or an init-script equivalent
- preserve the current request-side hint extraction if it still adds value
- revalidate top-of-feed unidentified cases once first-load traffic is visible

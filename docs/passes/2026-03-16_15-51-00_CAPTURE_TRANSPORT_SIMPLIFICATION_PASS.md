# Capture Transport Simplification Pass

## 1. Scope

Narrow simplification pass for the active Facebook DOM crawl path:

- make `cdp` the canonical/default network transport
- keep `page_context` available only as explicit fallback/debug
- remove the peer-style `auto` transport negotiation from the active crawl path
- keep the existing parser, normalizer, resolver, merge, storage, and artifact flow intact

Explicit non-goals for this pass:

- no parser or normalizer rewrite
- no resolver redesign
- no queue or storage redesign
- no change to the default `--navigate-before-crawl` behavior
- no removal of `page_context` entirely

## 2. Files Changed

- `src/browser/network-capture.js`
- `src/cli/crawl-dom-latest.js`
- `test/network-capture.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and code reads:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,260p' docs/ROADMAP.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,220p' docs/passes/README.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_15-40-04_TARGETED_STARTUP_RECOVERY_VALIDATION_PASS.md
sed -n '1,260p' src/browser/cdp-network-capture.js
sed -n '1,320p' src/browser/network-capture.js
sed -n '1,260p' src/browser/facebook-response-parser.js
sed -n '1,260p' src/browser/facebook-post-normalizer.js
sed -n '1,280p' src/cli/crawl-dom-latest.js
sed -n '280,760p' src/cli/crawl-dom-latest.js
sed -n '760,980p' src/cli/crawl-dom-latest.js
sed -n '1,320p' src/cli/crawl-dom-latest.network-integration.js
sed -n '320,760p' src/cli/crawl-dom-latest.network-integration.js
sed -n '1,260p' src/core/browser-pipeline.js
sed -n '1,260p' test/cdp-network-capture.test.js
sed -n '1,320p' test/network-capture.test.js
sed -n '1,240p' test/crawl-dom-network-integration.test.js
rg -n "network-capture-mode|page_context|cdp|auto|navigate-before-crawl|transport" src/cli/crawl-dom-latest.js src/core/browser-pipeline.js src/cli/crawl-dom-latest.network-integration.js test/cdp-network-capture.test.js test/network-capture.test.js test/crawl-dom-network-integration.test.js
git status --short
```

Validation and local checks:

```bash
node --check src/browser/network-capture.js
node --check src/cli/crawl-dom-latest.js
node src/cli/crawl-dom-latest.js --help
node --test test/network-capture.test.js
node --test test/cdp-network-capture.test.js
node --test test/crawl-dom-network-integration.test.js
npm test
```

Browser state and live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-capture-mode page_context
npm run inspect:storage -- validate-run --run-id 2026-03-16T19-49-50-140Z
npm run inspect:storage -- validate-run --run-id 2026-03-16T19-50-18-329Z
```

## 4. What Was Simplified

### 4.1 Removed peer-style transport negotiation from the active crawl path

Before this pass:

- `crawl-dom-latest.js` defaulted `--network-capture-mode` to `auto`
- runtime install logic treated `cdp` and `page_context` as co-equal peers
- the default path silently tried CDP first and then fell back to page-context if CDP install failed

After this pass:

- the crawl defaults directly to `cdp`
- `auto` is no longer part of the active mental model; it is only normalized as a compatibility alias to `cdp`
- page-context is entered only when explicitly requested via `--network-capture-mode page_context`

### 4.2 Centralized mode parsing

`src/browser/network-capture.js` now owns the allowed transport modes and mode normalization. That removes repeated stringly-typed mode handling from the crawl CLI and makes the default/fallback choice explicit in one place.

### 4.3 Made fallback state visible in run metadata

The crawl summary and `network_capture_export` artifact now include:

- `requestedMode`
- `transport`
- `fallbackActive`
- `fallbackReason`

That makes the hierarchy explicit in runtime output instead of relying on readers to infer it from transport-specific stats.

### 4.4 Added CLI help for the transport story

`crawl-dom-latest.js --help` now tells the operator:

- `cdp` is the default
- `page_context` is the explicit fallback/debug path
- `--navigate-before-crawl` remains explicit and only affects CDP startup capture

## 5. Default/Fallback Behavior After The Change

- Default `crawl:dom` network transport: `cdp`
- Explicit fallback/debug transport: `--network-capture-mode page_context`
- If default CDP install fails, the crawl now records the CDP error and disables network capture instead of silently changing transports
- `--navigate-before-crawl` is still opt-in; it is not the default and it still only matters for CDP
- `page_context` still works, but it remains a deliberate fallback/debug choice and not part of the default transport negotiation

## 6. Tests Run

- `node --check src/browser/network-capture.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node src/cli/crawl-dom-latest.js --help`
- `node --test test/network-capture.test.js`
- `node --test test/cdp-network-capture.test.js`
- `node --test test/crawl-dom-network-integration.test.js`
- `npm test`

Results:

- `test/network-capture.test.js`: `6/6` passing
- `test/cdp-network-capture.test.js`: `8/8` passing
- `test/crawl-dom-network-integration.test.js`: `11/11` passing
- `npm test`: `91/91` passing

## 7. Live Validation Runs

### 7.1 Default canonical transport run

- Run id: `2026-03-16T19-49-50-140Z`
- Command used the simplified default transport selection with no explicit `--network-capture-mode`
- Result:
  - `networkCapture.requestedMode = "cdp"`
  - `networkCapture.transport = "cdp"`
  - `networkCapture.fallbackActive = false`
  - captured envelope count: `1`
  - normalized candidates: `8`
  - merged posts: `0`
- `validate-run`: healthy with no issues

### 7.2 Explicit fallback/debug run

- Run id: `2026-03-16T19-50-18-329Z`
- Command used `--network-capture-mode page_context`
- Result:
  - `networkCapture.requestedMode = "page_context"`
  - `networkCapture.transport = "page_context"`
  - `networkCapture.fallbackActive = true`
  - `networkCapture.fallbackReason = "explicit_mode_request"`
  - captured envelope count: `1`
  - normalized candidates: `5`
  - merged posts: `0`
- `validate-run`: healthy with no issues

## 8. Risks Or Limitations

- This pass intentionally did not simplify the network identity resolver state machine. The transport decision is clearer, but the Pamela/Alison-era resolver sediment is still there.
- Inline listing extraction still runs during collection. That remains a separate simplification opportunity and was intentionally left untouched here.
- `auto` is still accepted as a compatibility alias to `cdp` even though it is no longer documented. That keeps old invocations from breaking while removing it from the active architecture story.
- Page-context fallback remains operational but still has its inherent limitation: it cannot see pre-navigation startup traffic.

## 9. Recommendation For The Next Simplification Pass

Take the next pass at the collection/processing boundary:

- remove transitional inline listing extraction from `capture:dom` / `crawl:dom`
- let collection end cleanly at observations + artifacts + run summaries
- leave listing creation to the queue/processing stage, which is already the documented intended boundary

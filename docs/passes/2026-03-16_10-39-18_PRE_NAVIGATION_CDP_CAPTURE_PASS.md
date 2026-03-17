# Pre-Navigation CDP Capture Pass

## Scope

Add a real pre-navigation capture path for Facebook GraphQL traffic inside the existing crawl pipeline, validate it live against Williamsburg, and determine whether removing the startup blind spot materially improves early recovery.

Non-goals for this pass:

- no parser/normalizer redesign
- no resolver redesign
- no queue/storage changes
- no broader crawl-strategy redesign

## Files Changed

- `src/browser/cdp-network-capture.js`
- `src/core/browser-pipeline.js`
- `src/cli/crawl-dom-latest.js`
- `test/cdp-network-capture.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md`

## Capture Point Decision

Chosen approach: CDP-level network capture through the existing OpenClaw relay, armed before `navigate`.

Why this was the best fit here:

- it can see first-load traffic before page JavaScript runs
- it fits the current OpenClaw-attached browser workflow instead of introducing a separate browser stack
- it can still reuse the existing filter, envelope, parser, normalizer, and merge path
- it keeps the page-context shim as a fallback instead of forcing a risky replacement

Alternatives rejected:

- page-context `fetch` / `XMLHttpRequest` only: still inherently too late for first-load traffic
- init-script style interception: acceptable if the relay exposed it cleanly, but CDP was already available and more direct
- separate prototype/browser stack: would have widened the surface for no gain

## What Changed

### 1. Added an OpenClaw CDP network capture controller

In `src/browser/cdp-network-capture.js`:

- derives the OpenClaw relay auth token from the configured gateway token
- connects to `/cdp` before crawl navigation
- auto-attaches to the active page target
- enables `Network` for the attached page session
- converts matched GraphQL request/response pairs into the same bounded envelope shape already used by the page-context capture path
- tracks startup timing:
  - `armedAt`
  - `navigationRequestedAt`
  - `navigationCompletedAt`
  - `firstRequestTimestamp`
  - `firstResponseTimestamp`

It also logs a bounded request-side GraphQL telemetry stream, even for low-signal requests, so startup validation is possible without storing giant response bodies for everything.

### 2. Wired CDP capture into `crawl:dom`

In `src/cli/crawl-dom-latest.js`:

- added `--network-capture-mode auto|cdp|page_context`
- added `--navigate-before-crawl`
- `auto` now prefers CDP when OpenClaw is CDP-ready and falls back to the page-context shim
- when `--navigate-before-crawl` is used with CDP, the controller is armed before `openclaw browser navigate`
- startup drains are recorded separately from later `after-expand` and `after-scroll` drains
- request-side startup GraphQL telemetry is persisted into the `network_capture_export` artifact

### 3. Fixed a runtime integration bug caused by the current CLI control model

The first CDP implementation attached correctly but still logged zero startup requests in the crawl artifact.

Root cause:

- the crawl loop drives OpenClaw with synchronous `execFileSync`
- that blocks Node's event loop
- the CDP websocket cannot process queued `Network.*` events until the crawl yields

Fix:

- `crawl-dom-latest` now explicitly yields the event loop before each CDP drain and before final summary capture

This is a local fix, not a new repo-wide browser-control architecture.

## Tests Added

### `test/cdp-network-capture.test.js`

- relay token derivation matches the OpenClaw HMAC format
- startup GraphQL request/response events become stored envelopes
- low-signal GraphQL requests are skipped before response-body fetch
- request-side startup telemetry still records header-derived friendly names and doc ids

## Commands Run

### Static / unit validation

- `node --check src/core/browser-pipeline.js`
- `node --check src/browser/cdp-network-capture.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node --test test/cdp-network-capture.test.js`
- `node --test test/network-capture.test.js`
- `node --test test/crawl-dom-network-integration.test.js`
- `npm test`

### OpenClaw capability / relay validation

- `openclaw browser --help`
- `openclaw browser evaluate --help`
- `openclaw browser requests --help`
- `openclaw browser responsebody --help`
- `openclaw browser wait --help`
- `openclaw browser --browser-profile chrome --json status`
- `openclaw browser --browser-profile chrome --json tabs`
- ad hoc `node --input-type=module` relay probes against `ws://127.0.0.1:<cdpPort>/cdp?token=...`

### Live validation

- `openclaw browser --browser-profile chrome navigate about:blank`
- `openclaw browser --browser-profile chrome wait --time 1500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928 --network-capture-mode cdp --navigate-before-crawl`
- `jq ... data/raw/facebook/williamsburggreenpointhousing/<runId>/network-capture-<runId>.json`

## Validation Result

- `npm test`: `86/86` passing

## Live Runs

### Pre-fix proof of the event-loop bug

- `2026-03-16T14-33-20-903Z`

What happened:

- transport was `cdp`
- controller attached successfully
- startup fields were present
- but `graphQlRequestCount = 0`, `capturedCount = 0`, `candidatesExtracted = 0`

This was the run that proved the controller was attached but not draining queued CDP events.

### Final live validation

- `2026-03-16T14-37-41-477Z`

Key results:

- `networkCapture.transport = "cdp"`
- `networkCapture.startup.firstRequestTimestamp = 2026-03-16T14:37:45.535Z`
- `networkCapture.startup.firstResponseTimestamp = 2026-03-16T14:37:45.865Z`
- `networkCapture.startup.graphQlRequestCount = 15`
- `networkCapture.startup.graphQlInspectableCount = 3`
- `networkCapture.startup.capturedCount = 1`
- total captured envelopes for the bounded run: `3`
- total normalized candidates: `11`
- total merged posts: `2`
- `recoveredIdentityCount = 0`

## Startup Burst Findings

The startup burst is now visible on first navigation.

Observed startup request types included:

- `GroupsCometFeedRegularStoriesPaginationQuery`
- `useGroupsCometVisitMutation`
- `CometNotificationsDropdownQuery`
- `CometSearchBootstrapKeywordsDataSourceQuery`
- `MAWSecureThreadQPContainerQuery`
- `MWChatTabInThreadBannerQuery`
- `OhaiWebClientMessengerConfigsQuery`
- `MAWVerifyThreadCutover_ContactCapabilities2Query`
- `EBMessageMetadataQueryQuery`
- `FBYRPTimeLimitsEnforcementQuery`
- `fetchMWChatVideoAutoplaySettingQuery`

Observed startup doc ids included:

- `26731644009775127` (`GroupsCometFeedRegularStoriesPaginationQuery`, count `2`)
- `26160699310201928` (`useGroupsCometVisitMutation`)
- `24407836128822485`
- `24686790901001702`
- `25203298649264493`

## Captured Startup Envelopes

Startup-phase captured envelope:

- `useGroupsCometVisitMutation`
- `doc_id=26160699310201928`
- retained as `small_response_full_text`
- contained the Williamsburg target group id
- did **not** contain canonical post/story identity

The high-signal story-bearing captures in this bounded run appeared during the first scroll phase rather than the very first startup drain:

- `GroupsCometFeedRegularStoriesPaginationQuery`
- `doc_id=26731644009775127`
- retained as `high_signal_full_text`
- carried post ids including:
  - `24523300124034559`
  - `24523150620716176`
  - `24523700347327870`
  - `24525888980442340`
  - `24522412717456633`
  - `24521445867553318`
  - `24520028517695053`
  - `24521788520852386`
  - `24519600737737831`
  - `24522369640794274`
  - `24519690017728903`

## Before / After

Before the event-loop flush fix:

- startup CDP capture looked attached but produced zero request telemetry and zero envelopes

After the fix:

- startup CDP capture produced real first-load request telemetry
- startup CDP capture recorded one startup envelope immediately after navigation
- the bounded crawl captured three real CDP envelopes total
- the startup burst clearly included canonical feed GraphQL request types, not just messenger noise

## Did Startup Capture Improve Recovery?

Technical answer: yes, startup blindness is removed.

Recovery answer for this bounded Williamsburg validation: not yet materially.

What improved:

- startup GraphQL traffic is now visible and persisted
- startup request types/doc ids are now known instead of inferred
- the pipeline can capture first-load high-signal Facebook operations inside the real crawl path

What did **not** improve in this particular run:

- `recoveredIdentityCount` stayed `0`
- the two network merges were `exact_identity` enrichments on already-identified DOM posts
- the only startup-phase captured envelope was the group visit mutation, not a canonical story object

So the pass proves the missing startup traffic can now be seen and filtered, but it does **not** yet prove a new top-slice formerly-`unidentified` recovery in the bounded Williamsburg route used here.

## Architecture Assessment

No broader paradigm change is warranted yet.

What this pass says about the current architecture:

- CDP capture below page context is the right next-layer boundary for Facebook
- the existing parser/normalizer/resolver stack remains reusable
- the current synchronous OpenClaw CLI control model is workable, but it creates an integration hazard for any long-lived websocket sidecar

That last point is important:

- as long as crawl control uses blocking `execFileSync`, any live sidecar transport needs explicit event-loop yield points
- a future async browser-control surface would simplify CDP capture, but that is a later cleanup, not a prerequisite for this pass

## Remaining Limitations

- the startup burst still contains a lot of messenger / notification / config noise
- the first startup envelope we captured was group-visit metadata, not canonical story identity
- in this bounded Williamsburg run, the feed/story envelopes that mattered appeared after the first scroll rather than at `startup-after-navigate`
- no newly recovered early `unidentified` case was observed in this validation window

## Recommendation For Next Pass

Keep the CDP pre-navigation path and validate it against a run/window that is known to produce top-slice weak-identity posts.

Highest-value next steps:

1. Run a targeted live validation where the visible top slice actually contains historically problematic weak-identity cards, so startup recovery impact can be measured directly.
2. Decide whether `cdp + --navigate-before-crawl` should become the default Facebook capture path now that the relay plumbing is proven.
3. If CDP remains the default direction, consider a later cleanup that removes the current `execFileSync` event-loop hazard instead of relying on explicit yield points.

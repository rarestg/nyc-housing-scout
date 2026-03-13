# Ingest Loop Controller Pass — 2026-03-13

## Scope

This pass added one narrow explicit ingestion controller CLI over the existing browser-relay DOM crawl and queue surfaces:

- browser preflight against the attached OpenClaw tab
- deterministic navigate/reset to the requested Facebook group URL each cycle
- `crawl-dom-latest` orchestration
- fresh-only `validate:queue --freshness fresh` processing
- JSON stdout cycle summaries
- state JSON + JSONL log writing
- clean stop behavior for `SIGINT`, `SIGTERM`, stop file, `--max-cycles`, and `--max-idle-cycles`
- lightweight OpenClaw callbacks

This pass did not add a daemon, scheduler, crawl-strategy redesign, multi-source orchestration, or Gemini schema changes.

## Files Changed

- `src/core/ingest-loop.js`
- `src/cli/ingest-loop.js`
- `src/cli/crawl-dom-latest.js`
- `test/ingest-loop.test.js`
- `package.json`
- `README.md`
- `docs/PIPELINE.md`
- `data/README.md`
- `docs/passes/README.md`

## What Changed

### 1. New `ingest:loop` CLI

Added `src/cli/ingest-loop.js` and `npm run ingest:loop`.

Implementation shape stayed narrow:

- async child-process orchestration around `openclaw`, `crawl-dom-latest`, and `validate-queue`
- no refactor of crawl or queue CLIs into new libraries
- one tiny helper module for URL normalization, classification, state/log writing, and notification decisions

### 2. Preflight and deterministic reset

Each cycle now:

1. checks `openclaw browser --json status`
2. checks page-context evaluation for `title` + `href`
3. verifies the attached tab is a Facebook group page matching the requested group URL
4. resets via `openclaw browser navigate --browser-profile <profile> <group-url>`
5. waits briefly, then re-evaluates the page URL/title before crawling

No reload fallback was needed in this environment.

### 3. Fresh-only processing path

Fresh cycles call the existing queue validator path only:

```bash
node src/cli/validate-queue.js --run-id <runId> --freshness fresh --process-limit <n> --sample-limit <n>
```

To keep that scope explicit, `crawl-dom-latest` now includes `runId` in its JSON output.

### 4. Callback behavior

The spec suggested `openclaw system event --text ... --mode now`. I verified the actual CLI surface in this environment with:

```bash
openclaw system event --help
```

Supported syntax:

```bash
openclaw system event --mode now --text "<message>"
```

That is what the loop now uses directly. Callback failures are non-fatal and are recorded in the per-cycle summary instead of breaking the loop.

## Exact Commands Run

```bash
openclaw system event --help
node --test test/ingest-loop.test.js
node src/cli/ingest-loop.js --help
node src/cli/ingest-loop.js --source-key williamsburggreenpointhousing --display-name "Williamsburg Greenpoint Housing" --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --browser-profile chrome --notify off --dry-run --state-file data/state/ingest-loop/test-dry-run.json --log-file data/state/ingest-loop/test-dry-run.jsonl --stop-file data/state/ingest-loop/test-dry-run.stop
npm test
npm run ingest:loop -- --source-key williamsburggreenpointhousing --display-name "Williamsburg Greenpoint Housing" --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --browser-profile chrome --target 3 --max-scrolls 2 --process-limit 3 --sample-limit 3 --poll-interval-ms 3000 --idle-interval-ms 2000 --max-cycles 1 --notify verbose --state-file data/state/ingest-loop/williamsburggreenpointhousing-live.json --log-file data/state/ingest-loop/williamsburggreenpointhousing-live.jsonl --stop-file data/state/ingest-loop/williamsburggreenpointhousing-live.stop
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 1
npm run inspect:storage -- validate-run --run-id 2026-03-13T19-25-43-502Z
npm test
npm run ingest:loop -- --source-key williamsburggreenpointhousing --display-name "Williamsburg Greenpoint Housing" --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --browser-profile chrome --target 3 --max-scrolls 2 --process-limit 3 --sample-limit 3 --poll-interval-ms 3000 --idle-interval-ms 2000 --max-cycles 1 --notify verbose --state-file data/state/ingest-loop/williamsburggreenpointhousing-validation.json --log-file data/state/ingest-loop/williamsburggreenpointhousing-validation.jsonl --stop-file data/state/ingest-loop/williamsburggreenpointhousing-validation.stop
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 2
npm run inspect:storage -- validate-run --run-id 2026-03-13T19-27-12-372Z
```

## Live Validation Evidence

### 1. Preflight succeeded

Both bounded live runs reported:

- `preflight.browserStatus.enabled: true`
- `preflight.browserStatus.running: true`
- `preflight.browserStatus.cdpReady: true`
- `preflight.href: https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL`

### 2. Deterministic navigate/reset executed

Both bounded live runs reported:

- `reset.attempted: true`
- `reset.href: https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL`
- `reset.title: (6) Williamsburg Greenpoint Housing | Facebook`

### 3. Fresh cycle with fresh-only queue processing

Live run:

- controller cycle started: `2026-03-13T19:25:31.626Z`
- crawl run id: `2026-03-13T19-25-43-502Z`
- crawl summary:
  - `collected: 3`
  - `freshCollected: 1`
  - `seenCollected: 2`
  - `unidentifiedCollected: 0`
- processing summary:
  - `claimedCount: 1`
  - `processedCount: 1`
  - `retryableCount: 0`
  - `failedCount: 0`
  - `enqueueCreated: 1`
  - `claimToCompleteMs: 4534`
- callbacks sent:
  - `reset_action`
  - `fresh_cycle`
  - final `stopped`

Storage inspection for that run showed:

- `freshObservationCount: 1`
- `seenObservationCount: 2`
- `runStepCount: 3`
- `artifactCount: 5`

`inspect:storage validate-run` on that fresh run reported one known issue:

- `summary.extractedListings does not match listing count`

That mismatch is pre-existing transitional behavior: crawl summary counts only inline extractor output, while the follow-on queue processing adds a `listing_records` row afterward. This pass did not attempt to redesign that boundary.

### 4. Idle/reset path also demonstrated

Follow-up bounded run:

- crawl run id: `2026-03-13T19-27-12-372Z`
- `freshCollected: 0`
- `seenCollected: 3`
- cycle classified as `idle`
- no queue processing ran
- callbacks sent:
  - `reset_action`
  - `idle_cycle`
  - final `stopped`

`inspect:storage validate-run --run-id 2026-03-13T19-27-12-372Z` returned `isHealthy: true`.

### 5. State and log files were written

Validation artifacts:

- `data/state/ingest-loop/williamsburggreenpointhousing-live.json`
- `data/state/ingest-loop/williamsburggreenpointhousing-live.jsonl`
- `data/state/ingest-loop/williamsburggreenpointhousing-validation.json`
- `data/state/ingest-loop/williamsburggreenpointhousing-validation.jsonl`

### 6. Clean stop behavior

Both live runs used:

```bash
--max-cycles 1
```

Observed final stop event:

- `stopReason: max-cycles`
- `status: stopped`

## Sample Cycle Summary

Fresh live cycle:

```json
{
  "event": "cycle",
  "cycle": 1,
  "sourceKey": "williamsburggreenpointhousing",
  "outcome": "fresh",
  "runId": "2026-03-13T19-25-43-502Z",
  "crawl": {
    "collected": 3,
    "freshCollected": 1,
    "seenCollected": 2,
    "unidentifiedCollected": 0,
    "extractedListings": 1,
    "stepCount": 3
  },
  "processing": {
    "ran": true,
    "processedCount": 1,
    "retryableCount": 0,
    "failedCount": 0,
    "enqueueCreated": 1,
    "claimToCompleteMs": 4534
  },
  "nextAction": "stopped",
  "waitMs": 0,
  "stopReason": "max-cycles"
}
```

## Sample State File

`data/state/ingest-loop/williamsburggreenpointhousing-validation.json`

```json
{
  "sourceKey": "williamsburggreenpointhousing",
  "displayName": "Williamsburg Greenpoint Housing",
  "groupUrl": "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL",
  "browserProfile": "chrome",
  "startedAt": "2026-03-13T19:27:01.897Z",
  "updatedAt": "2026-03-13T19:27:35.923Z",
  "cycle": 1,
  "idleCycles": 1,
  "status": "stopped",
  "lastOutcome": "idle",
  "lastRunId": "2026-03-13T19-27-12-372Z",
  "lastFreshCollected": 0,
  "lastProcessedCount": 0,
  "lastError": null,
  "lastNextAction": "stopped",
  "lastWaitMs": 0,
  "stopReason": "max-cycles"
}
```

## Sample Log Line

`data/state/ingest-loop/williamsburggreenpointhousing-validation.jsonl`

```json
{"event":"cycle","cycle":1,"sourceKey":"williamsburggreenpointhousing","displayName":"Williamsburg Greenpoint Housing","startedAt":"2026-03-13T19:27:01.898Z","completedAt":"2026-03-13T19:27:34.980Z","outcome":"idle","runId":"2026-03-13T19-27-12-372Z","idleCycles":1,"preflight":{"href":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL","title":"(6) Williamsburg Greenpoint Housing | Facebook","normalizedHref":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL","requestedGroupUrl":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL","browserStatus":{"enabled":true,"running":true,"cdpReady":true,"cdpHttp":true}},"reset":{"attempted":true,"groupUrl":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL","settledMs":2000,"href":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL","title":"(6) Williamsburg Greenpoint Housing | Facebook","normalizedHref":"https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"},"crawl":{"collected":3,"freshCollected":0,"seenCollected":3,"unidentifiedCollected":0,"extractedListings":0,"stepCount":3},"processing":{"ran":false,"skipped":false,"reason":"not-fresh","claimedCount":0,"processedCount":0,"retryableCount":0,"failedCount":0,"enqueueCreated":0,"enqueueExisting":0,"timeoutCount":0,"retryCount":0,"claimToCompleteMs":0},"callbacks":[{"eventType":"reset_action","sent":true,"text":"Ingest loop: resetting williamsburggreenpointhousing to https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL."},{"eventType":"idle_cycle","sent":true,"text":"Ingest loop: no fresh posts this cycle for williamsburggreenpointhousing; resetting and retrying in 0ms."}],"nextAction":"stopped","waitMs":0,"stopReason":"max-cycles","error":null}
```

## Verification

- `node --test test/ingest-loop.test.js`
- `npm test`
- live dry-run preflight against the attached Williamsburg/Greenpoint tab
- live fresh cycle with fresh-only queue processing
- live idle cycle with deterministic reset and clean stop

## Out Of Scope

- no new daemon or scheduler
- no crawl-strategy redesign
- no multi-source concurrency
- no Gemini schema/prompt changes
- no queue redesign beyond using the existing `validate:queue --freshness fresh` path
- no attempt to reconcile the pre-existing crawl-summary-vs-queue listing count mismatch

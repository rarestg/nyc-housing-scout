# Browser Relay Ingestion SOP

Status: tested live against the attached Chrome tab for `https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL` on 2026-03-13.

## Why this exists

The current Facebook collection path is not an HTTP scraper.
It is a browser-mediated DOM pipeline:

1. OpenClaw browser control reaches an attached Chrome tab
2. repo CLIs call `openclaw browser evaluate`
3. page-context JS extracts Facebook post cards from the live DOM
4. observations are persisted to SQLite + raw artifacts on disk
5. queue processing turns observations into Gemini-backed `processed_payloads`
6. normalized `listing_records` are derived from those payloads

This SOP is the operator runbook for that flow.

## Preconditions

Before any repo ingestion command will work reliably:

- OpenClaw gateway must be running
- the Chrome extension relay must be installed and healthy
- the extension must be attached to the correct Facebook tab (`ON` badge)
- the desired Facebook group page must already be open and logged in
- the `chrome` browser profile must resolve to the extension relay

This is not optional for the current DOM path.

## Fast health check

Run these first:

```bash
openclaw browser --browser-profile chrome tabs
openclaw browser status --browser-profile chrome
openclaw browser evaluate --browser-profile chrome --fn '() => ({ title: document.title, href: location.href })'
```

Healthy results should show:
- the target Facebook tab listed in `tabs`
- `running: true` in browser status
- page title + href from the live tab

## What was tested live

### 1. Direct browser relay smoke test

Command:

```bash
openclaw browser --browser-profile chrome evaluate --fn '() => ({ title: document.title, href: location.href, seeMoreButtons: Array.from(document.querySelectorAll("div,span,a")).filter(el => /see more/i.test((el.textContent||"").trim())).length })'
```

Observed result:
- title: `(6) Williamsburg Greenpoint Housing | Facebook`
- href: `https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL`
- `seeMoreButtons: 63`

Conclusion: page-context evaluation on the live Facebook tab works.

### 2. One-shot DOM capture

Command:

```bash
node src/cli/capture-dom-feed.js \
  --browser-profile chrome \
  --source-key williamsburggreenpointhousing \
  --display-name "Williamsburg Greenpoint Housing" \
  --limit 3
```

Observed result:
- collected: `1`
- freshCollected: `1`
- extractedListings: `1`
- author recovered: `Val Rodriguez`
- post id recovered: `24501579536206618`

Conclusion: one-shot capture works, but `--limit` is an upper bound, not a promise. The visible slice may still yield fewer unique cards than requested.

### 3. Crawl loop

Command:

```bash
node src/cli/crawl-dom-latest.js \
  --browser-profile chrome \
  --source-key williamsburggreenpointhousing \
  --display-name "Williamsburg Greenpoint Housing" \
  --target 3 \
  --max-scrolls 2
```

Observed run:
- run id: `2026-03-13T17-14-28-264Z`
- collected: `4`
- freshCollected: `3`
- seenCollected: `1`
- extractedListings: `3`

Step behavior:
- step 0: hit one already-seen post first
- step 1: after scroll, found three fresh posts and reached target

Conclusion: the crawl path can advance from already-seen top-of-feed content into fresh posts in the same run.

### 4. Queue + Gemini validation on the fresh crawl

Command:

```bash
npm run validate:queue -- --run-id 2026-03-13T17-14-28-264Z --process-limit 3 --sample-limit 3
```

Observed result:
- 4 jobs created
- 3 jobs claimed
- 3 jobs processed
- 0 retryable
- 0 failed
- `claimToCompleteMs: 9551`
- per-job latency: min `2853ms`, max `3813ms`, avg `3180.67ms`
- timeoutCount: `0`
- retryCount: `0`
- token usage total: `4081`

Conclusion: end-to-end browser ingestion + queue processing + Gemini extraction currently works on fresh live data.

## Key operator commands

### Browser / relay health

```bash
openclaw browser --browser-profile chrome tabs
openclaw browser status --browser-profile chrome
openclaw browser evaluate --browser-profile chrome --fn '() => ({ title: document.title, href: location.href })'
```

### Capture

```bash
node src/cli/capture-dom-feed.js --browser-profile chrome --source-key <key> --display-name "<name>" --limit 10
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key <key> --display-name "<name>" --target 10 --max-scrolls 10
```

### Inspect what was ingested

```bash
npm run inspect:storage -- runs --limit 5
npm run inspect:storage -- observations --run-id <runId> --limit 20
npm run inspect:storage -- listings --run-id <runId> --full
```

### Queue / Gemini

```bash
npm run validate:queue -- --run-id <runId> --process-limit 5 --sample-limit 3
npm run inspect:jobs -- --limit 20
```

## Recommended manual operator loop

This is the current practical human-attended loop.

### Phase A — attach + verify

1. Open the target Facebook group page in Chrome
2. Click the OpenClaw extension so the badge is `ON`
3. Run the browser health checks above
4. Confirm the evaluated `href` is the intended group page

### Phase B — ingest

5. Run a crawl with a modest target:

```bash
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key <key> --display-name "<name>" --target 10 --max-scrolls 10
```

6. Inspect the resulting run:

```bash
npm run inspect:storage -- runs --limit 3
npm run inspect:storage -- observations --run-id <runId> --limit 20
```

7. Validate queue processing on that run:

```bash
npm run validate:queue -- --run-id <runId> --freshness fresh --process-limit 10 --sample-limit 3
```

### Phase C — decide what to do next

If the crawl found fresh posts:
- inspect results
- process jobs
- optionally hand off to review/UI surfaces

If the crawl mostly sees already-cached posts or stalls near the top:
- refresh the page
- optionally wait a little
- rerun the crawl

## Refresh / revisit policy

A simple operator policy that fits the current architecture:

### When to refresh

Refresh the Facebook group page when any of these are true:
- top-of-feed crawl step is dominated by `seen` posts
- fresh count is `0` for the run
- scroll stops advancing
- the page looks visually stale
- a prior run already exhausted the visible top slice

### How to refresh

Preferred simple approach:
- manually refresh the tab in Chrome

Possible automated approach later:
- use browser evaluate to trigger `location.reload()` or browser navigate back to the group URL

### Suggested cadence

For a human-attended ingestion session:
- crawl
- validate/process
- if no fresh results, wait 1-3 minutes
- refresh and repeat

For a future unattended loop:
- small target crawl every 2-5 minutes
- refresh when run freshness is exhausted or top slice is all seen
- continue until a stop flag or explicit pause is set

## Callback / notification idea

The current architecture does not yet have a dedicated ingestion daemon.
For now, the clean callback pattern would be:

1. run a small controller loop
2. after each crawl, inspect the run summary / step log
3. if `freshCollected === 0` or the run stops on stale/seen content:
   - send an internal reminder / callback to the operator session
   - refresh the page
   - continue after a short wait

For OpenClaw-native callbacks, use a system event or cron reminder into the main session rather than bolting on a second orchestration layer.

## Important quirks found during live testing

### 1. `capture:dom` can under-fill
A capture with `--limit 3` returned only `1` collected post.
That is not necessarily a bug; it means the current visible unique DOM slice was smaller than the requested limit after dedupe/extraction.

### 2. `crawl:dom` is the real ingestion primitive
For live group ingestion, `crawl-dom-latest.js` is more representative than one-shot capture because it can expand/scroll out of a stale or already-seen top slice.

### 3. Queue validation defaults are broader than “fresh only”
In the tested run, `validate:queue` treated all eligible observations in the run as in-scope unless filtered.
If you only want new content, explicitly pass:

```bash
--freshness fresh
```

### 4. Browser attachment is tab-specific
The repo does not control “whatever Chrome tab is active.”
It controls the tab explicitly attached through the extension relay.
If the wrong tab is attached, ingestion will hit the wrong page.

### 5. This path is session-state dependent
Because this uses the live logged-in Facebook tab, the pipeline depends on real browser/session state.
That is powerful, but it also means operator discipline matters.

## LLM schema review note: lat/lng should not be LLM-extracted
Current schema still includes:
- `location.lat`
- `location.lng`
- `location.geocodeConfidence`

That is a bad fit for the current architecture.
The LLM should not be asked to invent coordinates from vague neighborhood text.

Observed live behavior today was sane:
- Gemini returned `lat: null`
- Gemini returned `lng: null`
- sometimes `geocodeConfidence: 0` or `null`

Recommended direction:
- remove `lat` / `lng` from the LLM extraction schema
- move geocoding into a separate downstream enrichment step
- only populate coordinates when a real geocoder/tool exists and the source evidence supports it

Until that change lands, treat lat/lng as placeholder fields that should remain null.

## Recommended next follow-up docs / passes

1. **Small schema cleanup pass**
   - remove `lat`/`lng` from Gemini output schema and normalized listing contract, or formally mark them as downstream-only

2. **Ingestion controller pass**
   - add a small explicit CLI or script that runs the crawl/refresh/retry loop with a stop condition and callback behavior

3. **Crawl strategy pass**
   - harden top-of-feed reset, overlap-anchor stopping, and stale-zone detection so the loop is not just blind refresh + recrawl

## Current bottom line

The pipeline is real enough to support the next UI phase.
The tested path is:
- attach Chrome tab
- crawl into observations
- validate queue processing
- inspect normalized listings

What is still missing is not basic viability.
What is missing is a cleaner long-running operator loop and sharper output-quality / crawl-policy discipline.

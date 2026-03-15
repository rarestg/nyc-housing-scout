# Phase 1 Backfill Session And Debug Pass

Date: 2026-03-13
Boundary: treat commit `bb5a94a` (`Add ingest loop controller`) as the landed starting point.

## Scope

Run a live Williamsburg/Greenpoint Phase 1 backfill session with `ingest:loop`, verify that the loop:

- resets to the chronological group URL each cycle
- uses the existing DOM scroll crawl path to push deeper into the feed
- processes only `fresh` observations through `validate:queue`
- reaches idle/stale saturation under the chosen settings, or surfaces a concrete blocker

This pass stayed narrow. I did not redesign crawl policy, add an age-aware stop rule, change queue/schema behavior, or make frontend changes.

## Files Changed

- `docs/passes/2026-03-13_17-18-26_PHASE1_BACKFILL_SESSION_AND_DEBUG_PASS.md`
- `docs/passes/README.md`

No code files changed. No test files changed.

## Exact Commands Run

### Required reading / code review

```bash
sed -n '1,220p' README.md
sed -n '1,260p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/notes/2026-03-13_12-22-00_PM_HANDOFF_AND_OPERATOR_GUIDE.md
sed -n '1,260p' docs/notes/2026-03-13_13-16-00_BROWSER_RELAY_INGESTION_SOP.md
sed -n '1,260p' docs/notes/2026-03-13_13-37-00_INGEST_LOOP_SPEC.md
sed -n '1,280p' docs/passes/2026-03-13_15-27-51_INGEST_LOOP_CONTROLLER_PASS.md
sed -n '1,260p' src/cli/ingest-loop.js
sed -n '260,520p' src/cli/ingest-loop.js
sed -n '520,820p' src/cli/ingest-loop.js
sed -n '1,360p' src/core/ingest-loop.js
sed -n '1,340p' src/cli/crawl-dom-latest.js
sed -n '1,320p' src/cli/validate-queue.js
sed -n '1,320p' src/core/browser-pipeline.js
sed -n '1,320p' test/ingest-loop.test.js
git status --short
```

### Browser health

```bash
openclaw browser --browser-profile chrome tabs
openclaw browser status --browser-profile chrome
openclaw browser evaluate --browser-profile chrome --fn '() => ({ title: document.title, href: location.href })'
```

### Dry-run preflight

```bash
npm run ingest:loop -- \
  --source-key williamsburggreenpointhousing \
  --display-name "Williamsburg Greenpoint Housing" \
  --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --browser-profile chrome \
  --notify off \
  --dry-run \
  --state-file data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.json \
  --log-file data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.jsonl \
  --stop-file data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.stop
```

### Main Phase 1 session

```bash
npm run ingest:loop -- \
  --source-key williamsburggreenpointhousing \
  --display-name "Williamsburg Greenpoint Housing" \
  --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --browser-profile chrome \
  --target 25 \
  --max-scrolls 40 \
  --process-limit 10 \
  --sample-limit 3 \
  --poll-interval-ms 10000 \
  --idle-interval-ms 10000 \
  --max-idle-cycles 2 \
  --max-cycles 12 \
  --notify verbose \
  --state-file data/state/ingest-loop/williamsburggreenpointhousing-phase1.json \
  --log-file data/state/ingest-loop/williamsburggreenpointhousing-phase1.jsonl \
  --stop-file data/state/ingest-loop/williamsburggreenpointhousing-phase1.stop
```

### Post-run inspection

```bash
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 10
npm run inspect:storage -- run-steps --run-id 2026-03-13T20-43-31-678Z --limit 200
npm run inspect:storage -- run-steps --run-id 2026-03-13T21-10-57-864Z --limit 5
npm run inspect:storage -- validate-run --run-id 2026-03-13T20-43-31-678Z
npm run inspect:storage -- validate-run --run-id 2026-03-13T20-47-43-444Z
npm run inspect:storage -- validate-run --run-id 2026-03-13T21-10-57-864Z
npm run inspect:jobs -- --status retryable --limit 20
npm run inspect:jobs -- --status failed --limit 20
npm run inspect:jobs -- --status pending --limit 30
npm run validate:queue -- --run-id 2026-03-13T20-43-31-678Z --freshness fresh --process-limit 0 --sample-limit 3
npm run validate:queue -- --run-id 2026-03-13T20-47-43-444Z --freshness fresh --process-limit 0 --sample-limit 3 | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));const out={runId:obj.run.id,freshObservations:obj.before.observations.totalObservations,eligible:obj.before.observations.eligibleObservations,enqueue:obj.enqueue.counts,beforeJobs:obj.before.jobs,afterJobs:obj.after.jobs,processedSamples:obj.samples.processedPayloads.map((p)=>({jobId:p.jobId,observationId:p.observationId,postUrl:p.postUrl,processedListingCount:p.processedListingCount}))};console.log(JSON.stringify(out,null,2));});"
npm run validate:queue -- --run-id 2026-03-13T20-59-37-736Z --freshness fresh --process-limit 0 --sample-limit 3 | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));const out={runId:obj.run.id,freshObservations:obj.before.observations.totalObservations,eligible:obj.before.observations.eligibleObservations,enqueue:obj.enqueue.counts,beforeJobs:obj.before.jobs,afterJobs:obj.after.jobs,processedSamples:obj.samples.processedPayloads.map((p)=>({jobId:p.jobId,observationId:p.observationId,postUrl:p.postUrl,processedListingCount:p.processedListingCount}))};console.log(JSON.stringify(out,null,2));});"
npm run inspect:storage -- observations --run-id 2026-03-13T20-59-37-736Z --freshness fresh --limit 5 --full | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));console.log(JSON.stringify(obj.results.map((r)=>({id:r.id,freshness:r.freshness,postId:r.platformPostId,postUrl:r.postUrl,authorName:r.authorName,postedAtText:r.postedAtText,bodyText:r.bodyText})),null,2));});"
npm run inspect:storage -- observations --run-id 2026-03-13T20-47-43-444Z --freshness fresh --limit 20 --full | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));const rows=obj.results.map((r)=>({id:r.id,postId:r.platformPostId,authorName:r.authorName,postedAtText:r.postedAtText,postUrl:r.postUrl,bodyText:r.bodyText}));console.log(JSON.stringify(rows,null,2));});"
for RUN in 2026-03-13T20-43-31-678Z 2026-03-13T20-47-43-444Z 2026-03-13T20-59-37-736Z; do npm run inspect:storage -- observations --run-id "$RUN" --freshness fresh --limit 100 --full | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));const counts={};for(const r of obj.results){const key=r.postedAtText??'null';counts[key]=(counts[key]||0)+1;}console.log(JSON.stringify({runId:obj.filters.runId,count:obj.count,postedAtTextCounts:counts},null,2));});"; done
for RUN in 2026-03-13T20-43-31-678Z 2026-03-13T20-47-43-444Z 2026-03-13T20-54-00-251Z 2026-03-13T21-10-57-864Z; do npm run inspect:storage -- run-steps --run-id "$RUN" --limit 200 | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const start=s.indexOf('{');const end=s.lastIndexOf('}');const obj=JSON.parse(s.slice(start,end+1));const results=obj.results;const last=results[results.length-1]||null;console.log(JSON.stringify({runId:obj.filters.runId,count:obj.count,lastStep:last?{stepIndex:last.stepIndex,freshCollected:last.freshCollected,seenCollected:last.seenCollected,unidentifiedCollected:last.unidentifiedCollected,scrollY:last.scrollY,bodyHeight:last.bodyHeight,stoppedReason:last.stoppedReason}:null},null,2));});"; done
```

### Verification

```bash
npm test
```

## Starting Settings And Adjustments

Starting settings were the exact requested Phase 1 settings:

- `target=25`
- `max-scrolls=40`
- `process-limit=10`
- `sample-limit=3`
- `poll-interval-ms=10000`
- `idle-interval-ms=10000`
- `max-idle-cycles=2`
- `max-cycles=12`
- `notify=verbose`

No live `ingest:loop` settings were changed mid-session.

The only inspection-side adjustment was rerunning post-hoc `validate:queue` commands serially after I triggered `database is locked` by launching multiple SQLite inspection commands in parallel. That did not affect the live loop itself.

## Live Run Table

| Cycle | Run ID | Outcome | freshCollected | seenCollected | unidentifiedCollected | Step Count | Queue Processing Ran | Processed / Retryable / Failed |
|------|--------|---------|----------------|---------------|-----------------------|------------|----------------------|--------------------------------|
| 1 | `2026-03-13T20-43-31-678Z` | fresh | 25 | 5 | 1 | 25 | yes | 10 / 0 / 0 |
| 2 | `2026-03-13T20-47-43-444Z` | fresh | 17 | 30 | 7 | 41 | yes | 10 / 0 / 0 |
| 3 | `2026-03-13T20-54-00-251Z` | idle | 0 | 47 | 6 | 41 | no | 0 / 0 / 0 |
| 4 | `2026-03-13T20-59-37-736Z` | fresh | 1 | 45 | 14 | 41 | yes | 1 / 0 / 0 |
| 5 | `2026-03-13T21-05-21-075Z` | idle | 0 | 46 | 16 | 41 | no | 0 / 0 / 0 |
| 6 | `2026-03-13T21-10-57-864Z` | idle | 0 | 46 | 16 | 41 | no | 0 / 0 / 0 |

Session totals from the controller log:

- fresh observations collected across fresh cycles: `43`
- queue processing runs: `3`
- queue processed during loop: `21`
- retryable during loop: `0`
- failed during loop: `0`
- stop reason: `max-idle-cycles`

## Queue Outcome Inspection

Fresh-only validation remained scoped correctly:

- run `2026-03-13T20-43-31-678Z`
  - `25` fresh observations
  - `25` eligible
  - jobs after loop: `10 processed`, `15 pending`, `0 retryable`, `0 failed`
- run `2026-03-13T20-47-43-444Z`
  - `17` fresh observations
  - `17` eligible
  - jobs after loop: `10 processed`, `7 pending`, `0 retryable`, `0 failed`
- run `2026-03-13T20-59-37-736Z`
  - `1` fresh observation
  - `1` eligible
  - jobs after loop: `1 processed`, `0 pending`, `0 retryable`, `0 failed`

`inspect:jobs` after the session showed:

- `retryable=0`
- `failed=0`
- `pending=22`

The `22` remaining pending jobs are expected from the chosen `--process-limit 10`. The loop processed only fresh observations from each run, but it did not drain all fresh work from runs 1 and 2 before moving on.

## Evidence Of Saturation Or Blocker

The loop reached operational saturation under the current settings.

Evidence:

1. Cycle 1 still reached the fresh target early.
   - run `2026-03-13T20-43-31-678Z`
   - `25` fresh by step `24`
   - last recorded step: `scrollY=15925`, `bodyHeight=20165`

2. Cycle 2 had to spend much more of its scroll budget on overlap before finding new content.
   - run `2026-03-13T20-47-43-444Z`
   - only `17` fresh by step `40`
   - last recorded step: `scrollY=21411`, `bodyHeight=27474`

3. Cycle 3 hit a full 41-step crawl with `0` fresh.
   - run `2026-03-13T20-54-00-251Z`
   - `47` seen, `6` unidentified, `0` fresh

4. Cycle 4 surfaced one last deep fresh observation.
   - run `2026-03-13T20-59-37-736Z`
   - `1` fresh, `45` seen, `14` unidentified

5. Cycles 5 and 6 converged on the same idle shape and the controller stopped itself.
   - run `2026-03-13T21-05-21-075Z`: `0` fresh, `46` seen, `16` unidentified
   - run `2026-03-13T21-10-57-864Z`: `0` fresh, `46` seen, `16` unidentified
   - controller stop: `max-idle-cycles`

No blocker was found in the loop controller, browser preflight, navigate/reset behavior, crawl scroll path, fresh-only queue scoping, or callback/state/log behavior.

## Approximate Depth Reached

This session did not justify a claim of "about 3 weeks."

What the live data supports:

- Fresh run `2026-03-13T20-43-31-678Z`
  - explicit `postedAtText` values on fresh observations ranged from `6h` to `3d`
- Fresh run `2026-03-13T20-47-43-444Z`
  - explicit `postedAtText` values on fresh observations ranged from `20h` to `6d`
  - distribution: `6d` x3, `5d` x1, `4d` x3, `3d` x2, `1d` x1, `20h` x1, `null` x6
- Fresh run `2026-03-13T20-59-37-736Z`
  - the single fresh observation had `postedAtText: 3d`

Representative later fresh observations:

- `obs_000243` / Jai-La Aponte
  - `postedAtText: 6d`
  - body mentions `April 16-June 9`
- `obs_000236` / Humberto Martínez
  - `postedAtText: 6d`
  - body mentions `March 16-29`
- `obs_000234` / Claire Klement
  - `postedAtText: 6d`
  - body mentions `March rent is FREE` and `lease takeover ASAP`
- `obs_000299` / Royce Richards
  - `postedAtText: 3d`
  - body mentions `April 1st or sooner`

Interpretation:

- On Friday, March 13, 2026, the deepest explicit relative age recovered on fresh observations was roughly `6d`, which implies about Saturday, March 7, 2026.
- Some body text contains March/April dates, but those are listing availability windows, not post age.
- I did not see evidence strong enough to claim the current run reached 3 weeks of fresh unseen content.

## Issues Found And Fixes Made

No repo code issue required a fix in the allowed write scope.

Observed notes:

- Fresh-only queue processing behaved correctly during the live loop.
- The known pre-existing `validate-run` listing-count mismatch still appears on fresh runs after queue processing.
  - run `2026-03-13T20-43-31-678Z`: summary `extractedListings=26`, stored listings `37`
  - run `2026-03-13T20-47-43-444Z`: summary `extractedListings=19`, stored listings `29`
  - idle run `2026-03-13T21-10-57-864Z` validated healthy
- During my own post-hoc inspection, firing multiple SQLite readers/writers in parallel triggered `database is locked`.
  - I reran those inspections serially.
  - I do not treat that as a loop-controller bug because the live loop itself is sequential and completed cleanly.

## State / Log Artifact Paths

Dry-run artifacts:

- `data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.json`
- `data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.jsonl`
- configured stop path: `data/state/ingest-loop/williamsburggreenpointhousing-phase1-dry.stop`

Main session artifacts:

- `data/state/ingest-loop/williamsburggreenpointhousing-phase1.json`
- `data/state/ingest-loop/williamsburggreenpointhousing-phase1.jsonl`
- configured stop path: `data/state/ingest-loop/williamsburggreenpointhousing-phase1.stop`

Representative run exports:

- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-13T20-43-31-678Z.json`
- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-13T20-47-43-444Z.json`
- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-13T20-59-37-736Z.json`
- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-13T21-10-57-864Z.json`

## Verification

- Browser relay health checks passed against the attached `chrome` profile and the chronological Williamsburg group URL.
- Dry-run preflight succeeded with healthy browser status and matching group URL.
- Live Phase 1 session ran for 6 cycles without controller error.
- Fresh-only queue processing ran on 3 fresh cycles.
- `inspect:jobs --status retryable` returned `0`.
- `inspect:jobs --status failed` returned `0`.
- `npm test` passed: `52` tests, `0` failures.

## Recommendation

Needs another backfill/debug pass first.

Why:

- The Phase 1 controller itself is operational and hit its intended idle saturation rule.
- But the deepest explicit fresh-post age observed in this session was only about `6d`, not anywhere near 3 weeks.
- If the product requirement is still "backfill roughly 3 weeks," the next pass should focus on why the current reachable window under `target=25` / `max-scrolls=40` saturates around the first week of feed content rather than switching to Phase 2 steady-state refresh immediately.

# Phase 1B Backfill Depth Investigation Pass

Date: 2026-03-15
Boundary: treat commit `bb5a94a` (`Add ingest loop controller`) as the landed starting point.

## 1. Scope

This pass stayed narrow and live-ops focused:

- drained the known pending fresh-job backlog left by the March 13 Phase 1 session
- re-read the Phase 1 pass and the crawl/controller/storage code paths
- inspected run-step and observation evidence to answer why depth saturated early
- ran one deeper bounded live backfill experiment on the existing browser-relay path
- validated whether the deeper run materially extended the reachable fresh history window
- wrote up the recommendation for the next PM decision

Out of scope remained out of scope:

- no crawl-strategy redesign
- no age-aware stop rule
- no queue redesign
- no Gemini prompt/schema work
- no frontend work
- no multi-source orchestration
- no attempt to solve the known run-summary/listing-count mismatch except to note it where it reappeared

## 2. Files Changed

- `docs/passes/2026-03-15_12-15-17_PHASE1B_BACKFILL_DEPTH_INVESTIGATION_PASS.md`
- `docs/passes/README.md`

No repo code files changed.
No tests changed.

## 3. Exact Commands Run

### Required reading / code review

```bash
sed -n '1,180p' README.md
sed -n '1,160p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,240p' docs/PIPELINE.md
sed -n '1,320p' data/README.md
sed -n '1,260p' docs/notes/2026-03-13_12-22-00_PM_HANDOFF_AND_OPERATOR_GUIDE.md
sed -n '1,360p' docs/notes/2026-03-13_13-16-00_BROWSER_RELAY_INGESTION_SOP.md
sed -n '1,440p' docs/notes/2026-03-13_13-37-00_INGEST_LOOP_SPEC.md
sed -n '1,320p' docs/passes/2026-03-13_15-27-51_INGEST_LOOP_CONTROLLER_PASS.md
sed -n '1,360p' docs/passes/2026-03-13_17-18-26_PHASE1_BACKFILL_SESSION_AND_DEBUG_PASS.md
sed -n '1,260p' src/cli/ingest-loop.js
sed -n '260,520p' src/cli/ingest-loop.js
sed -n '1,260p' src/core/ingest-loop.js
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '1,120p' src/browser/dom-helpers.js
sed -n '1,260p' src/browser/dom-extractor.js
sed -n '260,560p' src/browser/dom-extractor.js
sed -n '560,780p' src/browser/dom-extractor.js
sed -n '1,220p' src/core/browser-pipeline.js
sed -n '150,390p' src/storage/sqlite-storage.js
sed -n '1120,1260p' src/storage/sqlite-storage.js
sed -n '1580,1695p' src/storage/sqlite-storage.js
sed -n '1,220p' test/ingest-loop.test.js
sed -n '1,260p' src/core/collected-post.js
sed -n '1,240p' docs/passes/README.md
```

### Browser health

```bash
openclaw browser --browser-profile chrome tabs
openclaw browser status --browser-profile chrome
openclaw browser evaluate --browser-profile chrome --fn '() => ({ title: document.title, href: location.href })'
```

### Drain prior Phase 1 backlog

```bash
npm run validate:queue -- --run-id 2026-03-13T20-43-31-678Z --freshness fresh --process-limit 100 --sample-limit 3
npm run validate:queue -- --run-id 2026-03-13T20-47-43-444Z --freshness fresh --process-limit 100 --sample-limit 3
npm run inspect:jobs -- --status pending --limit 50
npm run inspect:jobs -- --status retryable --limit 20
npm run inspect:jobs -- --status failed --limit 20
```

### Read-only depth investigation

```bash
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 12
npm run inspect:storage -- run-steps --run-id 2026-03-13T20-43-31-678Z --limit 200
npm run inspect:storage -- run-steps --run-id 2026-03-13T20-47-43-444Z --limit 200
npm run inspect:storage -- run-steps --run-id 2026-03-13T20-54-00-251Z --limit 200
npm run inspect:storage -- observations --run-id 2026-03-13T20-47-43-444Z --freshness fresh --limit 50 --full
npm run inspect:storage -- observations --run-id 2026-03-13T20-54-00-251Z --limit 50 --full
```

### Targeted evidence summaries

```bash
node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runs = [
  '2026-03-13T20-43-31-678Z',
  '2026-03-13T20-47-43-444Z',
  '2026-03-13T20-54-00-251Z',
  '2026-03-13T20-59-37-736Z',
  '2026-03-13T21-05-21-075Z',
  '2026-03-13T21-10-57-864Z',
];
for (const runId of runs) {
  const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'run-steps', '--run-id', runId, '--limit', '200'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  const steps = data.results;
  const deltas = [];
  for (let i = 1; i < steps.length; i += 1) {
    deltas.push({
      stepIndex: steps[i].stepIndex,
      scrollDelta: (steps[i].scrollY ?? 0) - (steps[i - 1].scrollY ?? 0),
      bodyDelta: (steps[i].bodyHeight ?? 0) - (steps[i - 1].bodyHeight ?? 0),
      addedCount: steps[i].addedCount ?? 0,
      freshCount: steps[i].freshCount ?? 0,
      seenCount: steps[i].seenCount ?? 0,
      unidentifiedCount: steps[i].unidentifiedCount ?? 0,
    });
  }
  const tail = deltas.slice(-10);
  console.log(JSON.stringify({
    runId,
    stepCount: steps.length,
    lastStep: steps.at(-1) ? {
      stepIndex: steps.at(-1).stepIndex,
      freshCollected: steps.at(-1).freshCollected,
      seenCollected: steps.at(-1).seenCollected,
      unidentifiedCollected: steps.at(-1).unidentifiedCollected,
      scrollY: steps.at(-1).scrollY,
      bodyHeight: steps.at(-1).bodyHeight,
      stoppedReason: steps.at(-1).stoppedReason,
    } : null,
    overallGrowth: {
      scrollIncreases: deltas.filter((d) => d.scrollDelta > 0).length,
      scrollFlatOrDown: deltas.filter((d) => d.scrollDelta <= 0).length,
      bodyIncreases: deltas.filter((d) => d.bodyDelta > 0).length,
      bodyFlatOrDown: deltas.filter((d) => d.bodyDelta <= 0).length,
    },
    tailGrowth: {
      scrollIncreases: tail.filter((d) => d.scrollDelta > 0).length,
      scrollFlatOrDown: tail.filter((d) => d.scrollDelta <= 0).length,
      bodyIncreases: tail.filter((d) => d.bodyDelta > 0).length,
      bodyFlatOrDown: tail.filter((d) => d.bodyDelta <= 0).length,
      addedTotal: tail.reduce((sum, d) => sum + d.addedCount, 0),
      freshTotal: tail.reduce((sum, d) => sum + d.freshCount, 0),
      seenTotal: tail.reduce((sum, d) => sum + d.seenCount, 0),
      unidentifiedTotal: tail.reduce((sum, d) => sum + d.unidentifiedCount, 0),
    },
  }, null, 2));
}
NODE

node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runs = [
  '2026-03-13T20-47-43-444Z',
  '2026-03-13T20-54-00-251Z',
  '2026-03-13T20-59-37-736Z',
  '2026-03-13T21-05-21-075Z',
  '2026-03-13T21-10-57-864Z',
];
for (const runId of runs) {
  const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'observations', '--run-id', runId, '--limit', '100', '--full'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  const rows = data.results;
  const byFreshness = {};
  for (const row of rows) {
    const key = row.freshness;
    if (!byFreshness[key]) {
      byFreshness[key] = {
        count: 0,
        missingPostUrl: 0,
        missingPostId: 0,
        missingAuthorName: 0,
        missingPostedAtText: 0,
        maxStepIndex: -1,
        postedAtTextCounts: {},
      };
    }
    const bucket = byFreshness[key];
    bucket.count += 1;
    if (!row.postUrl) bucket.missingPostUrl += 1;
    if (!row.platformPostId) bucket.missingPostId += 1;
    if (!row.authorName) bucket.missingAuthorName += 1;
    if (!row.postedAtText) bucket.missingPostedAtText += 1;
    bucket.maxStepIndex = Math.max(bucket.maxStepIndex, row.stepIndex ?? -1);
    const pat = row.postedAtText ?? 'null';
    bucket.postedAtTextCounts[pat] = (bucket.postedAtTextCounts[pat] || 0) + 1;
  }
  const deepestFresh = rows
    .filter((row) => row.freshness === 'fresh')
    .sort((a, b) => (b.stepIndex ?? -1) - (a.stepIndex ?? -1))
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      stepIndex: row.stepIndex,
      postId: row.platformPostId,
      postUrlPresent: Boolean(row.postUrl),
      authorNamePresent: Boolean(row.authorName),
      postedAtText: row.postedAtText,
      authorName: row.authorName,
    }));
  console.log(JSON.stringify({ runId, total: rows.length, byFreshness, deepestFresh }, null, 2));
}
NODE

node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runId = '2026-03-13T21-10-57-864Z';
const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'observations', '--run-id', runId, '--freshness', 'unidentified', '--limit', '20', '--full'], { encoding: 'utf8' });
const data = JSON.parse(raw);
const rows = data.results
  .sort((a, b) => (b.stepIndex ?? -1) - (a.stepIndex ?? -1))
  .slice(0, 8)
  .map((row) => ({
    id: row.id,
    stepIndex: row.stepIndex,
    authorName: row.authorName,
    postedAtText: row.postedAtText,
    bodyTextPreview: row.bodyTextPreview,
    mediaCount: row.mediaCount,
    captureHints: row.captureHints,
    payload: {
      postId: row.payload?.postId ?? null,
      postUrl: row.payload?.postUrl ?? null,
      authorName: row.payload?.authorName ?? null,
      postedAtText: row.payload?.postedAtText ?? null,
    },
  }));
console.log(JSON.stringify({ runId, samples: rows }, null, 2));
NODE
```

### Unidentified raw-artifact inspection

```bash
node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runId = '2026-03-13T21-10-57-864Z';
const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'observations', '--run-id', runId, '--freshness', 'unidentified', '--limit', '20', '--full'], { encoding: 'utf8' });
const data = JSON.parse(raw);
const rows = data.results
  .filter((row) => ['obs_000475', 'obs_000481', 'obs_000469'].includes(row.id))
  .map((row) => ({ id: row.id, rawArtifactPath: row.rawArtifactPath, stepIndex: row.stepIndex, authorName: row.authorName, postedAtText: row.postedAtText }));
console.log(JSON.stringify(rows, null, 2));
NODE

sed -n '1,260p' data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z/Mylea-Hardy-000.json
sed -n '1,260p' data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z/Grace-Ahn-016.json
sed -n '1,260p' data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z/Anonymous-member-022.json
rg -n "posts/|story_fbid|multi_permalinks|ft_ent_identifier|feedback|group_post|permalink\\.php" data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z/Anonymous-member-*.json
rg -n "posts/|story_fbid|multi_permalinks|ft_ent_identifier|feedback|group_post|permalink\\.php" data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z/*.json | head -n 20
ls data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z | rg 'Anonymous-member|unknown-author|Grace-Ahn|Mylea-Hardy'
```

### Deeper live experiment

```bash
npm run ingest:loop -- \
  --source-key williamsburggreenpointhousing \
  --display-name "Williamsburg Greenpoint Housing" \
  --group-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --browser-profile chrome \
  --target 60 \
  --max-scrolls 80 \
  --process-limit 20 \
  --sample-limit 3 \
  --poll-interval-ms 10000 \
  --idle-interval-ms 10000 \
  --max-idle-cycles 2 \
  --max-cycles 6 \
  --notify verbose \
  --state-file data/state/ingest-loop/williamsburggreenpointhousing-phase1b.json \
  --log-file data/state/ingest-loop/williamsburggreenpointhousing-phase1b.jsonl \
  --stop-file data/state/ingest-loop/williamsburggreenpointhousing-phase1b.stop
```

### Post-experiment inspection and fresh-job drain

```bash
npm run inspect:jobs -- --status pending --limit 50
npm run inspect:jobs -- --status retryable --limit 20
npm run inspect:jobs -- --status failed --limit 20
npm run validate:queue -- --run-id 2026-03-15T15-37-50-960Z --freshness fresh --process-limit 100 --sample-limit 3
npm run inspect:jobs -- --status pending --limit 50
npm run inspect:jobs -- --status retryable --limit 20
npm run inspect:jobs -- --status failed --limit 20
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 12
npm run inspect:storage -- validate-run --run-id 2026-03-15T15-37-50-960Z
npm run inspect:storage -- validate-run --run-id 2026-03-15T15-50-09-352Z
npm run inspect:storage -- validate-run --run-id 2026-03-15T16-01-01-833Z
```

### New-run summaries

```bash
node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runs = [
  '2026-03-15T15-37-50-960Z',
  '2026-03-15T15-50-09-352Z',
  '2026-03-15T16-01-01-833Z',
];
for (const runId of runs) {
  const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'run-steps', '--run-id', runId, '--limit', '200'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  const steps = data.results;
  const deltas = [];
  for (let i = 1; i < steps.length; i += 1) {
    deltas.push({
      stepIndex: steps[i].stepIndex,
      scrollDelta: (steps[i].scrollY ?? 0) - (steps[i - 1].scrollY ?? 0),
      bodyDelta: (steps[i].bodyHeight ?? 0) - (steps[i - 1].bodyHeight ?? 0),
      addedCount: steps[i].addedCount ?? 0,
      freshCount: steps[i].freshCount ?? 0,
      seenCount: steps[i].seenCount ?? 0,
      unidentifiedCount: steps[i].unidentifiedCount ?? 0,
    });
  }
  const tail = deltas.slice(-15);
  console.log(JSON.stringify({
    runId,
    stepCount: steps.length,
    lastStep: steps.at(-1) ? {
      stepIndex: steps.at(-1).stepIndex,
      freshCollected: steps.at(-1).freshCollected,
      seenCollected: steps.at(-1).seenCollected,
      unidentifiedCollected: steps.at(-1).unidentifiedCollected,
      scrollY: steps.at(-1).scrollY,
      bodyHeight: steps.at(-1).bodyHeight,
      stoppedReason: steps.at(-1).stoppedReason,
    } : null,
    overallGrowth: {
      scrollIncreases: deltas.filter((d) => d.scrollDelta > 0).length,
      scrollFlatOrDown: deltas.filter((d) => d.scrollDelta <= 0).length,
      bodyIncreases: deltas.filter((d) => d.bodyDelta > 0).length,
      bodyFlatOrDown: deltas.filter((d) => d.bodyDelta <= 0).length,
    },
    tailGrowth: {
      scrollIncreases: tail.filter((d) => d.scrollDelta > 0).length,
      scrollFlatOrDown: tail.filter((d) => d.scrollDelta <= 0).length,
      bodyIncreases: tail.filter((d) => d.bodyDelta > 0).length,
      bodyFlatOrDown: tail.filter((d) => d.bodyDelta <= 0).length,
      addedTotal: tail.reduce((sum, d) => sum + d.addedCount, 0),
      freshTotal: tail.reduce((sum, d) => sum + d.freshCount, 0),
      seenTotal: tail.reduce((sum, d) => sum + d.seenCount, 0),
      unidentifiedTotal: tail.reduce((sum, d) => sum + d.unidentifiedCount, 0),
    },
  }, null, 2));
}
NODE

node - <<'NODE'
const { execFileSync } = require('node:child_process');
const runs = [
  '2026-03-15T15-37-50-960Z',
  '2026-03-15T15-50-09-352Z',
  '2026-03-15T16-01-01-833Z',
];
for (const runId of runs) {
  const raw = execFileSync(process.execPath, ['src/cli/inspect-storage.js', 'observations', '--run-id', runId, '--limit', '200', '--full'], { encoding: 'utf8' });
  const data = JSON.parse(raw);
  const rows = data.results;
  const byFreshness = {};
  for (const row of rows) {
    const key = row.freshness;
    if (!byFreshness[key]) {
      byFreshness[key] = {
        count: 0,
        missingPostUrl: 0,
        missingPostId: 0,
        missingAuthorName: 0,
        missingPostedAtText: 0,
        maxStepIndex: -1,
        postedAtTextCounts: {},
      };
    }
    const bucket = byFreshness[key];
    bucket.count += 1;
    if (!row.postUrl) bucket.missingPostUrl += 1;
    if (!row.platformPostId) bucket.missingPostId += 1;
    if (!row.authorName) bucket.missingAuthorName += 1;
    if (!row.postedAtText) bucket.missingPostedAtText += 1;
    bucket.maxStepIndex = Math.max(bucket.maxStepIndex, row.stepIndex ?? -1);
    const pat = row.postedAtText ?? 'null';
    bucket.postedAtTextCounts[pat] = (bucket.postedAtTextCounts[pat] || 0) + 1;
  }
  const deepestFresh = rows
    .filter((row) => row.freshness === 'fresh')
    .sort((a, b) => (b.stepIndex ?? -1) - (a.stepIndex ?? -1) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      stepIndex: row.stepIndex,
      postId: row.platformPostId,
      postUrlPresent: Boolean(row.postUrl),
      postedAtText: row.postedAtText,
      authorName: row.authorName,
    }));
  console.log(JSON.stringify({ runId, total: rows.length, byFreshness, deepestFresh }, null, 2));
}
NODE
```

### Verification

```bash
npm test
```

## 4. Backlog Drain Results

### Prior Phase 1 fresh backlog

The March 13 backlog was drained successfully before the new experiment:

- run `2026-03-13T20-43-31-678Z`
  - before drain: `15 pending`, `10 processed`
  - drain result: `claimed 15`, `processed 15`, `retryable 0`, `failed 0`
  - after drain: `25 processed`, `0 pending`
- run `2026-03-13T20-47-43-444Z`
  - before drain: `7 pending`, `10 processed`
  - drain result: `claimed 7`, `processed 7`, `retryable 0`, `failed 0`
  - after drain: `17 processed`, `0 pending`
- queue status after the prior-run drain
  - `pending=0`
  - `retryable=0`
  - `failed=0`

### New experiment fresh backlog

The deeper controller run intentionally used `--process-limit 20`, so the first Phase 1B fresh cycle left `21` pending fresh jobs.
I drained those after the live run:

- run `2026-03-15T15-37-50-960Z`
  - before post-run drain: `21 pending`, `20 processed`
  - drain result: `claimed 21`, `processed 21`, `retryable 0`, `failed 0`
  - after drain: `41 processed`, `0 pending`
- queue status after the post-run drain
  - `pending=0`
  - `retryable=0`
  - `failed=0`

## 5. Investigation Findings From Run-Step / Observation Evidence

### A. The crawl is not stopping because the page stops advancing

The March 13 Phase 1 and March 15 Phase 1B runs did not terminate on `scroll did not advance`.
They ran all the way to the configured scroll budget and still showed late-run page growth.

Representative evidence:

- March 13 run `2026-03-13T20-47-43-444Z` (`max-scrolls=40`)
  - `41` step records
  - last step: `scrollY=21411`, `bodyHeight=27474`
  - late 10-step window:
    - `scrollY` increased in `6/10`
    - `bodyHeight` increased in `8/10`
- March 15 run `2026-03-15T15-37-50-960Z` (`max-scrolls=80`)
  - `81` step records
  - last step: `scrollY=33349`, `bodyHeight=40007`
  - late 15-step window:
    - `scrollY` increased in `7/15`
    - `bodyHeight` increased in `9/15`

Conclusion:

- the browser page is still loading / reshaping deeper content late in the run
- the current ceiling is not a controller failure or an early hard-stop on flat scroll

### B. Saturation happens when fresh disappears while seen / unidentified keep rising

This is the clearest pattern in both Phase 1 and Phase 1B.

March 13 Phase 1:

- run `2026-03-13T20-47-43-444Z`
  - `17 fresh`, `30 seen`, `7 unidentified`
- run `2026-03-13T20-54-00-251Z`
  - `0 fresh`, `47 seen`, `6 unidentified`
  - late 10-step window: `14` added = `10 seen` + `4 unidentified`

March 15 Phase 1B:

- run `2026-03-15T15-37-50-960Z`
  - `41 fresh`, `47 seen`, `15 unidentified`
  - late 15-step window: `21` added = `15 fresh` + `6 unidentified`
- run `2026-03-15T15-50-09-352Z`
  - `0 fresh`, `88 seen`, `19 unidentified`
  - late 15-step window: `23` added = `15 seen` + `8 unidentified`
- run `2026-03-15T16-01-01-833Z`
  - `0 fresh`, `88 seen`, `15 unidentified`
  - late 15-step window: `21` added = `15 seen` + `6 unidentified`

Conclusion:

- later/deeper steps still add cards
- once the reachable unseen band is exhausted, those additions are almost entirely `seen` or `unidentified`
- the current limiter is freshness / identity coverage at depth, not loop correctness

### C. Fresh rows stay identifiable even at depth

Fresh rows did not degrade into missing-identity rows.

March 13 run `2026-03-13T20-47-43-444Z` fresh observations:

- `17` fresh
- `missingPostUrl=0`
- `missingPostId=0`
- `missingAuthorName=0`
- `missingPostedAtText=6`

March 15 run `2026-03-15T15-37-50-960Z` fresh observations:

- `41` fresh
- `missingPostUrl=0`
- `missingPostId=0`
- `missingAuthorName=0`
- `missingPostedAtText=17`

Deepest fresh rows from the March 15 run:

- step `80`: `obs_000584` / Dev Kaul / `postedAtText=null`
- step `79`: `obs_000582` / DJ Gagnon / `postedAtText=1w`
- step `79`: `obs_000583` / Amit Minhas / `postedAtText=1w`
- step `77`: `obs_000579` / Helena Richardson / `postedAtText=1w`
- step `77`: `obs_000580` / Farah Rose / `postedAtText=6d`

Conclusion:

- deeper fresh rows remain processable
- the degradation at depth is not “fresh rows increasingly lose permalink identity”
- the weaker field is `postedAtText`, not `postUrl` / `postId`

### D. Unidentified rows are a real identity limitation, but not the main cause of the ceiling

All unidentified rows were missing both `postUrl` and `postId`.

March 15 run `2026-03-15T15-37-50-960Z` unidentified observations:

- `15` unidentified
- `missingPostUrl=15`
- `missingPostId=15`
- `missingAuthorName=1`
- `missingPostedAtText=11`

Representative deeper unidentified raw artifacts showed:

- selected card roots were `DIV`, not `article`
- only author/time/group links were visible
- `permalinkCandidates` was empty
- `rg` over unidentified raw files found no `/posts/...`, `story_fbid`, `multi_permalinks`, `ft_ent_identifier`, `feedback`, or `permalink.php` strings

Representative deeper unidentified rows:

- `Anonymous member` / `6 days ago`
- `Grace Ahn` / `4 days ago`
- `Mylea Hardy` / `17 minutes ago`

Important nuance:

- some unidentified rows expose older explicit times such as `March 3 at 11:52 AM` and `March 6 at 9:10 PM`
- on March 15, 2026 that means roughly `12d` and `9d` old content exists in the visible DOM
- but those rows are not operationally usable because the current visible signals do not expose a stable permalink / post id

Conclusion:

- unidentified growth is real at depth
- but the current evidence looks like a DOM identity limitation on certain card shapes, not a controller bug
- even those older unidentified samples still do not justify a `3-week` backfill claim

### E. `max-scrolls=40` was too shallow for this source, but `80` still does not reach the target history window

This pass did confirm one of the working assumptions:

- `max-scrolls=40` was materially too shallow for this source if the goal was to push past the prior `~6d` ceiling

Evidence:

- March 13 deepest explicit fresh age: about `6d`
- March 15 deeper run at `max-scrolls=80` produced:
  - `41 fresh` in one run
  - `14` fresh observations with `postedAtText=1w`
  - deepest fresh rows still appearing at steps `77-80`

But the stronger budget did not unlock another unseen band after that:

- the next two full `80`-scroll cycles were `0 fresh`
- both still produced `88 seen`
- both still produced `15-19 unidentified`

Conclusion:

- a bigger scroll budget helped measurably
- but it did not get the crawl close to a `3-week` usable history window

## 6. Live Experiment Table

Shared Phase 1B controller settings:

- `target=60`
- `max-scrolls=80`
- `process-limit=20`
- `sample-limit=3`
- `poll-interval-ms=10000`
- `idle-interval-ms=10000`
- `max-idle-cycles=2`
- `max-cycles=6`
- `settleMs=2000` (default in `ingest:loop`)

| Run ID | Outcome | Target / Max Scrolls / Timing | freshCollected | seenCollected | unidentifiedCollected | Step Count | Queue processed / retryable / failed |
|------|---------|-------------------------------|----------------|---------------|-----------------------|------------|--------------------------------------|
| `2026-03-15T15-37-50-960Z` | fresh | `target=60`, `max-scrolls=80`, `settle=2000ms`, `poll=10000ms`, `idle=10000ms` | `41` | `47` | `15` | `81` | `20 / 0 / 0` during loop; post-run drain added `21 / 0 / 0` |
| `2026-03-15T15-50-09-352Z` | idle | `target=60`, `max-scrolls=80`, `settle=2000ms`, `poll=10000ms`, `idle=10000ms` | `0` | `88` | `19` | `81` | `0 / 0 / 0` |
| `2026-03-15T16-01-01-833Z` | idle | `target=60`, `max-scrolls=80`, `settle=2000ms`, `poll=10000ms`, `idle=10000ms` | `0` | `88` | `15` | `81` | `0 / 0 / 0` |

Controller totals for the bounded session:

- cycles run: `3`
- fresh observations captured during controller run: `41`
- queue processed during controller run: `20`
- queue retryable during controller run: `0`
- queue failed during controller run: `0`
- controller stop reason: `max-idle-cycles`

Post-run queue completion for the fresh cycle:

- additional fresh jobs drained: `21`
- final run queue state for `2026-03-15T15-37-50-960Z`: `41 processed`, `0 pending`, `0 retryable`, `0 failed`

## 7. Depth Assessment

### Deepest explicit postedAtText observed

Fresh usable rows:

- March 13 Phase 1 deepest explicit fresh age: `6d`
  - on March 13, 2026, that implies roughly Saturday, March 7, 2026
- March 15 Phase 1B deepest explicit fresh age: `1w`
  - on March 15, 2026, that implies roughly Sunday, March 8, 2026

Representative deeper fresh rows from the March 15 run:

- `obs_000582` / DJ Gagnon / step `79` / `1w`
- `obs_000583` / Amit Minhas / step `79` / `1w`
- `obs_000579` / Helena Richardson / step `77` / `1w`
- `obs_000577` / Mandy khelly / step `75` / `1w`
- `obs_000569` / Shannon Corcoran / step `71` / `1w`

Older but unusable unidentified rows:

- `March 3 at 11:52 AM`
- `March 6 at 9:10 PM`

Those are evidence that some older content exists in the visible DOM, but they are not operationally usable backfill wins because they still lack `postUrl` / `postId`.

### Is a 3-week claim justified?

No.

What the evidence supports:

- the deeper budget materially improved usable fresh depth from roughly `6d` to roughly `1w`
- the current live browser-relay path can credibly reach at least about one week of identifiable unseen posts for this source

What the evidence does not support:

- a claim of roughly three weeks of usable unseen history
- even the older unidentified samples only reach about `12d`, still short of `3w`
- two subsequent full `80`-scroll cycles were fully idle after the first deeper run

## 8. Issues Found And Fixes Made

### Concrete issues found

1. `max-scrolls=40` was too shallow for this source.
   - This was validated operationally by the `80`-scroll run, not by a code bug.

2. Deep unidentified rows are genuine DOM identity misses.
   - They have body text, author, and sometimes explicit time text.
   - They do not expose recoverable permalink candidates in the visible raw payloads inspected here.

3. Unidentified counts are somewhat noisy because fallback dedupe on no-id cards is not stable when relative time text changes.
   - Example: the same `Mylea Hardy` wanted post reappeared across steps with different minute-level `postedAtText` values.
   - This inflates `unidentifiedCollected` noise.

### Fixes made

No code changes were made.

Reason:

- I did not find a narrow controller or crawl-stop bug that explains the depth ceiling
- the only clear code-level issue I found in-scope was noisy unidentified dedupe, but fixing that would clean metrics rather than materially extend usable backfill depth from `1w` to `3w`
- the main remaining problem is a crawl-policy / DOM-identity limitation, not ingest-loop correctness

## 9. State / Log Artifact Paths

Phase 1B controller artifacts:

- `data/state/ingest-loop/williamsburggreenpointhousing-phase1b.json`
- `data/state/ingest-loop/williamsburggreenpointhousing-phase1b.jsonl`
- configured stop path: `data/state/ingest-loop/williamsburggreenpointhousing-phase1b.stop`

Representative Phase 1B run exports:

- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-15T15-37-50-960Z.json`
- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-15T15-50-09-352Z.json`
- `data/collected/facebook/williamsburggreenpointhousing/crawl-2026-03-15T16-01-01-833Z.json`
- `data/listings/facebook/williamsburggreenpointhousing/crawl-2026-03-15T15-37-50-960Z.json`
- `data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z/`
- `data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-50-09-352Z/`
- `data/raw/facebook/williamsburggreenpointhousing/2026-03-15T16-01-01-833Z/`

## 10. Verification

- browser relay health checks passed against the attached `chrome` profile and the chronological Williamsburg group URL
- prior Phase 1 fresh backlog was drained fully
- deeper Phase 1B controller session completed cleanly
- controller cycle 1 processed fresh observations without retryable/failed jobs
- post-run drain completed the remaining fresh queue backlog from the new run
- final queue state:
  - `pending=0`
  - `retryable=0`
  - `failed=0`
- `inspect:storage validate-run` results:
  - `2026-03-15T15-50-09-352Z`: healthy
  - `2026-03-15T16-01-01-833Z`: healthy
  - `2026-03-15T15-37-50-960Z`: known transitional `summary.extractedListings does not match listing count` issue after queue-derived listings were added
- `npm test` passed
  - `53` tests
  - `0` failures

## 11. Recommendation

Recommendation: **needs a crawl-policy/design pass instead**

Why:

- the controller itself is proven operational
- the deeper budget already isolated that `max-scrolls=40` was not enough
- `max-scrolls=80` did improve depth materially, but only to about one week of usable fresh history
- after that first deeper run, two additional full-depth cycles were idle while still adding only `seen` / `unidentified` cards
- the remaining gap to `3w` is no longer well explained by a small timing/control tweak

What the next pass should focus on:

- whether older wanted / anonymous / non-article card shapes can be made identifiable without redesign creep
- whether a backfill-specific crawl policy should change how overlap is consumed before repeating the same seen band
- whether the current visible chronological feed simply does not expose a three-week usable window through this relay path

Bottom line:

- Phase 2 steady-state freshness work is not the right next PM move if the gate is still “prove roughly 3 weeks of backfill”
- another blind backfill pass with the same policy is unlikely to change the conclusion
- the next useful work item is a targeted crawl-policy / DOM-identity investigation pass, not another controller pass

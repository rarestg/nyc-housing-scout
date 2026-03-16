# 2026-03-15 18:23:42 Deep Unidentified Forensics Pass

## 1. Scope

Investigate why deeper Williamsburg Phase 1 / Phase 1B Facebook observations increasingly land in `freshness=unidentified`, and separate:

- true DOM-level absence of durable post identity
- extractor permalink misses
- wrong card/root selection
- other mixed cases

Stable code boundary for this pass: commit `de0a2e8` (`docs: add Phase 1 backfill session pass`).

Primary target runs:

- `2026-03-13T20-54-00-251Z`
- `2026-03-13T21-05-21-075Z`
- `2026-03-13T21-10-57-864Z`
- `2026-03-15T15-37-50-960Z`
- `2026-03-15T15-50-09-352Z`
- `2026-03-15T16-01-01-833Z`

## 2. Files Changed

- `docs/passes/2026-03-15_18-23-42_DEEP_UNIDENTIFIED_FORENSICS_PASS.md`
- `docs/passes/README.md`

No code changes were made.

## 3. Exact Commands Run

Browser health:

```bash
openclaw browser --browser-profile chrome tabs
openclaw browser status --browser-profile chrome
openclaw browser evaluate --browser-profile chrome --fn '() => ({ title: document.title, href: location.href })'
```

Storage inspection:

```bash
npm run inspect:storage -- observations --run-id 2026-03-13T21-10-57-864Z --freshness unidentified --limit 30 --full
npm run inspect:storage -- observations --run-id 2026-03-15T15-37-50-960Z --freshness unidentified --limit 30 --full
npm run inspect:storage -- observations --run-id 2026-03-15T16-01-01-833Z --freshness unidentified --limit 20 --full
npm run inspect:storage -- run-steps --run-id 2026-03-13T21-10-57-864Z --limit 200
npm run inspect:storage -- run-steps --run-id 2026-03-15T15-37-50-960Z --limit 200
npm run inspect:storage -- artifacts --run-id 2026-03-13T21-10-57-864Z
npm run inspect:storage -- artifacts --run-id 2026-03-15T15-37-50-960Z
```

Raw artifact spot checks:

```bash
sed -n '1,220p' data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z/Mylea-Hardy-000.json
sed -n '1,220p' data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z/Grace-Ahn-016.json
sed -n '1,220p' data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z/Rony-Daou-049.json
sed -n '1,220p' data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z/unknown-author-unknown-time-Hello-Looking-for-a-2-bedrooms-big-living-room-with--053.json
```

Whole-run permalink-pattern sweeps:

```bash
rg -n "posts/|story_fbid|multi_permalinks|ft_ent_identifier|feedback|group_post|permalink\\.php" data/raw/facebook/williamsburggreenpointhousing/2026-03-13T21-10-57-864Z
rg -n "posts/|story_fbid|multi_permalinks|ft_ent_identifier|feedback|group_post|permalink\\.php" data/raw/facebook/williamsburggreenpointhousing/2026-03-15T15-37-50-960Z
```

Unique-artifact sweep across all six deep runs:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createStorage } from './src/storage/storage.js';

const storage = createStorage({ dataDir: path.resolve('data') });
const runIds = [
  '2026-03-13T20-54-00-251Z',
  '2026-03-13T21-05-21-075Z',
  '2026-03-13T21-10-57-864Z',
  '2026-03-15T15-37-50-960Z',
  '2026-03-15T15-50-09-352Z',
  '2026-03-15T16-01-01-833Z',
];
const pattern = /posts\/|story_fbid|multi_permalinks|ft_ent_identifier|feedback|group_post|permalink\.php/i;
const rows = [];
for (const runId of runIds) {
  const observations = storage.listObservations({ runId, freshness: 'unidentified', limit: 200, full: true });
  const byArtifact = new Map();
  for (const row of observations) {
    const key = row.rawArtifactPath || `${runId}:${row.id}`;
    const existing = byArtifact.get(key);
    if (!existing || (row.stepIndex ?? -1) > (existing.stepIndex ?? -1)) {
      byArtifact.set(key, row);
    }
  }
  for (const row of byArtifact.values()) {
    const fullPath = path.resolve(row.rawArtifactPath);
    const text = fs.readFileSync(fullPath, 'utf8');
    const raw = JSON.parse(text);
    const ctx = raw.debugMetadata?.missingPostUrlContext || {};
    const cardAnchors = ctx.cardAnchorEvidence || [];
    const ancestorAnchors = ctx.ancestorAnchorEvidence || [];
    const topSlice = ctx.topSliceSnapshot || [];
    rows.push({
      runId,
      observationId: row.id,
      stepIndex: row.stepIndex,
      rawArtifactPath: row.rawArtifactPath,
      authorName: row.authorName,
      postedAtText: row.postedAtText,
      selectedTag: ctx.selectedCard?.tagName || null,
      selectedIsArticle: ctx.selectedCard?.isArticleCard ?? null,
      selectedAnchorCount: ctx.selectedCard?.anchorCount ?? null,
      authorNodeCount: ctx.selectedCard?.authorNodeCount ?? null,
      topSliceCount: topSlice.length,
      cardAnchorCount: cardAnchors.length,
      ancestorAnchorCount: ancestorAnchors.length,
      anyNormalizedInCard: cardAnchors.some((a) => a.normalizedPostUrl),
      anyNormalizedInAncestor: ancestorAnchors.some((a) => a.normalizedPostUrl),
      anyPatternInFile: pattern.test(text),
      anyExtractedPostIdInCard: cardAnchors.some((a) => a.extractedPostId),
      anyExtractedPostIdInAncestor: ancestorAnchors.some((a) => a.extractedPostId),
      timeHintInCard: cardAnchors.some((a) => a.timeHint),
      timeHintInAncestor: ancestorAnchors.some((a) => a.timeHint),
      selectedText: ctx.selectedCard?.text?.slice(0, 140) || raw.bodyText?.slice(0, 140) || null,
    });
  }
}
storage.close();
const summary = {
  totalUniqueArtifacts: rows.length,
  anyPatternInFile: rows.filter((r) => r.anyPatternInFile).length,
  anyNormalizedInCard: rows.filter((r) => r.anyNormalizedInCard).length,
  anyNormalizedInAncestor: rows.filter((r) => r.anyNormalizedInAncestor).length,
  anyExtractedPostIdInCard: rows.filter((r) => r.anyExtractedPostIdInCard).length,
  anyExtractedPostIdInAncestor: rows.filter((r) => r.anyExtractedPostIdInAncestor).length,
  selectedNoAnchors: rows.filter((r) => (r.selectedAnchorCount || 0) === 0).length,
  selectedNoAuthorNodes: rows.filter((r) => (r.authorNodeCount || 0) === 0).length,
  topSliceZero: rows.filter((r) => (r.topSliceCount || 0) === 0).length,
};
console.log(JSON.stringify({ summary, rows }, null, 2));
NODE
```

Bucket classification:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createStorage } from './src/storage/storage.js';

const storage = createStorage({ dataDir: path.resolve('data') });
const runIds = [
  '2026-03-13T20-54-00-251Z',
  '2026-03-13T21-05-21-075Z',
  '2026-03-13T21-10-57-864Z',
  '2026-03-15T15-37-50-960Z',
  '2026-03-15T15-50-09-352Z',
  '2026-03-15T16-01-01-833Z',
];
const bucketCounts = new Map();
const examples = new Map();
const details = [];
for (const runId of runIds) {
  const observations = storage.listObservations({ runId, freshness: 'unidentified', limit: 200, full: true });
  const byArtifact = new Map();
  for (const row of observations) {
    const key = row.rawArtifactPath || `${runId}:${row.id}`;
    const existing = byArtifact.get(key);
    if (!existing || (row.stepIndex ?? -1) > (existing.stepIndex ?? -1)) {
      byArtifact.set(key, row);
    }
  }
  for (const row of byArtifact.values()) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(row.rawArtifactPath), 'utf8'));
    const ctx = raw.debugMetadata?.missingPostUrlContext || {};
    const cardAnchors = ctx.cardAnchorEvidence || [];
    const ancestorAnchors = ctx.ancestorAnchorEvidence || [];
    let bucket = 'other';
    if (cardAnchors.some((a) => a.normalizedPostUrl || a.extractedPostId) || ancestorAnchors.some((a) => a.normalizedPostUrl || a.extractedPostId)) {
      bucket = 'extractor_miss_permalink';
    } else if ((ctx.selectedCard?.anchorCount || 0) === 0 && (ctx.selectedCard?.authorNodeCount || 0) === 0 && (ctx.topSliceSnapshot || []).length === 0 && ancestorAnchors.length > 0) {
      bucket = 'wrong_card_root';
    } else if (row.authorName || row.postedAtText || cardAnchors.some((a) => a.timeHint || a.text || a.ariaLabel)) {
      bucket = 'weak_identity_only';
    } else if ((ctx.selectedCard?.anchorCount || 0) === 0 && ancestorAnchors.length === 0) {
      bucket = 'dom_absence';
    } else {
      bucket = 'dom_absence';
    }
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    if (!examples.has(bucket)) examples.set(bucket, []);
    if (examples.get(bucket).length < 3) examples.get(bucket).push({ runId, observationId: row.id, stepIndex: row.stepIndex, authorName: row.authorName, postedAtText: row.postedAtText, rawArtifactPath: row.rawArtifactPath });
    details.push({ runId, observationId: row.id, stepIndex: row.stepIndex, bucket, authorName: row.authorName, postedAtText: row.postedAtText, rawArtifactPath: row.rawArtifactPath });
  }
}
storage.close();
console.log(JSON.stringify({
  bucketCounts: Object.fromEntries(bucketCounts),
  examples: Object.fromEntries(examples),
  total: details.length,
}, null, 2));
NODE
```

Per-run bucket breakdown:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createStorage } from './src/storage/storage.js';

const storage = createStorage({ dataDir: path.resolve('data') });
const runIds = [
  '2026-03-13T20-54-00-251Z',
  '2026-03-13T21-05-21-075Z',
  '2026-03-13T21-10-57-864Z',
  '2026-03-15T15-37-50-960Z',
  '2026-03-15T15-50-09-352Z',
  '2026-03-15T16-01-01-833Z',
];
const summary = {};
for (const runId of runIds) {
  const observations = storage.listObservations({ runId, freshness: 'unidentified', limit: 200, full: true });
  const byArtifact = new Map();
  for (const row of observations) {
    const key = row.rawArtifactPath || `${runId}:${row.id}`;
    const existing = byArtifact.get(key);
    if (!existing || (row.stepIndex ?? -1) > (existing.stepIndex ?? -1)) byArtifact.set(key, row);
  }
  const buckets = { weak_identity_only: 0, wrong_card_root: 0, extractor_miss_permalink: 0, dom_absence: 0, other: 0 };
  for (const row of byArtifact.values()) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(row.rawArtifactPath), 'utf8'));
    const ctx = raw.debugMetadata?.missingPostUrlContext || {};
    const cardAnchors = ctx.cardAnchorEvidence || [];
    const ancestorAnchors = ctx.ancestorAnchorEvidence || [];
    let bucket = 'other';
    if (cardAnchors.some((a) => a.normalizedPostUrl || a.extractedPostId) || ancestorAnchors.some((a) => a.normalizedPostUrl || a.extractedPostId)) {
      bucket = 'extractor_miss_permalink';
    } else if ((ctx.selectedCard?.anchorCount || 0) === 0 && (ctx.selectedCard?.authorNodeCount || 0) === 0 && (ctx.topSliceSnapshot || []).length === 0 && ancestorAnchors.length > 0) {
      bucket = 'wrong_card_root';
    } else if (row.authorName || row.postedAtText || cardAnchors.some((a) => a.timeHint || a.text || a.ariaLabel)) {
      bucket = 'weak_identity_only';
    } else if ((ctx.selectedCard?.anchorCount || 0) === 0 && ancestorAnchors.length === 0) {
      bucket = 'dom_absence';
    } else {
      bucket = 'dom_absence';
    }
    buckets[bucket] += 1;
  }
  summary[runId] = { uniqueArtifacts: byArtifact.size, ...buckets };
}
storage.close();
console.log(JSON.stringify(summary, null, 2));
NODE
```

Representative-case dump:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createStorage } from './src/storage/storage.js';

const storage = createStorage({ dataDir: path.resolve('data') });
const cases = [
  ['2026-03-13T21-10-57-864Z', 'obs_000475'],
  ['2026-03-13T21-10-57-864Z', 'obs_000469'],
  ['2026-03-15T15-37-50-960Z', 'obs_000496'],
  ['2026-03-15T15-37-50-960Z', 'obs_000572'],
  ['2026-03-15T15-37-50-960Z', 'obs_000574'],
  ['2026-03-15T15-37-50-960Z', 'obs_000581'],
  ['2026-03-15T15-50-09-352Z', 'obs_000643'],
  ['2026-03-15T15-50-09-352Z', 'obs_000650'],
  ['2026-03-15T15-50-09-352Z', 'obs_000683'],
  ['2026-03-15T16-01-01-833Z', 'obs_000784'],
  ['2026-03-15T16-01-01-833Z', 'obs_000791'],
];
for (const [runId, observationId] of cases) {
  const row = storage.selectObservationById(observationId);
  const raw = JSON.parse(fs.readFileSync(path.resolve(row.rawArtifactPath), 'utf8'));
  const ctx = raw.debugMetadata?.missingPostUrlContext || {};
  const cardAnchors = ctx.cardAnchorEvidence || [];
  const ancestorAnchors = ctx.ancestorAnchorEvidence || [];
  console.log(JSON.stringify({
    runId,
    observationId,
    stepIndex: row.stepIndex,
    authorName: row.authorName,
    postedAtText: row.postedAtText,
    rawArtifactPath: row.rawArtifactPath,
    selectedCard: {
      tagName: ctx.selectedCard?.tagName || null,
      authorNodeCount: ctx.selectedCard?.authorNodeCount ?? null,
      anchorCount: ctx.selectedCard?.anchorCount ?? null,
      text: ctx.selectedCard?.text?.slice(0, 140) || null,
    },
    topSliceCount: (ctx.topSliceSnapshot || []).length,
    cardAnchors: cardAnchors.map((a) => ({
      href: a.href,
      normalizedPostUrl: a.normalizedPostUrl,
      extractedPostId: a.extractedPostId,
      timeHint: a.timeHint,
      text: a.text,
      labelledbyText: a.labelledbyText,
      ariaLabel: a.ariaLabel,
    })),
    ancestorAnchors: ancestorAnchors.slice(0, 4).map((a) => ({
      scope: a.scope,
      href: a.href,
      normalizedPostUrl: a.normalizedPostUrl,
      extractedPostId: a.extractedPostId,
      timeHint: a.timeHint,
      text: a.text,
      labelledbyText: a.labelledbyText,
      ariaLabel: a.ariaLabel,
    })),
  }, null, 2));
}
storage.close();
NODE
```

## 4. Sample Selection Method

1. Start from the six late/deep runs already identified in the Phase 1 and Phase 1B pass docs.
2. Pull `freshness=unidentified` observations for those runs from SQLite.
3. Deduplicate repeated sightings by `rawArtifactPath`, keeping the highest `stepIndex` copy for each artifact so repeated late-step sightings do not overcount the same DOM shape.
4. Bucket-scan all resulting deep unidentified artifacts.
5. Build a representative table of 10 cases:
   - March 13 late-run controls
   - March 15 deeper runs
   - later step indices
   - older explicit timestamps (`March 3`, `March 6`)
   - the body-only anomaly that looked most likely to be a wrong-root selection

This produced `55` unique deep unidentified artifacts across the six target runs.

## 5. Findings Table

| runId | observationId | stepIndex | authorName | postedAtText | Missing identity fields | Raw artifact evidence | Live DOM evidence | Failure bucket | Recoverable by narrow collector fix |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `2026-03-13T21-10-57-864Z` | `obs_000475` | 38 | `Mylea Hardy` | `17 minutes ago` | `postUrl`, `postId` | `cardAnchorEvidence` had 8 anchors: 3 user/profile links, 1 group link with `labelledbyText=17 minutes ago`, plus external/docs noise. No normalized post URL, no extracted post ID, no ancestor permalink evidence. | n/a - current live tab no longer contained this author/time pair | `weak_identity_only` | No |
| `2026-03-13T21-10-57-864Z` | `obs_000469` | 33 | `Grace Ahn` | `4 days ago` | `postUrl`, `postId` | 4 anchors total: profile links plus one group link with `labelledbyText=4 days ago`. No `/posts/`, `story_fbid`, `permalink.php`, normalized URL, or extracted post ID anywhere in saved scope. | n/a - current live tab no longer contained this author/time pair | `weak_identity_only` | No |
| `2026-03-15T15-37-50-960Z` | `obs_000496` | 13 | `Pamela Rogel` | `2 days ago` | `postUrl`, `postId` | 6 anchors: profile links, group timestamp link, and media/learn-more group links. Timestamp existed, but every href remained a group `?__cft__` URL with no recoverable post identity. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |
| `2026-03-15T15-37-50-960Z` | `obs_000572` | 73 | `Sara Shaoul` | null | `postUrl`, `postId`, `postedAtText` | Author was present, but the card had only profile links plus a bare group link. No time text, no permalink form, no extracted post ID, and no ancestor fallback evidence. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |
| `2026-03-15T15-37-50-960Z` | `obs_000574` | 74 | `Rony Daou` | `March 3 at 11:52 AM` | `postUrl`, `postId` | 4 anchors: 3 user/profile links and 1 group timestamp link with `labelledbyText=March 3 at 11:52 AM`. No post permalink or hidden ID in saved card or ancestors. | n/a - manual same-post DOM follow-up was requested but not returned during this pass | `weak_identity_only` | No |
| `2026-03-15T15-37-50-960Z` | `obs_000581` | 79 | null | null | `postUrl`, `postId`, `authorName`, `postedAtText` | Selected root was body-only text (`anchorCount=0`, `authorNodeCount=0`, `topSliceCount=0`). Ancestor anchors belonged to `Alison Jolimet Fages`, not the body text post itself. Still no permalink, but root selection looked wrong. | n/a - manual same-post DOM follow-up was requested but not returned during this pass | `wrong_card_root` | Possibly, but only for this minority shape |
| `2026-03-15T15-50-09-352Z` | `obs_000643` | 45 | `Anonymous member` | `March 6 at 9:10 PM` | `postUrl`, `postId` | Only one anchor existed, and it was a group link with `labelledbyText=March 6 at 9:10 PM`. This is the cleanest DOM-limited case: timestamp visible, no durable post identity at all. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |
| `2026-03-15T15-50-09-352Z` | `obs_000650` | 50 | `Vincent Galia` | `March 6 at 5:08 PM` | `postUrl`, `postId` | 6 anchors: profile links, group timestamp link, and learn-more noise. No normalized post URL or extracted post ID in card or ancestors. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |
| `2026-03-15T15-50-09-352Z` | `obs_000683` | 75 | `Isabel Acosta` | `March 3 at 10:11 AM` | `postUrl`, `postId` | Same late-depth shape as `Rony Daou`: profile links plus group timestamp link only. Older explicit time still did not correspond to a recoverable post permalink in stored DOM. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |
| `2026-03-15T16-01-01-833Z` | `obs_000784` | 74 | `Rony Daou` | `March 3 at 11:52 AM` | `postUrl`, `postId` | Repeat of the same older post in the third March 15 run. The saved DOM again exposed only profile links plus a group timestamp link. This shows the missing durable identity persisted across runs, not just one bad capture. | n/a - current live tab no longer contained this post | `weak_identity_only` | No |

## 6. Failure Summary By Bucket

Across `55` unique deep unidentified artifacts:

- `weak_identity_only`: `52 / 55` (`94.5%`)
- `wrong_card_root`: `3 / 55` (`5.5%`)
- `extractor_miss_permalink`: `0 / 55`
- `dom_absence`: `0 / 55` as a strict bucket
- `other`: `0 / 55`

Per-run breakdown:

| runId | uniqueArtifacts | weak_identity_only | wrong_card_root | extractor_miss_permalink |
| --- | ---: | ---: | ---: | ---: |
| `2026-03-13T20-54-00-251Z` | 4 | 4 | 0 | 0 |
| `2026-03-13T21-05-21-075Z` | 7 | 7 | 0 | 0 |
| `2026-03-13T21-10-57-864Z` | 7 | 7 | 0 | 0 |
| `2026-03-15T15-37-50-960Z` | 12 | 11 | 1 | 0 |
| `2026-03-15T15-50-09-352Z` | 13 | 12 | 1 | 0 |
| `2026-03-15T16-01-01-833Z` | 12 | 11 | 1 | 0 |

Important nuance: the dominant bucket is `weak_identity_only`, but operationally it still means DOM-level absence of durable post identity. These cards usually preserved author and/or time, but not a permalink or extractable post ID.

## 7. Answer To The Key Question

Deep unidentified rows are mostly DOM-limited identity absence, not extractor misses.

Evidence:

- Across all `55` unique deep unidentified artifacts from the six target runs, the saved DOM/debug scope contained:
  - `0` cases with `/posts/`
  - `0` cases with `story_fbid`
  - `0` cases with `multi_permalinks`
  - `0` cases with `ft_ent_identifier`
  - `0` cases with normalized post URLs in `cardAnchorEvidence`
  - `0` cases with normalized post URLs in `ancestorAnchorEvidence`
  - `0` cases with extracted post IDs in card or ancestor anchors
- The dominant deep shape was not "empty card". It was "author/time/group-link only":
  - author present
  - timestamp visible or derivable
  - hrefs still resolve only to group-scoped `?__cft__` links or profile links
  - no durable post identity to recover
- The only recurring non-DOM-limited anomaly was a small wrong-root shape repeated 3 times across March 15 runs. That anomaly is real, but it is not the main deep-backfill limiter.

Bottom line: the current backfill ceiling is not mainly caused by a missed permalink extractor rule. It is mainly caused by Facebook exposing only weak identity signals for many deeper posts in the DOM slices we are able to capture.

## 8. If Recoverable

No broad recoverable extractor bug was found.

The single narrow collector issue worth tracking is the repeated body-only root anomaly:

- selected root had no anchors, no author nodes, and no top-slice context
- nearby ancestor anchors clearly belonged to another post header
- this likely means `closestCard()` occasionally accepts a body fragment instead of the enclosing post card

That is a valid narrow follow-up, but it only affects `3 / 55` sampled deep unidentified artifacts and would not materially change the overall backfill ceiling by itself.

## 9. If Not Recoverable

Backfill implication:

- Blind crawl-depth tuning is unlikely to solve the main deep `unidentified` problem.
- For the dominant deep cases, the stored DOM already includes author/time and still lacks any durable post identifier.
- The next backfill decision therefore needs a crawl-policy/design pass, not another round of generic timing/scroll tuning.

Most likely design-level options, if historical depth remains required:

- find a different DOM capture surface that preserves permalink identity deeper in the feed
- accept that some deep cards are only weakly identifiable and treat them differently in backfill policy
- revisit whether the browser path can recover identity from a different surrounding container than the currently saved scope

## 10. Verification / Manual-Inspection Evidence

- Live browser health was confirmed:
  - attached Chrome tab present
  - profile running on `chrome`
  - live URL still on `https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL`
- `npm test` was not run because this pass made no code changes.
- Current live tab did not contain the sampled March 13 / March 15 author-time pairs in the visible top slice during this pass, so same-post live DOM comparison was not available directly from the attached page state.
- Two targeted manual same-post checks were prepared for user assistance:
  - `obs_000581` (`2026-03-15T15-37-50-960Z`)
  - `obs_000574` (`2026-03-15T15-37-50-960Z`)
- No manual DOM package for those cases was returned during this pass window, so the final classification relies on saved raw artifacts and the extractor's stored debug scopes.
- That limitation does not weaken the main diagnosis materially, because the saved `missingPostUrlContext` already preserved the exact card/anchor evidence needed to falsify the extractor-miss hypothesis. The result of that falsification was `0 / 55` recoverable permalink cases.

## 11. Recommendation For The Next Pass

Recommendation: `needs a crawl-policy/design pass instead`

Reason:

- Do not spend another pass on generic backfill tuning.
- Do not start Phase 2 on the assumption that the collector is merely missing hidden deep permalinks.
- If one more collector-focused pass is desired before policy work, make it extremely narrow:
  - target only the repeated body-only wrong-root anomaly
  - validate whether fixing that shape changes more than `3 / 55` sampled deep unidentified cases

Absent that, the evidence now supports treating deep `unidentified` rows as mostly true DOM identity limitations rather than extractor misses.

# Network-First Integration Pass

Date: 2026-03-15

## 1. Scope

Finish the first real network-first, DOM-assisted crawl path without redesigning the collector:

- retain the right Facebook GraphQL responses in the live crawl
- normalize captured envelopes into candidate post objects during the crawl
- conservatively merge network-derived identity into DOM posts before `recordObservationBatch(...)`
- fix the narrow author-normalization blocker reported by the parser pass
- validate the integrated path on real live crawl runs

Out of scope stayed out of scope:

- no ingest-loop redesign
- no queue redesign
- no extension rewrite
- no broad schema/storage overhaul
- no frontend work

## 2. Files Changed

- `src/browser/network-capture.js`
- `src/browser/facebook-response-parser.js`
- `src/cli/crawl-dom-latest.js`
- `src/core/collected-post.js`
- `src/core/post-cleaning.js`
- `test/network-capture.test.js`
- `test/facebook-post-normalizer.test.js`
- `test/post-cleaning.test.js`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-15_20-10-07_NETWORK_FIRST_INTEGRATION_PASS.md`

## 3. Exact Commands Run

Required reading / code inspection:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,220p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' data/README.md
sed -n '1,220p' docs/passes/2026-03-15_12-15-17_PHASE1B_BACKFILL_DEPTH_INVESTIGATION_PASS.md
sed -n '1,240p' docs/passes/2026-03-15_18-23-42_DEEP_UNIDENTIFIED_FORENSICS_PASS.md
sed -n '1,260p' src/browser/network-capture.js
sed -n '260,620p' src/browser/network-capture.js
sed -n '620,840p' src/browser/network-capture.js
sed -n '1,220p' src/browser/facebook-response-parser.js
sed -n '1,220p' src/browser/facebook-post-normalizer.js
sed -n '1,220p' src/core/collected-post.js
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '260,460p' src/cli/crawl-dom-latest.js
sed -n '1,200p' src/core/post-cleaning.js
sed -n '1,220p' test/network-capture.test.js
sed -n '1,220p' test/facebook-post-normalizer.test.js
```

Static checks / tests:

```bash
node --check src/browser/network-capture.js
node --check src/browser/facebook-response-parser.js
node --check src/cli/crawl-dom-latest.js
node --check src/core/collected-post.js
node --check src/core/post-cleaning.js
node --test test/network-capture.test.js
node --test test/facebook-post-normalizer.test.js
node --test test/post-cleaning.test.js
npm test
```

Browser health / resets:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
openclaw browser --browser-profile chrome navigate "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"
openclaw browser --browser-profile chrome wait --time 2500
```

Live crawl validations:

```bash
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 40 --max-scrolls 6 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 999 --max-scrolls 15 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 999 --max-scrolls 15 --network-target-group-id 2664056243718928
```

Evidence inspection:

```bash
node src/cli/inspect-storage.js observations --run-id 2026-03-15T23-58-15-275Z --limit 20 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T00-02-02-504Z --freshness unidentified --limit 20 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T00-07-20-690Z --limit 25 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T00-07-20-690Z --freshness fresh --limit 10 --full
node src/cli/inspect-storage.js observations --run-id 2026-03-16T00-07-20-690Z --freshness unidentified --limit 10 --full
rg -n "Pamela Rogel|2 bedroom April 1 move in|Holyn Thigpen|Hi! I’m hoping to move" data/raw/facebook/williamsburggreenpointhousing/2026-03-16T00-02-02-504Z/network-capture-2026-03-16T00-02-02-504Z.json -S
```

Targeted artifact analysis:

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { extractFacebookPostCandidatesFromEnvelopeItem, findBestFacebookCandidateForCollectedPost } from './src/browser/facebook-post-normalizer.js';
const artifact = JSON.parse(fs.readFileSync('data/raw/facebook/williamsburggreenpointhousing/2026-03-16T00-02-02-504Z/network-capture-2026-03-16T00-02-02-504Z.json', 'utf8'));
const pamela = JSON.parse(fs.readFileSync('data/raw/facebook/williamsburggreenpointhousing/2026-03-16T00-02-02-504Z/Pamela-Rogel-011.json', 'utf8'));
const collected = { authorName: pamela.authorName, author: pamela.author, bodyText: pamela.bodyText, groupName: 'Williamsburg Greenpoint Housing', groupId: '2664056243718928' };
const candidates = artifact.items.flatMap((item) => extractFacebookPostCandidatesFromEnvelopeItem(item));
const best = findBestFacebookCandidateForCollectedPost(collected, candidates, { minScore: 0 });
console.log(JSON.stringify(best, null, 2));
NODE
```

## 4. Integration Point Chosen And Why

The integration point is inside `crawl-dom-latest`, after each network drain and before each post reaches `recordObservationBatch(...)`.

Flow:

1. drain filtered network envelopes after DOM expansion
2. normalize drained envelopes into network candidates
3. dedupe candidates by identity, preferring richer candidates
4. build each `CollectedPost` from the DOM payload
5. conservatively match a network candidate against that post
6. merge network data before persistence/classification

Why here:

- it is the narrowest place that changes freshness outcomes
- it reuses the landed parser/normalizer and merge helpers
- it keeps the rest of storage/queue code unchanged
- it lets recovered `postId` / `postUrl` affect stable-post classification immediately

## 5. Capture Retention / Filter Policy

Early filter:

- only `/api/graphql/`
- request-side signal on `fb_api_req_friendly_name`, `doc_id`, group ids, post ids, story ids, feedback ids
- promising request names stay limited to feed/story/permalink/focused/group-style GraphQL operations

Full-text retention rule:

- keep `full_text` only when:
  - the request friendly name matches `(group|feed|story|permalink|focused)`
  - and the envelope has target-group or canonical post/story/feedback signals
- general responses still use `maxFullResponseChars=20000`
- high-signal responses use `maxHighSignalFullResponseChars=750000`
- full-text envelopes are capped by `maxFullTextEnvelopes=6` per run
- once the full-text budget is exhausted, later envelopes downgrade to `matched_fragments`

What actually drove live recovery:

- `GroupsCometFeedRegularStoriesPaginationQuery`
- live `doc_id=26843032281964993`

Why this stayed bounded:

- only seven envelopes were captured in the deepest validation run
- six remained `full_text`
- the seventh downgraded to `matched_fragments` because the full-text budget was exhausted

## 6. Matching + Merge Strategy

Candidate pooling:

- normalize each drained envelope with `extractFacebookPostCandidatesFromEnvelopeItem(...)`
- dedupe pool entries by `postId` / `postUrl` / `storyId` / `feedbackId`
- prefer richer candidates:
  - `full_text` over fragments
  - non-partial over partial
  - more body/timestamp/author fields
  - higher parser-selected score

Conservative match rules:

- identified DOM posts can merge on strong exact-id/url matches
- unidentified DOM posts require:
  - `author_exact`
  - and body evidence (`body_strong_overlap`, `body_partial_overlap`, or `body_prefix`)
- this avoids false positives from generic housing-copy overlap across unrelated posts

Merge shape:

- use `mergeCollectedPostWithNetworkData(...)`
- write provenance into `captureHints.networkEnrichment`
- include:
  - request friendly name / doc id
  - match score / reasons
  - selected parser path / score
  - whether DOM already had id/url
  - whether identity was recovered
  - capture id / capture mode / step / phase used for the merge

## 7. Blocking Bugs Found And Fixed

### Author normalization false positive

Real bug:

- `normalizeAuthorName(...)` treated any name containing the substring `iso` as listing-like
- `Alison Jolimet Fages` was being nulled because `Alison` contains `iso`

Fix:

- tightened listing-word checks to use word boundaries instead of raw substring matching
- added focused tests proving:
  - `Alison Jolimet Fages` survives
  - `ISO Room In Williamsburg` is still rejected

### Parser abort on malformed trailing GraphQL stream junk

Real bug:

- some full captured GraphQL responses contained valid leading JSON followed by malformed stream junk
- the parser aborted the whole envelope instead of keeping the earlier valid docs
- this blocked extraction of Pamela’s canonical post object from `netcap_0006`

Fix:

- if at least one valid JSON doc has already been parsed, malformed trailing JSON now becomes a warning and parsing stops cleanly instead of throwing
- added a focused parser test for this case

## 8. Live Validation Runs

Observed runs:

- `2026-03-15T23-58-15-275Z`
  - initial integrated smoke
  - network capture worked
  - only matched fragments were retained at the older size policy
- `2026-03-16T00-00-10-130Z`
  - full-text retention policy live-validated
  - four `full_text` GraphQL envelopes captured
  - no recovered identity yet
- `2026-03-16T00-02-02-504Z`
  - deeper 15-scroll run
  - six `full_text` + one budget-downgraded fragment envelope
  - Pamela still `unidentified`, which exposed the parser trailing-junk bug
- `2026-03-16T00-05-41-628Z`
  - short post-tightening smoke run
  - capture still healthy
- `2026-03-16T00-07-20-690Z`
  - final validating run after parser fix
  - network capture summary:
    - `capturedCount=7`
    - `full_text=6`
    - `matched_fragments=1`
    - `recoveredIdentityCount=1`
  - parser errors dropped to `0`

## 9. Before / After Evidence On Recovered Identity

### Before

Run `2026-03-16T00-02-02-504Z`:

- Pamela appeared twice as DOM-only provisional observations:
  - `Pamela-Rogel-012.json`
  - `Pamela-Rogel-011.json`
- both had:
  - `platformPostId = null`
  - `postUrl = null`
  - `freshness = unidentified`
- the network artifact already contained Pamela’s canonical story in `netcap_0006`, but the parser bailed on trailing malformed JSON

### After

Run `2026-03-16T00-07-20-690Z`:

- observation `obs_000964` at step `14` became:
  - `freshness = fresh`
  - `platformPostId = 24495759786788593`
  - `postUrl = https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24495759786788593/`
  - `storyId = UzpfSTczMzI4OTE3MzpWSzoyNDQ5NTc1OTc4Njc4ODU5Mw==`
  - `feedbackId = ZmVlZGJhY2s6MjQ0OTU3NTk3ODY3ODg1OTM=`
  - `authorId = 733289173`
  - `groupId = 2664056243718928`
  - `groupUrl = https://www.facebook.com/groups/williamsburggreenpointhousing/`
  - `attachmentSummary.count = 1`
- merge provenance:
  - `identityRecovered = true`
  - `matchedCaptureId = netcap_0006`
  - `matchedCaptureMode = full_text`
  - `matchedRetentionReason = high_signal_full_text`
  - `matchReasons = ["author_exact","group_name","body_partial_overlap"]`

This is the first real end-to-end proof that a formerly DOM-unidentified-style post can become a stable identified observation inside the live crawl pipeline.

## 10. Tests Run

- `node --check src/browser/network-capture.js`
- `node --check src/browser/facebook-response-parser.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node --check src/core/collected-post.js`
- `node --check src/core/post-cleaning.js`
- `node --test test/network-capture.test.js`
- `node --test test/facebook-post-normalizer.test.js`
- `node --test test/post-cleaning.test.js`
- `npm test`

Result:

- `npm test` passed: `65/65`

## 11. Remaining Limitations

- The page-context capture point still cannot see the already-loaded top-of-feed requests that happened before installation.
  - This is why the top-step Holyn case in the final run remained `unidentified`.
- Some duplicated DOM representations of the same post can still appear later in the run as provisional cards even after an earlier recovered merge.
  - In the final run, Pamela still appeared once more as a separate provisional DOM-only observation at step `15`.
- The live recovered Pamela case still did not recover `postedAtTimestamp` / `postedAtIso`.
  - The candidate recovered canonical identity, author/group ids, URL, and attachment info, but not exact timestamp in that envelope.
- CDP would still be the better long-term capture point if initial page-load traffic becomes required.

## 12. Recommendation For Next Pass

Highest-value next pass:

- move the narrow Facebook capture path from page-context interception to CDP/network interception, while keeping the same aggressive GraphQL triage rules

Why:

- it removes the “already-loaded top slice is invisible” limitation
- it can capture the first navigation/load, not just later pagination
- it should improve recovery for cases like Holyn that still miss because the relevant network happened before the shim existed

Secondary follow-up:

- dedupe or reconcile repeated provisional DOM cards that appear after an earlier recovered stable observation for the same underlying post

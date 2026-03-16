# Network Identity Resolver Corrective Pass

## Scope

One more correctness pass on the network-first crawl integration, with a short architecture reassessment before changing code.

What I reassessed:

- keep the staged pipeline shape
- keep SQLite as the system of record
- keep the parser/normalizer path that already landed
- do **not** bundle pre-navigation/CDP capture into this pass

What I changed instead:

- stabilize page-context capture state as one live mutable runtime object
- replace ad hoc candidate reuse with a step-aware resolver model
- move the crawl loop to a step working set with late-drain resolution before persistence
- tighten duplicate reuse so Pamela-style overlap copies collapse correctly without reopening run-global fuzzy matching

This pass is a local architecture refactor inside `crawl-dom-latest`, not a repo-wide redesign.

## Files Changed

- `src/browser/network-capture.js`
- `src/cli/crawl-dom-latest.network-integration.js`
- `src/cli/crawl-dom-latest.js`
- `src/core/collected-post.js`
- `test/network-capture.test.js`
- `test/crawl-dom-network-integration.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_00-06-53_NETWORK_IDENTITY_RESOLVER_CORRECTIVE_PASS.md`

## Architecture Decision

No bigger paradigm change is warranted yet.

Why not:

- the main repo shape is still right: collect -> observe -> process -> extract
- the parser/normalizer already proved the network layer can recover canonical Facebook identity
- the bad behavior Euler found came from local state management in the crawl path, not from SQLite, not from the storage interface, and not from the parser

What *was* warranted:

- stop treating network candidate state as a loose pile of flags inside `crawl-dom-latest`
- introduce an explicit resolver boundary with separate exact-identity, fuzzy-recovery, and duplicate-reuse concerns
- make the step boundary real so late drains can still affect identity before persistence

The next major architecture change is still pre-navigation capture below page context. It should remain the next pass, not this one.

## What Changed

### 1. Capture runtime reset now mutates the live installed state

In `src/browser/network-capture.js`:

- reinstall/reset now mutates the already-installed state object instead of replacing it
- live patched fetch/XHR handlers therefore see the reset counters, sequence, and budget state
- run-scoped counters and buffer state are actually per-run under reinstall

This closes Euler’s “stale closed-over state” finding.

### 2. Candidate matching now uses an explicit resolver model

In `src/cli/crawl-dom-latest.network-integration.js`:

- exact identity matches stay source-wide through `postId` / `postUrl`
- fuzzy recovery stays bounded by recent step age and is consumed once when it recovers identity
- duplicate reuse is now separate from fuzzy recovery
- same-run URL-only recovered identities now collapse on canonical `postUrl`

The duplicate reuse fix is important:

- the earlier cleanup pass used `groupId || groupName` as a strict reuse key, which broke when a network-enriched post had numeric `groupId` but later DOM copies only had `groupName`
- it also used overly literal body prefix bucketing, which broke on Facebook spacing drift like `move in!For info` vs `move in!\nFor info`

The corrected model now:

- buckets duplicate reuse by source + author
- requires conservative group compatibility
- lets `findBestFacebookCandidateForCollectedPost(...)` enforce body overlap

That preserves overlap reuse without reopening run-global fuzzy candidate reuse.

### 3. The crawl loop now persists a step working set after late drains

In `src/cli/crawl-dom-latest.js`:

- each step builds a full working set of DOM posts
- network is drained after expand and again at the late step boundary
- still-provisional entries are re-resolved after late drains
- the step is persisted once via `recordObservationBatch(...)`

This removes the prior half-integrated “normalize/export after persistence” behavior.

### 4. Network merge metadata is more explicit

In `src/core/collected-post.js`:

- merge hints now preserve `matchStrategy`
- collected posts retain clearer provenance on whether a merge was exact identity, fuzzy recovery, or duplicate reuse

### 5. Same-run identity aliasing now stays coherent across `postUrl` <-> `postId`

Follow-on review turned up one more local coherence problem:

- a URL-only recovered post could be persisted under `postUrl`
- a later richer copy of the same post could arrive with `postId`
- a later DOM overlap could then see two different in-run identity handles for what was actually one post

I fixed that by:

- aliasing collected posts by both `post_id:*` and `post_url:*`
- keeping the richer collected post when aliases collapse onto one canonical registry entry
- preserving `rawArtifactPath`, comments, media, and attachment summary fields when the richer entry wins
- giving resolver richness scoring explicit credit for `postId`, so richer entries replace URL-only duplicates instead of tying
- canonicalizing equivalent Facebook post URL forms at the collected-post layer, so `story.php`, `permalink.php`, and canonical group post URLs collapse to one same-run identity
- deriving `post_id` aliases from URL-only Facebook permalinks, so slug-vs-numeric group path variants still collapse onto one same-run post identity

### 6. Follow-on review fixes on fuzzy lifecycle and provenance

A fresh review after the resolver refactor found three more real issues:

- fuzzy recovery could reopen if the same logical post reappeared under a richer identity key
- the late resolve pass could overwrite the original recovery provenance with a later exact-identity merge
- alias collapse preserved ids and paths, but still dropped some structured fallback fields

I fixed those by:

- tracking consumed fuzzy identity aliases across `postId`, `postUrl`, `storyId`, and `feedbackId`
- preventing later richer re-registrations from re-entering the fuzzy pool once a post has already been used for fuzzy recovery
- limiting the late resolve pass to still-unresolved, still-unmatched entries
- preserving comments, media, and attachment summary during same-run alias collapse

## Tests Added / Updated

### `test/network-capture.test.js`

- reinstall reset works against the same live closed-over state object
- sequence and full-text budget restart correctly after reset

### `test/crawl-dom-network-integration.test.js`

- overlapping duplicate DOM copies reuse the recovered canonical identity
- same-author unrelated posts do not inherit that earlier identity
- same-step multi-batch drains can still recover identity before finalize
- recent fuzzy candidates stay matchable for a bounded step window, then age out
- duplicate reuse tolerates network `groupId` enrichment plus DOM spacing drift
- URL-only recovered identities use canonical `postUrl` for collected keys and recovery metrics
- mixed `postUrl`/`postId` transitions collapse to one canonical collected post entry
- richer `postId`-bearing duplicate reuse entries replace earlier URL-only entries for the same post
- consumed fuzzy aliases block later richer candidate re-registration from reopening fuzzy recovery
- late-pass resolution preserves the original recovery provenance for already-matched entries
- equivalent Facebook post URL forms normalize to one collected identity alias
- slug-vs-numeric group post URL variants collapse to one collected identity alias
- exact resolver matching canonicalizes slug-vs-numeric group post URLs before indexing

## Commands Run

### Code / test validation

- `node --check src/browser/network-capture.js`
- `node --check src/cli/crawl-dom-latest.network-integration.js`
- `node --check src/cli/crawl-dom-latest.js`
- `node --check src/core/collected-post.js`
- `node --test test/network-capture.test.js`
- `node --test test/crawl-dom-network-integration.test.js`
- `npm test`

### Live validation / inspection

- `openclaw browser --browser-profile chrome navigate "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL"`
- `openclaw browser --browser-profile chrome wait --time 2500`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 999 --max-scrolls 18 --network-target-group-id 2664056243718928`
- `node src/cli/inspect-storage.js runs --source-key williamsburggreenpointhousing --limit 5`
- `node src/cli/inspect-storage.js run-steps --run-id 2026-03-16T03-58-30-179Z --limit 30`
- `node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928`
- `node --input-type=module -e '... Pamela observation query ...'`
- `node --input-type=module -e '... author/freshness count query ...'`
- `node --input-type=module -e '... storage.finishRun(...) for interrupted validation run ...'`

## Test Result

- `npm test`: `82/82` passing

## Live Runs

### Completed validation run

- `2026-03-16T04-03-26-864Z`

Summary:

- `collected = 25`
- `seenCollected = 19`
- `unidentifiedCollected = 6`
- `networkCapture.captured = 8`
- `networkCapture.integration.mergedPosts = 17`
- `postIds` includes `24495759786788593`

### Supporting interrupted validation run

- `2026-03-16T03-58-30-179Z`

This run was operator-interrupted after Pamela verification and then closed as:

- `status = failed`
- `summary.interrupted = true`

It still provided useful step-level evidence that the corrected duplicate resolver was behaving properly before the clean rerun completed.

### Post-fix bounded sanity run

- `2026-03-16T04-45-52-312Z`

Summary:

- `collected = 16`
- `seenCollected = 13`
- `unidentifiedCollected = 3`
- `networkCapture.summary.capturedCount = 1`
- `networkCapture.finalStats.fullTextCaptured = 1`
- `networkCapture.installed.stats.resetAt = 2026-03-16T04:45:54.340Z`

This run did not produce a new recoverable identity case in only two scrolls, but it did confirm that:

- reinstall reset still works on the live page after the follow-on fixes
- the crawl path still completes cleanly with the new collected-post canonicalization and fuzzy-alias consumption logic in place

## Before / After Evidence

### Before

Run `2026-03-16T03-49-18-805Z` still had three Pamela observations:

- `obs_001098`
  - `freshness = seen`
  - `platformPostId = 24495759786788593`
- `obs_001100`
  - `freshness = unidentified`
  - `platformPostId = null`
- `obs_001101`
  - `freshness = unidentified`
  - `platformPostId = null`

Root cause:

- the duplicate reuse path keyed by `groupId || groupName`, so network-enriched Pamela and later DOM-only Pamela copies did not land in the same reuse bucket
- one later DOM copy also had collapsed whitespace, so exact body-prefix bucketing was too brittle

### After

Run `2026-03-16T04-03-26-864Z` has exactly one Pamela observation:

- `obs_001152`
  - `stepIndex = 15`
  - `freshness = seen`
  - `platformPostId = 24495759786788593`
  - `postUrl = https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24495759786788593/`

There are no later Pamela provisional rows in that completed run.

The author/freshness aggregate for `2026-03-16T04-03-26-864Z` is:

- `Pamela Rogel / seen / count = 1`
- all remaining `unidentified` rows are `Neha Manchanda / count = 6`

That closes the Pamela duplicate bug cleanly.

### Reviewer follow-on: URL-only identity coherence

A follow-on review found one remaining inconsistency:

- the resolver already treated `postUrl` as identity, but same-run collected-post keys and recovery metrics still only honored `postId`

I fixed that locally by:

- making `getCollectedPostKey(...)` prefer `postUrl` after `postId`
- making merged fallback dedupe keys prefer `postUrl` when `postId` is absent
- making network recovery metrics treat `postUrl` recovery consistently
- aliasing the in-run collected registry across `postUrl` and `postId`
- preserving richer identity when a URL-only entry later upgrades to `postId`
- canonicalizing equivalent Facebook post URL forms before they become collected identity keys
- deriving `post_id` aliases from URL-only Facebook permalinks so group slug vs numeric path differences still collapse

What this does **not** change:

- cross-run freshness is still `postId`-based in storage
- URL-only identity is therefore a same-run collapse/provenance improvement for now, not a stable-post storage migration

### Reviewer follow-on: lifecycle and provenance

The fresh review after that aliasing fix found three additional issues, and all three were corrected in this pass:

- alias collapse was still dropping structured fallback fields like comments/media/attachment summary
- consumed fuzzy recovery could reopen under a richer later identity key
- the second resolve pass could overwrite the original match strategy and recovered-identity provenance

The added regressions now cover each of those cases directly.

## What Happened To The Final-Drain Gap

I kept the restructure path.

- provisional DOM posts now wait through the late drain loop before persistence
- there is no post-persistence merge-backpatch path in this pass
- the late drain loop is bounded and stops once `remaining === 0`, capture is disabled, or no progress is made

This is simpler and more coherent than trying to mutate already-persisted observations inside the same pass.

## What Happened To Capture Budget Reset

The earlier reset fix remains the right solution:

- reset mutates the live installed state
- counters, sequence, and budget state reset per run
- patched fetch/XHR handlers keep writing into that live state

This pass did not need another capture-runtime redesign after that fix. The resolver work was the real remaining problem.

## Remaining Limitations

- startup blind spot still exists because capture still begins after page-context installation
- already-identified DOM posts are not later back-enriched if a richer network payload arrives after they are persisted
- cross-run stable identity is still keyed by `postId` in storage; URL-only identity does not yet create or reuse `stable_posts`
- unresolved rows are still dominated by true startup/DOM visibility limits, not by the Pamela-style overlap bug

## Recommendation For The Next Pass

Next highest-value pass:

1. pre-navigation capture below page context
2. ideally CDP listeners or an init-script-equivalent armed before `navigate`
3. then re-test the remaining top-slice unidentified cases

That is the right next architectural change. The current pass was about making the existing network-first integration internally coherent first.

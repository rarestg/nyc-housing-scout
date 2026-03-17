# Facebook Identity Canonicalization Simplification Pass

## 1. Scope

Narrow simplification pass for Facebook post identity handling:

- create one shared utility for Facebook post URL canonicalization and post-id extraction
- repoint the active collector/network modules to that shared utility
- remove the local duplicate URL/post-id logic from `facebook-post-normalizer.js`
- keep collected-post normalization, network candidate normalization, and resolver matching working

Explicit non-goals:

- no resolver redesign
- no parser rewrite
- no transport changes
- no storage or queue redesign
- no legacy collector cleanup

## 2. Files Changed

- `src/core/facebook-post-identity.js`
- `src/core/collected-post.js`
- `src/browser/facebook-post-normalizer.js`
- `src/cli/crawl-dom-latest.network-integration.js`
- `test/facebook-post-identity.test.js`
- `test/facebook-post-normalizer.test.js`
- `test/storage-interface.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_17-43-08_FACEBOOK_IDENTITY_CANONICALIZATION_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and code reads:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,260p' docs/ROADMAP.md
sed -n '1,220p' docs/WORKLOG.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' docs/LISTING_SCHEMA.md
sed -n '1,260p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_16-34-20_COLLECTION_PROCESSING_BOUNDARY_SIMPLIFICATION_PASS.md
sed -n '1,320p' src/core/collected-post.js
sed -n '1,320p' src/browser/facebook-post-normalizer.js
sed -n '1,360p' src/cli/crawl-dom-latest.network-integration.js
sed -n '1,260p' test/facebook-post-normalizer.test.js
sed -n '1,360p' test/crawl-dom-network-integration.test.js
rg -n "normalizeFacebookPostUrl|extractFacebookPostIdFromUrl|postId|multi_permalinks|story\\.php|permalink\\.php" src/core/collected-post.js src/browser/facebook-post-normalizer.js src/cli/crawl-dom-latest.network-integration.js src/browser/facebook-response-parser.js test/facebook-post-normalizer.test.js test/crawl-dom-network-integration.test.js
rg -n "extractFacebookPostIdFromUrl|normalizeFacebookPostUrl|buildFallbackPostUrl|buildFacebookFallbackPostUrl" src test
git status --short
git diff -- src/core/facebook-post-identity.js src/core/collected-post.js src/browser/facebook-post-normalizer.js src/cli/crawl-dom-latest.network-integration.js test/facebook-post-identity.test.js test/facebook-post-normalizer.test.js test/storage-interface.test.js
```

Checks and tests:

```bash
node --check src/core/facebook-post-identity.js
node --check src/core/collected-post.js
node --check src/browser/facebook-post-normalizer.js
node --check src/cli/crawl-dom-latest.network-integration.js
node --check test/storage-interface.test.js
node --test test/facebook-post-identity.test.js
node --test test/facebook-post-normalizer.test.js
node --test test/crawl-dom-network-integration.test.js
node --test test/storage-interface.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-16T21-42-33-698Z
```

## 4. Shared Utility Chosen And Why

Shared owner:

- `src/core/facebook-post-identity.js`

It now owns the active Facebook post identity rules in one place:

- `normalizeFacebookPostUrl(...)`
- `extractFacebookPostIdFromUrl(...)`
- `buildFacebookFallbackPostUrl(...)`

Why this location:

- it is shared by collector normalization, browser/network normalization, and resolver matching
- identity is a core correctness concern, not a browser-only concern
- `crawl-dom-latest.network-integration.js` was already treating the collected-post helpers as the effective canonical rules, so moving them into `src/core/` makes that relationship explicit instead of incidental

## 5. Duplicate Logic Removed

Removed:

- the local `normalizeFacebookPostUrl(...)` implementation from `src/browser/facebook-post-normalizer.js`
- the local `buildFallbackPostUrl(...)` implementation from `src/browser/facebook-post-normalizer.js`
- ownership of `normalizeFacebookPostUrl(...)` and `extractFacebookPostIdFromUrl(...)` inside `src/core/collected-post.js`

After the pass:

- `src/core/collected-post.js` imports the shared identity utility
- `src/browser/facebook-post-normalizer.js` imports the shared identity utility
- `src/cli/crawl-dom-latest.network-integration.js` imports the shared identity utility directly for exact-identity keys and canonical URL matching

This also removes the old “near-same but not quite the same” split where:

- collected-post canonicalization preferred the collected-post rules
- network normalization had its own adjacent URL logic
- resolver matching depended on the collected-post version

## 6. Test Coverage Added Or Updated

Added:

- `test/facebook-post-identity.test.js`

That test now makes the supported canonical shapes explicit:

- `story.php`
- `permalink.php`
- `multi_permalinks`
- `m.facebook.com` to `www.facebook.com` normalization
- canonical group-post fallback construction from `postId` + group context
- post-id extraction from canonical and query-driven Facebook URLs

Updated:

- `test/facebook-post-normalizer.test.js`
  - now expects the network normalizer to emit the same canonical `postUrl` shape used by the shared utility
- `test/crawl-dom-network-integration.test.js`
  - existing resolver/alias tests remained green against the shared canonicalization without behavioral rewrites

Incidental full-suite hardening:

- `test/storage-interface.test.js` now derives the expected migration count from the actual migration files on disk instead of a stale hard-coded value, so `npm test` remains a useful suite gate as migrations grow

## 7. Live Validation Run

Bounded crawl command:

```bash
node src/cli/crawl-dom-latest.js \
  --browser-profile chrome \
  --source-key williamsburggreenpointhousing \
  --source-name "Williamsburg Greenpoint Housing" \
  --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" \
  --target 20 \
  --max-scrolls 2 \
  --network-target-group-id 2664056243718928
```

Run id:

- `2026-03-16T21-42-33-698Z`

Result summary:

- `collected = 10`
- `freshCollected = 0`
- `seenCollected = 10`
- `unidentifiedCollected = 0`
- `networkCapture.requestedMode = "cdp"`
- `networkCapture.transport = "cdp"`
- `networkCapture.integration.candidatesExtracted = 6`
- `networkCapture.integration.mergedPosts = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-16T21-42-33-698Z`
- result: healthy, no issues

## 8. Risks Or Remaining Coupling

- This pass unified URL/post-id canonicalization, but the resolver still has its own state-machine complexity for exact identity, fuzzy recovery, and resolved-duplicate reuse.
- Encoded `storyId` / `feedbackId` decoding still lives in `src/browser/facebook-post-normalizer.js`. That is adjacent identity logic, but it is not the same duplication seam as URL/post-id canonicalization and I left it alone in this pass.
- Network candidate records now emit the same canonical `postUrl` shape that collected-post and resolver matching already used internally. That is a small semantic alignment, not a broader URL-model redesign.
- Historical collectors and historical artifact layouts were intentionally left untouched.

## 9. Recommendation For The Next Simplification Pass

Shrink `src/cli/crawl-dom-latest.network-integration.js` around a smaller resolver state model.

Why this is next:

- transport branching is already simplified
- collection no longer performs inline listing extraction
- Facebook URL/post-id canonicalization is now shared
- the remaining highest-cost reasoning surface in the active path is the resolver state machine around exact identity, fuzzy candidate retention, and resolved duplicate reuse

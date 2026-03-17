# Network Resolver Simplification Pass

## 1. Scope

Narrow simplification pass for the active Facebook network resolver in `crawl-dom-latest.network-integration.js`.

Goals:

- shrink the resolver state model
- keep exact identity enrichment working through canonical `postId` / `postUrl`
- keep Pamela-style duplicate reuse for overlapping DOM copies
- keep Alison-style conservative fuzzy recovery with a bounded step window
- preserve late-pass provenance behavior

Explicit non-goals:

- no parser rewrite
- no transport changes
- no storage or queue redesign
- no CDP/page-context changes
- no broader collected-post redesign

## 2. Files Changed

- `src/cli/crawl-dom-latest.network-integration.js`
- `test/crawl-dom-network-integration.test.js`
- `docs/passes/README.md`
- `docs/passes/2026-03-16_18-03-31_NETWORK_RESOLVER_SIMPLIFICATION_PASS.md`

## 3. Exact Commands Run

Context and pass-history reads:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/INDEX.md
sed -n '1,260p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,220p' docs/ROADMAP.md
sed -n '1,260p' docs/PIPELINE.md
sed -n '1,220p' data/README.md
sed -n '1,260p' docs/FACEBOOK_CAPTURE_NOTES.md
sed -n '1,260p' docs/reviews/2026-03-16_11-58-48_FACEBOOK_CAPTURE_SIMPLIFICATION_REVIEW.md
sed -n '1,260p' docs/passes/2026-03-16_00-06-53_NETWORK_IDENTITY_RESOLVER_CORRECTIVE_PASS.md
sed -n '1,240p' docs/passes/2026-03-16_15-51-00_CAPTURE_TRANSPORT_SIMPLIFICATION_PASS.md
sed -n '1,240p' docs/passes/2026-03-16_16-34-20_COLLECTION_PROCESSING_BOUNDARY_SIMPLIFICATION_PASS.md
sed -n '1,260p' docs/passes/2026-03-16_17-43-08_FACEBOOK_IDENTITY_CANONICALIZATION_SIMPLIFICATION_PASS.md
sed -n '1,220p' docs/passes/README.md
```

Code and test reads:

```bash
sed -n '1,260p' src/cli/crawl-dom-latest.network-integration.js
sed -n '261,520p' src/cli/crawl-dom-latest.network-integration.js
sed -n '520,900p' src/cli/crawl-dom-latest.network-integration.js
sed -n '1,260p' src/cli/crawl-dom-latest.js
sed -n '260,520p' src/cli/crawl-dom-latest.js
sed -n '520,760p' src/cli/crawl-dom-latest.js
sed -n '760,960p' src/cli/crawl-dom-latest.js
sed -n '1,260p' src/core/collected-post.js
sed -n '1,260p' src/core/facebook-post-identity.js
sed -n '1,260p' src/browser/facebook-post-normalizer.js
sed -n '520,920p' src/browser/facebook-post-normalizer.js
sed -n '920,1240p' src/browser/facebook-post-normalizer.js
sed -n '1,320p' test/crawl-dom-network-integration.test.js
sed -n '321,640p' test/crawl-dom-network-integration.test.js
rg -n "function findBestFacebookCandidateForCollectedPost|export function findBestFacebookCandidateForCollectedPost|extractFacebookPostCandidatesFromEnvelopeItem" src/browser/facebook-post-normalizer.js
rg -n "createWorkingSetEntry|resolveWorkingSetEntries|resolveWorkingSetEntry|recordAcceptedNetworkMerge|candidateEntries|fuzzyCandidateKeys|resolvedDomReuseIndex|consumedFuzzyIdentityKeys|exactIdentityIndex" src/cli/crawl-dom-latest.network-integration.js src/cli/crawl-dom-latest.js test/crawl-dom-network-integration.test.js
git status --short
```

Checks and tests:

```bash
node --check src/cli/crawl-dom-latest.network-integration.js
node --check test/crawl-dom-network-integration.test.js
node --test test/crawl-dom-network-integration.test.js
rg -n "candidateEntries|exactIdentityIndex|fuzzyCandidateKeys|consumedFuzzyIdentityKeys|resolvedDomReuseIndex" src test
node --check src/cli/crawl-dom-latest.js
node --test test/facebook-post-identity.test.js test/facebook-post-normalizer.test.js test/network-capture.test.js test/crawl-dom-network-integration.test.js
npm test
```

Live validation:

```bash
openclaw browser --browser-profile chrome --json status
openclaw browser --browser-profile chrome --json tabs
node src/cli/crawl-dom-latest.js --browser-profile chrome --source-key williamsburggreenpointhousing --source-name "Williamsburg Greenpoint Housing" --source-url "https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL" --target 20 --max-scrolls 2 --network-target-group-id 2664056243718928
npm run inspect:storage -- validate-run --run-id 2026-03-16T22-02-39-342Z
```

## 4. Old Resolver Model Vs New Resolver Model

### Old model

The resolver was split across one candidate store plus four auxiliary structures:

- `candidateEntries`
- `exactIdentityIndex`
- `fuzzyCandidateKeys`
- `consumedFuzzyIdentityKeys`
- `resolvedDomReuseIndex`

On top of that, fuzzy lifecycle depended on:

- per-step pruning
- re-consumption passes
- entry-level `fuzzyConsumed`
- separate duplicate reuse buckets

That worked, but the mental model was spread across registration, pruning, matching, and post-match cleanup.

### New model

The resolver now uses:

- one authoritative `entries` map for both network candidates and resolved-post reuse entries
- one `identityAliases` map for network-entry alias collapse and exact identity lookup

Each stored entry carries its own role:

- `entryType`
- `allowExactIdentityMatch`
- `allowFuzzyRecovery`
- `allowDuplicateReuse`
- `fuzzyConsumed`
- `stepIndex`
- `identityAliases`
- `reuseKey` / `reuseParts`

Matching flow is now:

1. exact identity: look up the DOM post’s canonical `postId` / `postUrl` aliases in `identityAliases`
2. duplicate reuse: scan `entries` for `allowDuplicateReuse` entries in the same author/source bucket and let Facebook-specific body scoring choose the best one
3. fuzzy recovery: scan `entries` for `allowFuzzyRecovery` network entries that are still within the bounded step window and not `fuzzyConsumed`

## 5. State Removed Or Collapsed

Removed:

- `exactIdentityIndex`
- `fuzzyCandidateKeys`
- `consumedFuzzyIdentityKeys`
- `resolvedDomReuseIndex`
- explicit fuzzy-pruning passes at `beginNetworkIntegrationStep(...)`

Collapsed:

- `candidateEntries` became the general `entries` store
- exact identity aliasing, richer-candidate collapse, and consumed-fuzzy preservation now flow through `identityAliases` plus the stored entry flags

Retained because it still carries real meaning:

- `fuzzyConsumed`
  - it remains, but only as one per-network-entry flag instead of participating in a separate consumed-alias set and pruning cycle

## 6. Simplified Resolver Invariants

The resolver now depends on these concrete invariants:

1. Every reusable thing is an entry in `state.entries`.
2. Only network entries are indexed in `state.identityAliases`.
3. Exact identity matching only consults canonical `post_id:*` and `post_url:*` aliases.
4. Fuzzy recovery eligibility is derived, not tracked:
   - network entry
   - identity-bearing
   - within `maxFuzzyCandidateStepAge`
   - not `fuzzyConsumed`
5. Duplicate reuse eligibility is derived, not bucket-managed:
   - `allowDuplicateReuse`
   - same source+author reuse key
   - conservative group compatibility
   - Facebook body/author evidence still decides the final match
6. Richer re-registrations collapse onto an existing network entry through alias overlap, so a consumed fuzzy candidate stays consumed when later aliases arrive.
7. Resolved duplicate-reuse entries live in the same store as network entries but use `resolved:`-prefixed keys so they never overwrite the underlying network entry.

## 7. Test Coverage Added Or Updated

Updated `test/crawl-dom-network-integration.test.js` to preserve the existing correctness surface while asserting the simplified model:

- Pamela-style overlap reuse still resolves later weak DOM copies through `resolved_duplicate`
- duplicate reuse still tolerates group-id enrichment plus DOM spacing drift
- exact identity matching still canonicalizes slug and numeric group post URLs
- URL-only recovered identity still canonicalizes to the stable collected key
- richer resolved reuse entries still replace older URL-only reuse entries
- fuzzy recovery still stays consumed when richer aliases arrive later
- same-step late drains still recover identity before finalize
- late-pass resolution still preserves original recovery provenance
- bounded fuzzy recovery still expires by step age

Suite results:

- targeted resolver/identity/network tests: `26/26` passing
- full suite: `95/95` passing

## 8. Live Validation Run

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

- `2026-03-16T22-02-39-342Z`

Result:

- `collected = 12`
- `freshCollected = 0`
- `seenCollected = 12`
- `unidentifiedCollected = 0`
- `networkCapture.requestedMode = "cdp"`
- `networkCapture.transport = "cdp"`
- `networkCapture.integration.candidatesExtracted = 6`
- `networkCapture.integration.pooledCandidates = 6`
- `networkCapture.integration.mergedPosts = 0`

Storage validation:

- `npm run inspect:storage -- validate-run --run-id 2026-03-16T22-02-39-342Z`
- result: healthy, `issues = []`

This run did not hit a fresh Pamela/Alison-style recovery case in only two scrolls, but it did confirm that the active crawl path still completes, persists, and validates with the simplified resolver in place.

## 9. Risks Or Remaining Complexity

No intended external behavior changed.

One small internal behavior change did land:

- resolved-post reuse entries now use `resolved:`-prefixed keys inside the unified entry store so they cannot collide with the network entry they were derived from

Remaining justified complexity:

- Facebook candidate scoring still belongs in `facebook-post-normalizer.js`; the resolver should not try to simplify those semantics away
- duplicate reuse still needs conservative group compatibility plus body evidence to avoid broad same-author reuse
- the crawl loop still has separate phases for expand, drain, late-drain, resolve, persist, and step logging

## 10. Recommendation For The Next Simplification Pass

Take the next narrow pass at the working-set orchestration in `src/cli/crawl-dom-latest.js`.

Why this is next:

- the resolver state machine is now materially smaller
- the biggest remaining reasoning hotspot in the active path is the step loop that stages DOM posts, drains network capture, reruns resolution, persists observations, and duplicates network summary shaping into step logs and final output
- that pass can stay narrow and behavior-preserving: simplify the crawl-step lifecycle now that the resolver contract is clearer

# Facebook Capture Simplification Review

Date: 2026-03-16

## 1. Scope

Assess the active Facebook collector and backend ingestion path for simplification opportunities while preserving the current product outcome:

- DOM feed capture from the attached Chrome tab
- network-assisted identity recovery
- SQLite-backed observation persistence
- current crawl-stage artifact and run-step reporting

This review is intentionally not a feature plan. It is a simplification plan. I did not take on storage redesign, queue redesign, frontend work, or a parser rewrite.

## 2. Files Inspected

Docs and pass history:

- `README.md`
- `docs/INDEX.md`
- `docs/VISION_AND_ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/PIPELINE.md`
- `data/README.md`
- `docs/FACEBOOK_CAPTURE_NOTES.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-15_20-10-07_NETWORK_FIRST_INTEGRATION_PASS.md`
- `docs/passes/2026-03-15_20-45-14_NETWORK_INTEGRATION_CORRECTNESS_PASS.md`
- `docs/passes/2026-03-16_00-06-53_NETWORK_IDENTITY_RESOLVER_CORRECTIVE_PASS.md`
- `docs/passes/2026-03-16_10-39-18_PRE_NAVIGATION_CDP_CAPTURE_PASS.md`
- `docs/passes/2026-03-16_10-59-55_PRE_NAVIGATION_CDP_CAPTURE_CORRECTIVE_PASS.md`
- `docs/reviews/README.md`

Active collector/backend code:

- `src/browser/dom-extractor.js`
- `src/browser/dom-helpers.js`
- `src/browser/network-capture.js`
- `src/browser/cdp-network-capture.js`
- `src/browser/facebook-response-parser.js`
- `src/browser/facebook-post-normalizer.js`
- `src/cli/capture-dom-feed.js`
- `src/cli/crawl-dom-latest.js`
- `src/cli/crawl-dom-latest.network-integration.js`
- `src/core/browser-pipeline.js`
- `src/core/collected-post.js`
- `src/core/post-cleaning.js`

Historical collector code inspected for simplification tax:

- `src/cli/capture-feed.js`
- `src/cli/crawl-latest.js`
- `src/core/feed-parser.js`

Tests:

- `test/network-capture.test.js`
- `test/cdp-network-capture.test.js`
- `test/crawl-dom-network-integration.test.js`
- `test/facebook-post-normalizer.test.js`

## 3. Current Architecture

The current collector is a DOM-first crawl with optional network assist, but the implementation is still carrying multiple generations of collector evolution at once. `crawl-dom-latest.js`, `crawl-dom-latest.network-integration.js`, `network-capture.js`, `cdp-network-capture.js`, `facebook-post-normalizer.js`, and `collected-post.js` alone are about 5,100 lines, with another 1,286 targeted test lines around them. Conceptually the path is:

1. extract visible DOM posts
2. optionally drain Facebook GraphQL envelopes from either page-context interception or CDP
3. normalize envelopes into candidate posts
4. resolve DOM posts against exact identity, fuzzy recovery, and duplicate reuse state
5. persist observations to SQLite
6. still do transitional inline listing extraction during collection
7. write step logs, run summaries, and a separate network capture artifact

The product behavior is useful. The implementation boundary is not yet clean.

## 4. Good Complexity Worth Keeping

- DOM-first collection is the right base. The MVP rule from `docs/FACEBOOK_CAPTURE_NOTES.md` still holds: expanded post text plus permalink is the valuable primitive.
- A shared network-envelope contract is worth keeping. Both capture transports feed the same downstream parser/normalizer shape, which is the right boundary.
- The parser/normalizer is justified complexity. Facebook GraphQL is noisy and multi-shape; the ability to recover post identity from full text and matched fragments is earning its cost.
- Conservative merge rules are good complexity. Exact identity, author/body evidence, and late resolution before persistence are protecting against false merges.
- Step-scoped late-drain behavior is worth keeping. It is much simpler and safer than post-persistence backpatching.
- SQLite observation persistence is at the right boundary. Collection ends at `recordObservationBatch(...)`; that separation should remain explicit.
- Bounded capture retention is good. The full-text budget, fragment fallback, and run-scoped export keep the network layer inspectable without turning into raw traffic dumping.

## 5. Accidental Complexity To Remove

- Two first-class network capture transports are still modeled as peers even though CDP is now the stronger path and page-context exists mostly as historical fallback.
- `crawl-dom-latest.js` is doing too many jobs: transport selection, target pinning, drain scheduling, working-set resolution, artifact writing, persistence, inline extraction, step logging, and final summary shaping.
- The resolver in `crawl-dom-latest.network-integration.js` is carrying a lot of bug-fix sediment: `candidateEntries`, `exactIdentityIndex`, `fuzzyCandidateKeys`, `consumedFuzzyIdentityKeys`, `resolvedDomReuseIndex`, plus step-age rules and entry-level `fuzzyConsumed`.
- Facebook identity logic is duplicated across modules. URL normalization and post-id extraction live in both `facebook-post-normalizer.js` and `collected-post.js`, with similar but not identical rules.
- Transitional inline listing extraction still runs inside `capture:dom` and `crawl:dom` even though the queue is documented as the intended processing boundary.
- The repo still carries the older snapshot collector path (`capture-feed`, `crawl-latest`, `feed-parser`) in addition to the real DOM path.
- Observability payload shaping is duplicated. The crawl assembles near-duplicate network step metrics for `stepLog`, `appendRunStep(...)`, the final run summary, and the separate network artifact.
- The CLI surface exposes many low-level `--network-*` tuning knobs that look more like pass-debug controls than stable operator controls.

## 6. Top Simplification Opportunities, Prioritized

### 1. Make CDP the canonical network capture path and demote page-context to explicit fallback/debug only

What to simplify:

- Treat `cdp + pre-navigation capture` as the real Facebook path.
- Stop modeling `page_context` as a co-equal normal runtime path.
- Keep page-context only as a temporary escape hatch while validating CDP stability, then delete it.

Why this is high-value:

- It would remove the biggest conceptual fork in the collector.
- It would let the team delete a large amount of custom page-context interception code and tests later.
- It would make startup semantics obvious: arm before navigation or do not claim startup capture.

Expected payoff:

- Less code.
- Fewer transport-specific bugs.
- Clearer docs and operator behavior.
- Easier reasoning about what "network assist enabled" actually means.

Risk / constraints:

- Do not delete the page-context path before a small number of live validations on the actual operator setup.
- CDP readiness still depends on the OpenClaw relay and attached target state.
- Defaulting this path cleanly also implies deciding whether `--navigate-before-crawl` should become implicit when CDP is active.

Assessment:

- There is now a cleaner canonical path.
- The repo does not need both paths as first-class architecture anymore.
- It likely still needs page-context as a short-term fallback, but not as equal design center.

### 2. Remove transitional inline listing extraction from the collection CLIs

What to simplify:

- Stop doing heuristic listing extraction inside `capture-dom-feed.js` and `crawl-dom-latest.js`.
- Stop writing collection-time listing rows/artifacts as part of normal crawl success.
- Make the collector end at observations plus artifacts, and let queue/extraction own listing creation.

Why this is high-value:

- This is the clearest example of historical experimentation still charging rent.
- The docs already say the queue is the intended processing boundary and the inline path is transitional.
- It is creating summary ambiguity and duplicate write paths for the same logical outcome.

Expected payoff:

- Cleaner module boundary: collection vs processing.
- Lower regression risk during collector changes because extractor output is no longer coupled to crawl behavior.
- Less confusion in run summaries and listing counts.

Risk / constraints:

- If the operator still depends on immediate crawl-time listing exports, remove this only after confirming the queue path is acceptable for that workflow.
- If quick regression comparison against `data/listings/...` is still valuable, preserve it as an explicit debug/export command rather than default crawl behavior.

Assessment:

- This should be deleted rather than generalized.
- Do not build more abstraction around "optional inline extraction"; it is transitional plumbing.

### 3. Collapse Facebook identity canonicalization into one shared module

What to simplify:

- Move canonical Facebook URL normalization and post-id extraction into one shared identity utility.
- Reuse it from `facebook-post-normalizer.js`, `collected-post.js`, and the network resolver.

Why this is high-value:

- Identity is the critical correctness boundary.
- Right now the same concept exists in multiple places with near-duplicate logic.
- Drift here is expensive because the resolver, collected registry, and network candidates can disagree about sameness.

Expected payoff:

- Fewer alias/normalization bugs.
- Smaller surface for future identity fixes.
- Better refactorability because one module owns the canonical rules.

Risk / constraints:

- This should be done as a behavior-preserving extraction, not a semantic rewrite.
- Existing tests around slug-vs-numeric group URLs, `story.php`, `permalink.php`, and URL-only recovery should be preserved first.

Assessment:

- This is safe medium-term cleanup.
- It is not glamorous, but it pays down correctness risk directly.

### 4. Shrink the resolver state model after transport canonicalization

What to simplify:

- Reassess whether the current resolver really needs all three live matching tracks:
  - exact identity index
  - fuzzy candidate pool with consumed alias bookkeeping
  - resolved duplicate reuse registry
- Prefer a smaller explicit model once the transport and timing story are stable.

Why this is high-value:

- This is the most overbuilt part of the active path.
- Most of its complexity exists because several corrective passes solved specific Pamela/Alison-style failures without re-cutting the boundary.
- The helper file is effectively a state machine, not just an integration helper.

Expected payoff:

- Much easier reasoning about why a post matched.
- Lower maintenance cost when future correctness bugs appear.
- Smaller test surface for one-off lifecycle edge cases.

Risk / constraints:

- Do not do this first.
- The current model is ugly, but it is also the place protecting real correctness fixes.
- Simplify only after the transport decision is made and live evidence shows which match modes are still materially needed.

Assessment:

- This abstraction should be reduced, not generalized into a reusable "identity engine."
- Keep it Facebook-specific and smaller.

### 5. Quarantine or delete the old snapshot collector path

What to simplify:

- Remove `capture-feed`, `crawl-latest`, and the old snapshot parser from normal docs and active mental model.
- If they must stay temporarily, mark them as legacy and stop treating them as fallback equals.

Why this is high-value:

- They duplicate collector concepts, artifact layouts, and freshness behavior from a superseded architecture.
- They keep older data layouts and older operator stories alive in the repo.

Expected payoff:

- Cleaner repo navigation.
- Less historical noise when reasoning about the real collector.
- Fewer chances of accidental reuse of stale paths.

Risk / constraints:

- Low technical risk if these commands are genuinely unused.
- If they are still used for debugging, move them into a clearly marked legacy/debug area before deletion.

Assessment:

- This is a pure historical-experimentation tax.
- It should be deleted or quarantined, not modernized.

## 7. Expected Payoff Of Each Opportunity

1. Canonical CDP path: largest reduction in conceptual branching and duplicated capture plumbing.
2. Remove inline extraction: clearest boundary cleanup and easiest way to stop cross-stage leakage.
3. Shared identity utilities: medium-size code reduction with direct correctness payoff.
4. Smaller resolver state: major reasoning payoff, but only after earlier simplifications reduce uncertainty.
5. Remove legacy snapshot path: immediate repo hygiene and lower cognitive load.

## 8. Risk / Constraints For Each Opportunity

1. Canonical CDP path: validate real operator reliability before deleting the fallback.
2. Remove inline extraction: confirm no current workflow depends on immediate listing artifacts from collection.
3. Shared identity utilities: preserve existing normalization behavior and tests during extraction.
4. Smaller resolver state: do not simplify away real correctness protections prematurely.
5. Remove legacy snapshot path: confirm it is not still part of any debugging SOP.

## 9. Recommended Sequence For Simplification Work

1. Decide the canonical transport: CDP should become the default mental model and likely the default runtime path.
2. Once that is stable, remove transitional inline listing extraction so collection ends cleanly at observations/artifacts.
3. Extract shared Facebook identity utilities and delete duplicated normalization logic.
4. Re-cut the resolver boundary with the reduced transport surface and the cleaner identity primitive.
5. Remove or quarantine the old snapshot collector path.
6. As a low-risk cleanup pass, de-duplicate step/output metric shaping and trim non-essential `--network-*` CLI knobs.

## 10. Do Not Touch Yet

Do not simplify these pieces yet, even if they look ugly:

- Do not relax the conservative merge thresholds. False identity merges are more dangerous than extra unresolved posts.
- Do not remove late-drain and idle-flush behavior. Those protections closed real race and timing bugs.
- Do not rewrite the parser/normalizer right now. It is large, but it is already paying for itself.
- Do not do a broad async browser-control rewrite just to make CDP prettier. That is a later cleanup, not the first simplification win.
- Do not collapse exact identity, fuzzy recovery, and duplicate reuse into one looser matcher until the transport path is settled and the live evidence says one mode is redundant.

## Bottom Line

The collector is carrying too much custom plumbing now, but not because the core product idea is wrong. The good complexity is the DOM capture, bounded GraphQL recovery, conservative merge, and SQLite persistence boundary. The accidental complexity is the coexistence of two first-class transport paths, a transitional inline extraction path that should already be gone, duplicated identity logic, and a resolver state machine that absorbed multiple corrective passes without a simplification pass afterward.

If I had to simplify one thing first, I would make CDP the canonical capture path and demote page-context immediately at the design level, even if the fallback code survives one more pass. If I had to simplify one thing second, I would remove inline listing extraction from collection and let the queue become the actual boundary the docs already describe.

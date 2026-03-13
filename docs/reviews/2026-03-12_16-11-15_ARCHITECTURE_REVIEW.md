# Architecture Review — 2026-03-12

## Scope

This review is based on the actual implementation in:

- `src/browser/*`
- `src/cli/*`
- `src/core/*`
- `src/extractors/*`
- `package.json`
- representative persisted artifacts in `data/raw/*` and `data/normalized/*`

I also ran the current extractor against the example posts and inspected existing captured output under `data/`.

## Executive Summary

`nyc-housing-scout` is a good exploratory prototype, but it is not yet cleanly structured as maintainable collection infrastructure.

The project already has a few strong foundations:

- it recognizes that one Facebook post can produce multiple listings
- it has a first seen-post cache
- it persists timestamped run artifacts
- it has started moving from snapshot scraping to DOM evaluation

The main problem is architectural boundary blur. The current code mixes browser collection, parsing, cleanup, extraction, skip logic, and persistence into the same command paths and often into the same stored objects. That is manageable for exploration, but it will become expensive quickly once the goal is continuous incremental collection of 100+ posts and ongoing tracking of new ones.

My recommendation is to treat the current codebase as a proof-of-shape prototype and make one deliberate architecture pass now before adding more heuristics or scheduling.

## Bottom Line Against The Vision

### Scrape and track large numbers of Facebook housing posts

Current state: partially aligned.

- The DOM path is the correct direction because it uses `openclaw browser evaluate` and avoids reverse-parsing terminal snapshots (`src/core/browser-pipeline.js:18-20`, `src/browser/dom-extractor.js:1-80`).
- The snapshot path is still too brittle to be a serious primary collector. Post detection depends on narrow English relative-time text, heading assumptions, and location/listing keywords (`src/core/feed-parser.js:5-12`, `src/core/feed-parser.js:70-90`).
- The DOM path still fails to reliably capture core metadata like permalink, author, and posted time at acceptable rates.

Verdict: the repo can collect some posts, but not yet at the reliability level implied by “track large numbers”.

### Continuous incremental collection with seen-post caching

Current state: partially aligned, but semantically weak.

- The seen cache exists and is used in both snapshot and DOM crawl flows (`src/cli/crawl-latest.js:22-25`, `src/cli/crawl-dom-latest.js:22-24`).
- The cache is a single flat JSON file with no group/page/profile scoping (`data/cache/seen-post-ids.json`).
- The crawl target counts total collected posts, not fresh posts, so a run can stop early while returning fewer new posts than requested (`src/cli/crawl-latest.js:33-45`, `src/cli/crawl-latest.js:57-63`, `src/cli/crawl-dom-latest.js:33-45`, `src/cli/crawl-dom-latest.js:73-81`).
- The DOM path still extracts listings for seen posts, wasting work and muddying “incremental” semantics (`src/core/browser-pipeline.js:38-46`).

Verdict: the repo has the beginnings of incremental collection, but not the semantics needed for ongoing tracking.

### Modular, composable, reusable architecture

Current state: partially aligned in folder layout, weak in runtime structure.

- The directory layout is promising: `browser`, `core`, `extractors`, and `cli` are conceptually sensible.
- The actual command paths still duplicate core helper logic, especially on the snapshot side (`src/cli/capture-feed.js:58-79`, `src/cli/crawl-latest.js:77-101`).
- The central function `normalizeCollectedPost(...)` performs post cleanup, author cleanup, location enrichment, skip logic, listing extraction, and timestamping in one step (`src/core/browser-pipeline.js:38-46`).
- The so-called raw artifacts are not raw at all; they already contain extracted listings and derived fields.

Verdict: the structure suggests modularity, but the execution path is still tightly coupled.

### Strong separation between collection, parsing, normalization, extraction, storage, and future scheduling

Current state: weak.

- `data/raw/*` stores post objects that already include `derivedLocation`, `listings`, `skipped`, and `capturedAt` instead of true raw browser payloads (`src/cli/capture-dom-feed.js:21-31`, `src/cli/capture-feed.js:27-44`).
- The extractor API cannot accept source metadata cleanly, so listing-level `source.*` fields remain null even when the post object has that metadata available (`src/core/schema.js:3-11`, `src/extractors/text-extractor.js:22-52`).
- Snapshot and DOM collection produce different post shapes (`authorName` vs `author`, `seeMoreRef` vs `hasSeeMore`), which makes later scheduling/orchestration harder.

Verdict: this is the biggest architectural gap right now.

### Prepare for future scaling to 100+ posts and ongoing tracking

Current state: not yet ready.

- No scheduler abstraction exists yet, which is fine for now.
- The current collector is too brittle to schedule safely because it lacks stable contracts, strong error handling, source-scoped state, and fixture-backed tests.
- `package.json` contains run scripts but no automated test, validation, or linting workflow (`package.json:6-13`).

Verdict: scaling work should not start with more automation. It should start with a cleaner collector contract and a better artifact model.

## What Is Working Well

- The product framing is correct. The docs and schema understand that one post can contain multiple offerings and that structured output matters more than perfect automation right now.
- The DOM path is materially better than the snapshot parser as a long-term direction (`src/browser/dom-extractor.js:1-80`).
- Timestamped per-run bundles are useful and should remain part of the design (`src/cli/capture-feed.js:15`, `src/cli/crawl-latest.js:16`, `src/cli/capture-dom-feed.js:14`, `src/cli/crawl-dom-latest.js:16`).
- Keeping a seen-post cache early was the right instinct.
- The examples and notes are useful seed material for future contract tests.

## Observed Data Quality Problems In Current Output

These are not hypothetical.

- In `data/raw/facebook-dom`, there are 24 captured files. Only 15 have `postId`, 0 have `postUrl`, 14 have `author`, and 8 have `postedAtText`.
- In the same directory, 10 of 24 records have null authors, and at least 6 have obviously bad author values such as `"0:00 / 0:43"`, `"+12"`, or garbled UI text.
- In `data/normalized/facebook-dom/crawl-2026-03-12T19-41-29-480Z.json`, there are 20 rows and 20 extracted listings, but 0 listings have `source.postId` and 0 have `source.authorName`.
- That same crawl output contains clearly broken normalized prices like `2`, `4`, and `1` for monthly rents, which lines up with the current regex behavior in `findPrice(...)` (`src/extractors/text-extractor.js:100-108`).
- The current sample crawl is heavily skewed toward `roommate_search` classifications because `ISO` and `looking for` are folded into the same axis as listing type (`src/extractors/text-extractor.js:180-190`). In the sampled normalized DOM crawl, 13 of 20 listings are labeled `roommate_search`.

This matters because once bad normalization lands in persisted files, later tuning becomes harder unless the raw browser artifacts are preserved separately.

## Key Findings

### 1. The storage model is the first thing to fix

This is the most important architectural issue.

- `data/raw/*` is not raw.
- The collector writes parsed, cleaned, enriched, skipped, and extracted objects directly into the raw directories (`src/cli/capture-feed.js:27-40`, `src/cli/capture-dom-feed.js:21-27`, `src/core/browser-pipeline.js:38-46`).
- That prevents proper replay, makes parser debugging harder, and removes the ability to compare parser versions against the same captured browser payload.

Opinionated recommendation:

- Introduce three artifact layers now:
- `data/raw/` for browser-origin payloads only
- `data/collected/` for normalized post-level records
- `data/listings/` or `data/normalized/` for extracted listing records

### 2. The project needs one explicit `CollectedPost` contract

Right now the repo has multiple near-shapes for “a collected post”:

- snapshot path returns `authorName`, `seeMoreRef`, `comments`, `imageUrls`
- DOM path returns `author`, `hasSeeMore`, `mediaLinks`
- listing extraction then operates on body text alone and loses source metadata

Opinionated recommendation:

- define one canonical `CollectedPost` object
- make both snapshot and DOM collection return that shape
- require fields like `postId`, `postUrl`, `authorName`, `postedAtText`, `bodyText`, `media`, `captureMethod`, `captureRunId`, `rawArtifactPath`, and `comments`

Until that exists, reuse and scheduling will stay awkward.

### 3. The DOM path should become primary now

The repo has already learned the correct lesson: snapshot scraping is a stopgap, not the long-term collector.

- `parseFacebookFeedSnapshot(...)` is heavily dependent on fragile UI text and line placement (`src/core/feed-parser.js:1-175`).
- `closestCard(...)`, `findAuthor(...)`, and `findTime(...)` in the DOM extractor are still weak, but they are at least operating on page structure rather than terminal text (`src/browser/dom-extractor.js:8-54`).

Opinionated recommendation:

- keep the snapshot path only as a debug/fallback tool
- stop treating it as a peer architecture
- put the next engineering effort into improving DOM card boundary, author, time, permalink, and scroll behavior

### 4. Incremental crawl semantics are wrong for an ongoing tracker

Both crawl commands stop when `collected.size >= target`, even if many collected posts are already seen (`src/cli/crawl-latest.js:33-45`, `src/cli/crawl-dom-latest.js:33-45`).

That means:

- `--target 100` does not mean “collect 100 fresh posts”
- a large seen cache will make runs appear complete even when very few new posts were found

Opinionated recommendation:

- define the target in terms of fresh posts
- keep separate counters for `freshCollected`, `seenCollected`, and `unidentifiedCollected`

### 5. The extractor contract is too blurry

The listing extractor is useful as an exploration engine, but the contract is not ready for infrastructure use.

- `extractFromText()` and `extractFromHtml()` only return the first listing, even though the schema and docs explicitly support many listings per post (`src/extractors/text-extractor.js:4-7`, `src/extractors/html-extractor.js:3-6`).
- `buildListingFromText(...)` has no way to accept source metadata, so `source.postId`, `source.postUrl`, `source.authorName`, and `source.postedAtText` remain null (`src/core/schema.js:3-11`, `src/extractors/text-extractor.js:22-52`).
- `normalizeInput(...)` overlaps with `cleanPostBodyText(...)`, so the cleanup boundary is already drifting (`src/extractors/text-extractor.js:54-62`, `src/core/post-cleaning.js:3-10`).

Opinionated recommendation:

- stop treating extraction as `extractListingsFromText(string)`
- move to `extractListingsFromPost(collectedPost)`

### 6. Several normalization bugs should be fixed before any bigger refactor

The current extractor is already generating wrong normalized values:

- `findPrice(...)` captures only the first numeric fragment after `$`, so `$2,000/month` becomes `2` and `$4,750` becomes `4` (`src/extractors/text-extractor.js:100-108`).
- `findPricePeriod(...)` independently prefers `/night`, which can produce inconsistent `amount` and `period` pairs on mixed-rate posts (`src/extractors/text-extractor.js:111-115`).
- `findLocationSnippet(...)` is too permissive and can extract fragments like `NYC but isn` (`src/extractors/text-extractor.js:153-165`).
- comments and trailing noise can change classification because the extractor scans the entire text block without a real comment boundary (`src/extractors/text-extractor.js:180-190`).
- the HTML extractor strips nearly all structure immediately, throwing away potentially useful boundaries and metadata (`src/extractors/html-extractor.js:16-34`).

These are immediate correctness issues, not “later polish”.

### 7. The schema is ahead of the implementation

This is not bad by itself, but it is important to acknowledge.

- `createEmptyListing()` defines fields for broker fee, utilities, bathrooms, pets, laundry, availability end date, contact info, and source metadata (`src/core/schema.js:1-66`).
- `buildListingFromText(...)` populates only a small subset, yet confidence remains relatively high (`src/extractors/text-extractor.js:34-49`, `src/extractors/text-extractor.js:218-226`).

Opinionated recommendation:

- either reduce the confidence model sharply for mostly-empty records
- or move confidence scoring later, after explicit field-level evidence is implemented

### 8. Listing type currently conflates supply intent and listing form

`classifyListingType(...)` mixes two different questions:

- what kind of housing record is this
- is this an offered listing or a wanted/ISO post

`ISO`, `looking for`, and `need apartment` all map to `roommate_search` (`src/extractors/text-extractor.js:180-190`).

That is too lossy for a housing tracker. You need at least:

- `postIntent`: `offering | wanted | unknown`
- `listingType`: `room_in_shared | entire_apartment | sublet | lease_takeover | ...`

Without that split, the dataset will be noisy and filtering will be awkward.

### 9. The project needs fixture-backed tests before more heuristics are added

The repo has examples and persisted outputs, but no automated contract tests and no `test` script (`package.json:6-13`).

Given how heuristic the parser and extractor are, adding more rules without fixtures will just create silent regressions.

Opinionated recommendation:

- turn `examples/*.txt`
- selected `data/raw/*` artifacts
- and a few known normalized expectations

into fixture-based tests for:

- DOM extraction shape
- snapshot parse shape
- source metadata propagation
- multi-listing sectioning
- price normalization
- classification

## Immediate Fixes

These are the changes I would make next before building more features.

1. Separate raw capture, collected post, and normalized listing artifacts. This is the single highest-value cleanup.
2. Define a shared `CollectedPost` contract and make both collection paths emit it.
3. Make the crawl target count fresh posts, not total collected posts.
4. Fix price parsing for commas and mixed-rate text, and stop pairing `night` periods with monthly amounts.
5. Stop extracting listings for seen posts in the DOM flow.
6. Replace overwrite-prone fallback filenames with immutable run-scoped identifiers.
7. Propagate source metadata into every extracted listing now, even if only a subset is available.
8. Demote the snapshot path to fallback/debug status and focus collector hardening on the DOM path.

## Short-Term Architecture Improvements

These should happen soon after the immediate fixes.

1. Refactor extraction to operate on `CollectedPost` objects rather than bare strings.
2. Split body text, comments, and media evidence into separate fields before listing extraction.
3. Improve DOM author/time/permalink extraction with more specific selectors and better card boundary detection.
4. Replace page-level scroll assumptions with container-aware scrolling or a permalink-open strategy when feed scrolling is unstable.
5. Replace the flat seen cache with source-scoped crawl state keyed by group/profile.
6. Add fixture-backed tests using the existing example posts and saved raw captures.
7. Rework listing normalization into composable field extractors that return `{ value, evidence, confidence }`.
8. Separate `postIntent` from `listingType`.
9. Replace the tiny hardcoded neighborhood list with a data-backed location normalizer.

## Things To Defer Until Later

These matter, but they should not come before collector hardening and contract cleanup.

1. Scheduler or daemon mode. First make one run trustworthy and replayable.
2. Multi-group orchestration. First define source-scoped state and artifact conventions.
3. OCR/screenshot ingestion. The browser capture path still needs hardening first.
4. Cross-post deduplication beyond post ID. First preserve reliable source and raw artifacts.
5. Geocoding and mapping. First improve extraction quality and intent separation.
6. Rich amenity/contact extraction and advanced confidence scoring. First fix source boundaries and field evidence.

## Recommended Prioritized Action Plan

### Phase 1: Stabilize the collector contract

1. Define `CollectedPost` and `ListingRecord` interfaces and document them.
2. Change both collectors to persist true raw browser artifacts separately from parsed post records.
3. Normalize snapshot and DOM outputs into the same post shape.
4. Make every extracted listing carry source metadata from the originating post.

### Phase 2: Fix correctness before adding more automation

1. Repair price parsing and mixed-rate handling.
2. Split post body from comments before extraction.
3. Fix crawl semantics so `target` means fresh posts.
4. Stop extracting listings for seen posts.
5. Replace unstable fallback filenames with immutable run-scoped IDs.

### Phase 3: Harden the primary collection path

1. Treat DOM evaluation as the primary collector.
2. Improve DOM card boundary, author, time, and permalink extraction.
3. Replace page-level scrolling assumptions with container-aware scrolling or permalink-open capture.
4. Add source-scoped seen state and crawl checkpoints.

### Phase 4: Make the extractor maintainable

1. Refactor extraction into composable field extractors with evidence.
2. Separate `postIntent` from `listingType`.
3. Introduce richer availability modeling for multi-window listings.
4. Rework HTML extraction so it preserves structure rather than collapsing directly to plain text.

### Phase 5: Add guardrails for future scaling

1. Add fixture-backed tests for parser and extractor contracts.
2. Add a simple validation command that checks artifact shape and required fields.
3. Only after the above, introduce scheduled runs or multi-group collection.

## Final Assessment

The current project is worth continuing, but it has reached the point where adding more heuristics without an architecture pass will slow the team down.

The next milestone should not be “capture more posts”. It should be “make one captured post move through a clean, replayable pipeline with stable artifacts and correct source metadata”. Once that exists, scaling to 100+ posts and continuous tracking becomes a straightforward engineering problem. Right now, it is still a moving target.

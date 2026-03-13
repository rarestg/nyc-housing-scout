# Listing Extraction Pass — 2026-03-12

## Scope

This pass was limited to the active text extraction path.

Goals for this run:

- improve intent classification for wanted vs offered posts
- separate roommate-hunt posts from actual room / apartment offers
- improve borough and neighborhood inference quality
- reduce false confidence when the text is sparse or mixed
- add regression tests for representative extraction cases

Non-goals:

- no collector redesign
- no storage redesign
- no observability changes

## What Changed

### 1. Separated `postIntent` from `listingType`

`src/extractors/text-extractor.js` now derives:

- `postIntent`: `offering | wanted | unknown`
- `listingType`: `room_in_shared | multiple_rooms_in_shared | roommate_search | entire_apartment | sublet | lease_takeover | short_term | unknown`

This fixes the earlier failure mode where many posts with `ISO` or `looking for` were forced into `roommate_search` even when they were actually:

- an offered sublet
- an offered lease takeover
- an offered room in a shared apartment
- a wanted entire-apartment search

Representative improvements:

- `Roommate Wanted` posts with an actual available room now normalize as `postIntent=offering` and `listingType=room_in_shared`
- `ISO subletter` posts now normalize as offered `sublet` listings when the poster is filling a spot
- `looking for up to 2 roommates to find a place` stays `postIntent=wanted` and `listingType=roommate_search`
- `ISO NEW LEASE OR LEASE TAKEOVER FOR ENTIRE APARTMENT` now stays wanted and no longer flips into an offered listing

### 2. Stronger listing-form heuristics

Listing form classification now uses separate weighted signals for:

- `lease_takeover`
- `sublet`
- `short_term`
- `room_in_shared`
- `multiple_rooms_in_shared`
- `entire_apartment`
- `roommate_search`

This directly improves cases that were previously over-labeled as `roommate_search`, especially:

- lease takeovers with language like `offering a lease takeover on my apartment`
- room listings with phrasing like `looking for roommate for this 2BR`
- full-apartment ISO searches that mention both `entire apartment` and `lease takeover`

### 3. Better location inference and fewer obvious borough mistakes

`src/core/neighborhoods.js` now uses scored neighborhood / borough matches instead of a first-hit substring lookup.

Improvements in this pass:

- ignores street-name false positives like `Manhattan Ave`
- downweights commute references like `access into Manhattan` or `3 stops from Manhattan`
- adds better neighborhood coverage for variants seen in current fixtures, including:
  - `East Williamsburg`
  - `North Greenpoint`
  - common shorthand variants like `E. Williamsburg`
- prefers neighborhood-derived boroughs when the neighborhood evidence is stronger than a weak conflicting borough mention

This reduced obvious bad outcomes such as:

- wanted Brooklyn apartment searches being labeled `Manhattan`
- Greenpoint / Williamsburg posts losing borough confidence because of `Manhattan Ave`

### 4. Confidence and ambiguity now reflect uncertainty more honestly

The extractor now lowers confidence when signals are mixed or incomplete.

New ambiguity handling includes:

- mixed or unclear post intent
- mixed listing-form signals
- multiple neighborhood mentions
- conflicting borough evidence
- mixed nightly / monthly pricing
- flexible or usage-dependent pricing

Overall confidence now includes:

- separate field confidence for `postIntent`
- lower price confidence on mixed-period or flexible pricing
- lower location confidence when only weak raw text is present
- an ambiguity penalty on the final score

### 5. Safer section splitting for multi-listing posts

The extractor now splits multi-option posts more reliably while avoiding bad splits on decimal text like `2.5-3 Bed`.

This preserves correct sectioning for posts like the Williamsburg multi-offer example while avoiding false section boundaries in full-apartment listings.

## Tests

Added / updated regression coverage for:

- offered `roommate wanted` room listings
- wanted roommate-hunt posts
- `ISO subletter` offered sublets
- wanted full-apartment searches with Brooklyn vs Manhattan commute language
- `Manhattan Ave` false-positive borough avoidance
- multi-option post splitting with mixed pricing ambiguity
- lower confidence on sparse wanted posts vs higher confidence on detailed offered listings

Validation run:

- `npm test`

## Behavior Preserved

- collector flow is unchanged
- storage interfaces and SQLite persistence are unchanged
- source metadata propagation into listings is unchanged
- DOM collector tests and storage tests still pass

## Tradeoffs

- `listingType` is still a single field, so some posts still carry legitimate secondary form ambiguity, especially when a post mentions both `entire apartment` and `lease takeover`, or both `room available` and `sublet`
- when location evidence is weak, the extractor now prefers `null` or lower confidence over forcing a borough guess

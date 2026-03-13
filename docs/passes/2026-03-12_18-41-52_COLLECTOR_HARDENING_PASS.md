# Collector Hardening Pass — 2026-03-12

## Scope

This pass was intentionally limited to the active DOM collector path.

Goals for this run:

- harden DOM collector metadata extraction
- improve card boundary detection
- improve extraction of `authorName`, `postedAtText`, and `postUrl`
- preserve the current storage and artifact architecture
- add fixture-backed tests for the hardened DOM behavior

Non-goals:

- no storage redesign
- no changes to the legacy snapshot path
- no broad extractor/classification redesign beyond collector metadata

## What Changed

### 1. Stronger DOM card boundary selection

`src/browser/dom-extractor.js` now uses a scored ancestor picker instead of the previous first-match `closestCard(...)` heuristic.

The new card selection prefers ancestors that:

- contain exactly one story body block
- look like a real post/article container
- expose plausible header metadata near the body
- avoid climbing into larger feed containers with multiple story bodies

This directly reduces metadata bleed across neighboring posts and fixes the case where a shallow wrapper with action links (`Like`, `Comment`, `Send`) was selected instead of the real post card.

### 2. Header-biased metadata extraction

The extractor now separates author, time, and permalink discovery into dedicated candidate pickers.

Improvements in this pass:

- author extraction now prefers `[data-ad-rendering-role="profile_name"]`
- author detection is no longer limited to `/user/` links or headings
- time extraction now considers visible text plus `aria-label` and `title`
- time extraction accepts broader Facebook timestamp forms, including absolute labels
- permalink extraction now supports:
  - `/groups/.../posts/<id>/`
  - other `/posts/<id>/` paths
  - `story.php`
  - `permalink.php`
- permalink normalization now strips comment-specific noise such as `comment_id=...`

### 3. Test coverage for the active DOM path

Added fixture-backed DOM tests under `test/fixtures/dom/` and `test/dom-extractor.test.js`.

Covered cases:

- two posts inside the same feed container stay bound to their own metadata
- alternate Facebook permalink shapes still produce `postId` and `postUrl`
- a shallow wrapper with action links does not hide the real card header metadata

The test harness runs the real browser extractor function against fixture HTML via `jsdom`, so the assertions are locking the collector behavior itself rather than a mocked normalization layer.

## Behavior Preserved

- storage interface and SQLite storage wiring are unchanged
- artifact layout is unchanged
- DOM capture/crawl command flow is unchanged
- collected-post normalization contract is unchanged
- listing extraction flow is unchanged

## Validation

Validated with:

- `npm test`

## Notes

This pass improves the collector without manufacturing post URLs when the DOM does not expose a real permalink candidate. `postUrl` is still null when no usable post link is present; the change here is that more real permalink shapes are recognized and normalized when they are available.

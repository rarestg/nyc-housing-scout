# Collector Identity + Metadata Pass — 2026-03-12

## Scope

This pass stayed on the active DOM collector path.

Goals for this run:

- reduce unidentified observations where the DOM exposes usable identity signals
- improve `postedAtText` quality on media-heavy cards
- harden `postId` / `postUrl` recovery without changing storage or collector interfaces
- add fixture-backed coverage for the recovered cases

Non-goals:

- no storage redesign
- no collector/classification redesign
- no changes to the legacy snapshot path

## What Changed

### 1. Recover hidden time labels from `aria-labelledby`

The live Facebook DOM is now using anti-scraping gibberish as the visible text for some time links on media-heavy cards.

Example pattern from the real page:

- visible link text is junk like `odSsretnpo401...`
- the real time is stored in a hidden referenced label such as `10 hours ago`

`src/browser/dom-extractor.js` now reads `aria-labelledby` targets as an explicit time-candidate source.

This fixes the main reason `postedAtText` was still missing on otherwise-identified posts.

### 2. Broaden time detection for real relative labels

Time detection now accepts:

- `10 hours ago`
- `3 days ago`
- `Yesterday at 6:10 PM`

At the same time, it rejects more non-time noise:

- any string beginning with `May be ...`
- `N remaining items`
- `Shared with ...`

That keeps the new hidden-label path from reintroducing media-description contamination.

### 3. Decode encoded `post_id` values from auxiliary DOM links

Some cards expose a usable post identity through links like:

- `/avatar/edit/?entry_point=story_sticker_tray&post_id=<base64>`

The `post_id` payload decodes to values such as:

- `feedback:24461028513595054`

The DOM extractor now decodes those payloads and can use the resulting numeric Facebook post id as a fallback identity signal.

This improves `postId` / `postUrl` recovery when:

- there is no direct `/posts/<id>/` permalink
- there is no media-derived `set=pcb.<id>` signal
- but the card still exposes an encoded feedback id in another link

### 4. Avoid bogus permalink normalization from non-permalink helper links

The extractor now explicitly rejects `/avatar/edit/` URLs as permalink candidates.

That keeps the new encoded-id fallback from polluting `postUrl` with helper-link URLs while still allowing the decoded id to reconstruct the canonical group post URL when group context exists.

## Fixture Coverage Added

Added fixture-backed DOM cases for:

1. recovering `postedAtText` from hidden `aria-labelledby` labels while ignoring media-description labels
2. decoding encoded feedback ids from `avatar/edit?...post_id=...` links to recover `postId` and `postUrl`

Fixtures added under:

- `test/fixtures/dom/aria-labelledby-time-media-fallback.html`
- `test/fixtures/dom/encoded-post-id-fallback.html`

## Validation

Validated with:

- `npm test`

Live DOM spot-check on the active Facebook group tab after this pass:

- `total`: 21 visible posts
- `withId`: 19
- `withUrl`: 19
- `withAuthor`: 21
- `withTime`: 21

Before this pass, the same active DOM problem cluster was dominated by missing `postedAtText` on media-heavy cards. After the fix, time coverage on the live sample moved to full coverage.

## Remaining Gap

The remaining unidentified cards on the live sample were:

- `Grace Ahn`
- `Anonymous member`

In both cases the visible card still exposed:

- usable author
- usable time
- no direct permalink
- no media-derived post id
- no encoded feedback-id helper link

So these look like true “no usable identity signal in the visible DOM” cases rather than ranking/selector misses in the current collector.

## Conclusion

This pass materially improved metadata quality on the active DOM path:

- `postedAtText` recovery is now much stronger
- timestamp contamination is more tightly filtered
- `postId` / `postUrl` recovery handles one additional real Facebook DOM signal
- storage and collector interfaces remain unchanged

The next narrow collector win, if needed, is another pass specifically on the remaining text-only unidentified cards, but only if a real post-id signal can be proven to exist in their visible DOM.

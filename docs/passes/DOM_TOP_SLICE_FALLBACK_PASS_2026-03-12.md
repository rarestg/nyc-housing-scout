# DOM Top-Slice Fallback Pass — 2026-03-12

## Goal

Test one focused fix for the active DOM bottleneck:

- some media-heavy Facebook cards were producing valid `postId`, `postUrl`, and often valid `author`, but still no `postedAtText`
- prior debug traces suggested the issue was root/header discovery, not just candidate ranking

## What changed

### 1. Added a bounded top-of-card root fallback

Introduced `buildCardTopSliceRoots(card, bodyEl)` to scan a small, bounded set of likely header-adjacent containers:

- up to the first 3 siblings before the body node while walking upward
- up to the first 3 top-level children of the chosen card

This fallback is intentionally constrained so it does not devolve into a full-card noisy scan.

### 2. Wired top-slice roots into time extraction

`findTime(...)` now considers three tiers:

1. direct header roots
2. bounded top-of-card roots
3. full-card fallback

That keeps the original preference order while giving the extractor one better chance to recover hidden/nested time anchors.

### 3. Added a regression test

Added a DOM test proving that time can be recovered from the bounded top-of-card fallback when the direct header roots are empty.

## Secondary fix landed in the same chunk

The debug pass surfaced a real author false positive:

- external domain links like `andrewjacobs.us` could be selected as author text

That is now fixed by rejecting broader domain-like author candidates both:

- in the DOM extractor
- in `normalizeAuthorName(...)`

## Validation

- test suite now passes with **17 tests**
- live follow-up capture showed author coverage improved to **12 / 12** on the sample run
- live posted-time coverage remained **4 / 12** on that same sample

## Conclusion

This chunk was still useful:

- it improved author correctness
- it proved the top-slice fallback works in fixture form
- it clarified that the remaining live missing-time cases likely need a stronger **card/root selection** improvement, not just another time-selector tweak

## Next recommendation

The next DOM collector pass should target **card/root selection for media-heavy cards**:

- inspect whether the chosen `card` is too low in the tree for some posts
- consider scoring candidate cards with stronger preference for containers that include both profile and permalink/time anchors
- if needed, persist a small ancestor/sibling structure sketch for failed cards so card-boundary tuning is evidence-driven

# DOM Time Debugging Pass — 2026-03-12

## Why this pass

After the DOM metadata hardening pass, permalink recovery improved a lot, but `postedAtText` remained the weakest field on live capture.

The main issue: the current raw artifacts only preserved the extractor's final output, not the header candidates the extractor considered while trying to find author / time / permalink metadata.

That made the next tuning step guessy.

## What changed

The DOM extractor now includes lightweight debug traces in the raw browser payload it returns:

- `debugMetadata.authorCandidates`
- `debugMetadata.timeCandidates`
- `debugMetadata.permalinkCandidates`

Each candidate includes:

- `value`
- `score`
- `from`
- `href`
- `tagName`

The collected-post contract and downstream storage/export paths remain unchanged; this is strictly additional debugging context on the raw capture payloads.

## Why this is useful

Now when `postedAtText` is missing, we can distinguish between:

1. no plausible time candidate existed in the visible card at all
2. a real time candidate existed but lost ranking to a worse one
3. the right DOM node exists but is outside the current header search roots

That makes the next extractor pass evidence-driven instead of speculative.

## Live spot check

A quick follow-up `capture:dom` run confirmed the new raw artifacts now preserve metadata candidate traces.

Example on a missing-time post:

- valid `postId`
- valid `postUrl`
- valid `author`
- empty `timeCandidates`
- empty `permalinkCandidates`

That strongly suggests some posts simply do not expose the time node within the currently searched header neighborhood, which points to a card-boundary / search-root problem more than a ranking bug.

## Next recommended step

Use the new raw `debugMetadata.timeCandidates` traces to cluster missing-time failures and then adjust one of these deliberately:

- widen header-search roots for media-heavy cards
- add targeted selectors for hidden/nested time anchors
- capture a tiny header-HTML snapshot for cards with no time candidates at all

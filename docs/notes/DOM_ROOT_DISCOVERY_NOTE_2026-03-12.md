# DOM Root Discovery Note — 2026-03-12

## What the latest debug run showed

After adding `debugMetadata` candidate traces and header snapshots to the DOM raw artifacts, a fresh live `capture:dom` sample showed an important pattern on several missing-time posts:

- `author` was recovered correctly
- `postId` was recovered correctly
- `postUrl` was recovered correctly
- `timeCandidates` was empty
- `headerSnapshot` was empty

This is stronger evidence than before.

## What that implies

The main problem for these failures is probably **not** that the extractor is seeing the right header nodes and ranking them badly.

Instead, for at least some media-heavy cards, the current `buildHeaderSearchRoots(...)` traversal is likely not reaching the DOM region where Facebook places the header/time anchor.

In other words:

- permalink recovery can still work via media-derived post IDs
- author recovery can still work via profile-name nodes elsewhere in the card
- but the current header-root search can miss the actual time-bearing region entirely

## Concrete next step

The next DOM pass should focus on **card/root discovery**, not just time heuristics.

Best options:

1. widen sibling search near the body node for media-heavy cards
2. inspect parent-level containers after card selection, not only previous siblings
3. add a fallback header scan over a bounded top slice of the chosen card
4. if needed, store a tiny card-structure debug sketch (ancestor tags / sibling counts) for failed cases

## Secondary fix landed alongside this note

During this debugging pass, another false positive surfaced:

- external domain links like `andrewjacobs.us` could be selected as author text

That has now been fixed by rejecting domain-like author candidates more broadly, both in the DOM extractor and the collected-post cleanup path.

## Current takeaway

The project now has much better evidence for the next DOM collector step:

**next bottleneck = better root/header discovery for time metadata on media-heavy Facebook cards**

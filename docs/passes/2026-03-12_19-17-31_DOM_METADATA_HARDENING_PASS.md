# DOM Metadata Hardening Pass — 2026-03-12

## Why this pass

After the storage and observability work, the highest-value remaining bottleneck on the active DOM path was metadata quality:

- media aria-labels like `May be an image of ...` were sometimes being mistaken for `postedAtText`
- media-only cards often had a recoverable `postId` but no reconstructed `postUrl`
- some listing copy (for example `Furnished or Unfurnished`) could still leak into author selection

That meant the collector was already storing useful observations, but source metadata quality was still weaker than it should be.

## What changed

### 1. Ignore media-description noise as timestamps

The DOM extractor now explicitly rejects strings like:

- `May be an image of ...`
- `8 remaining items`

from the time-detection path.

### 2. Reconstruct group permalinks from media-only post IDs

When the card does not expose a clean permalink anchor but a media URL contains a `set=gm.<postId>` or `set=pcb.<postId>` token, the extractor now reconstructs:

- `https://www.facebook.com/groups/<group>/posts/<postId>/`

using the current group page context.

### 3. Tighten author-name filtering

The author heuristics now reject more obvious housing-copy phrases, including cases containing:

- `furnished`
- `unfurnished`
- `lease takeover`
- `luxury`
- `available now`

This helps avoid selecting listing text fragments when a real profile name is also present in the card.

## Test coverage added

Added DOM tests for:

1. ignoring image-description aria-labels as `postedAtText`
2. reconstructing group permalinks from media post IDs
3. rejecting listing copy as author text when a real author is elsewhere in the card

## Observed effect on the live capture path

A follow-up live `capture:dom` run on the Facebook group feed produced materially better metadata quality:

- `withPostUrl`: 11 / 12
- `withPostId`: 11 / 12
- `withAuthor`: 11 / 12
- `withPostedAt`: still weak at 4 / 12

So this pass appears to have meaningfully improved permalink recovery and reduced bad metadata, while confirming that **time extraction is now the next narrow DOM bottleneck**.

## Next recommended step

Focus the next DOM hardening pass specifically on `postedAtText` recovery:

- bias toward header-adjacent time anchors
- inspect whether Facebook hides time in nested spans / tooltips not currently prioritized
- consider capturing a small header-debug artifact for low-confidence cards so selector tuning becomes easier

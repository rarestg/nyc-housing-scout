# Implementation Pass — 2026-03-12

## What Changed

This pass focused on the active DOM collection path and made a small but real architecture cleanup.

- Added a canonical `CollectedPost` contract in `src/core/collected-post.js`.
  - DOM capture now normalizes raw browser payloads into a shared post shape with `authorName`, `media`, `comments`, `captureMethod`, `captureRunId`, `capturedAt`, `rawArtifactPath`, and `derivedLocation`.
- Split artifact layers for the DOM path.
  - Raw browser-origin payloads now write to `data/raw/facebook-dom/<runId>/`.
  - Collected post bundles now write to `data/collected/facebook-dom/`.
  - Extracted listing bundles now write to `data/listings/facebook-dom/`.
- Refactored DOM listing extraction to operate on collected posts instead of bare strings.
  - Listing `source.*` metadata is now copied from the collected post into every extracted listing.
- Fixed DOM crawl semantics.
  - `crawl:dom --target N` now means `N` fresh posts.
  - The crawl summary now reports separate `freshCollected`, `seenCollected`, and `unidentifiedCollected` counts.
- Stopped extracting listings for already-seen DOM posts.
  - Seen posts still land in the collected-post artifact, but they do not trigger extraction work.
- Fixed the current extractor path for:
  - comma-formatted dollar amounts like `$1,600/month`
  - mixed-rate text like `$85/night or ~$1.5–2K/month`
  - source metadata propagation into extracted listings
- Added lightweight contract tests with Node’s built-in test runner.

## What Remains

- DOM author/time/permalink capture still needs stronger selectors and better card boundary logic.
- Snapshot collection still uses the older coupled shape and storage model.
- The flat seen-post cache is still not source-scoped by group/profile.
- Listing intent is still conflated with listing type in the current classifier.
- The extractor still only produces shallow field coverage relative to the full schema.

## Tradeoffs

- I kept the snapshot path largely untouched to keep the change focused on the DOM path.
- I did not add a bigger run manifest/orchestration layer; the improvement here is the clear raw/collected/listings split plus the new collected-post contract.
- Raw DOM artifacts are still browser-evaluated JSON, not full DOM dumps. That is enough for replay/debugging without expanding scope on this pass.

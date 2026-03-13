# Test Results — 2026-03-12

## Goal tested
Build a local pipeline that can move from scraping a few visible posts to reliably collecting the latest 20+ posts from the Facebook housing group feed, while caching already-seen posts.

## What now works
- attached Chrome tab is reachable via OpenClaw browser CLI
- feed parser can extract real post cards from snapshot output
- seen-post cache works (`data/cache/seen-post-ids.json`)
- raw/normalized per-run outputs are persisted to disk
- one post can yield multiple listings
- first pagination loop exists (`crawl:latest`)

## Commands added
- `npm run expand:posts -- --limit 10`
- `npm run capture:feed -- --limit 20`
- `npm run crawl:latest -- --target 20 --max-scrolls 20`

## What was successfully captured
Reliable visible post extraction:
- Michaela Kerem — post id `24492404357124136`
- Fareed Khan — post id inferred from media set `24491142917250280`
- Duke Winn — extracted, but still without a stable post permalink/id in current visible snapshot

## Biggest failure discovered
The current crawl loop uses repeated browser snapshots plus `PageDown` scrolling.

Observed result:
- scroll 0: 3 visible posts parsed
- scroll 1: 2 visible posts parsed
- scroll 2: 1 visible post parsed
- scroll 3+: 0 visible posts parsed

Interpretation:
- either `PageDown` is not moving the feed in the expected container,
- or snapshot output after scrolling no longer includes the feed region in a stable way,
- or Facebook’s layout/lazy rendering causes the current strategy to lose post-card visibility.

## Conclusion
The current MVP is good enough to prove:
- browser control works
- parsing works on visible cards
- caching works
- storage layout works

But it is **not yet robust enough** for reliable 20/100 continuous collection.

## Next engineering step (recommended)
Move from snapshot-only scraping to a richer capture strategy using one of these:

### Option A — browser evaluate extraction (preferred)
Use `openclaw browser evaluate` with a page script that directly reads post cards from the DOM and returns structured JSON:
- author
- permalink
- visible/expanded text
- media links
- see-more presence
- comments count

Why this is better:
- avoids parsing pretty-printed snapshot text
- more stable than ref/indent based scraping
- easier to scale

### Option B — permalink harvesting loop
From feed snapshot:
- collect visible permalink refs/urls
- open each post permalink directly
- capture structured content from the single-post page
- return to feed / continue scroll

Why this helps:
- single-post pages are cleaner than the feed
- easier to expand comments/details reliably

### Option C — stronger scrolling
Investigate container-aware scrolling:
- click inside feed first
- use Space / End / repeated PageDown
- maybe use `openclaw browser evaluate` to call `window.scrollBy(...)`

## Recommendation
Build **Option A first**.
That is the real path to a robust, scalable collector.

# Effective Values And Review Read Models Pass

Date: 2026-03-17 00:27:41 EDT

## What changed

- updated `src/storage/sqlite-storage.js` so effective-value helpers preserve the current manual/resolved rows even when they do not win precedence
- layered dashboard listing/read models on top of the raw + accepted-resolved + manual precedence contract for location fields
- exposed `locationFieldStates` and `locationResolutionSummary` in listing/detail/review read models so `candidate`, `ambiguous`, and `unresolved` resolved rows remain visible
- kept list/detail top-line values honest by promoting only accepted resolved values into effective listing fields today
- updated listing and review detail panes to show raw / resolved / manual field layers without making the dashboard editorial

## Validation

- `node --test test/evidence-resolution-storage.test.js`
- `node --test test/dashboard-api.test.js`
- `npm run inspect:ui -- --port 0`
- `npm test`

## Notes

- `listing_records`, `processed_payloads`, and `post_observations` remain immutable forensic rows
- manual overrides are still read-only plumbing at this stage; Worker 5 remains responsible for the write model and audit workflow

Stage C Cross-Group Dashboard Integration Pass
==============================================

Scope
-----
- integrate the Stage A and Stage B dashboard routes into a more coherent shared surface
- reduce duplicated route glue where it materially improved maintainability
- fix the review deep-link gap with a small read-only detail path
- tighten loading, refresh, pagination, overflow, and focus consistency across the dashboard
- remove obsolete placeholder/demo route files left behind by the staged rollout

Files changed
-------------
- `src/storage/sqlite-storage.js`
- `src/ui/inspection-server.js`
- `src/ui/dashboard/app/AppShell.jsx`
- `src/ui/dashboard/components/DataTable.jsx`
- `src/ui/dashboard/components/DetailPane.jsx`
- `src/ui/dashboard/routes/debug/DebugRoute.jsx`
- `src/ui/dashboard/routes/listings/ListingsRoute.jsx`
- `src/ui/dashboard/routes/posts/PostsRoute.jsx`
- `src/ui/dashboard/routes/review/ReviewRoute.jsx`
- `src/ui/dashboard/routes/shared/route-support.jsx`
- `src/ui/dashboard/styles/dashboard.css`
- `src/ui/dashboard/dist/app.js`
- `src/ui/dashboard/app/placeholders/DebugRoutePlaceholder.jsx` (deleted)
- `src/ui/dashboard/app/placeholders/ListingsRoutePlaceholder.jsx` (deleted)
- `src/ui/dashboard/app/placeholders/PostsRoutePlaceholder.jsx` (deleted)
- `src/ui/dashboard/app/placeholders/ReviewRoutePlaceholder.jsx` (deleted)
- `src/ui/dashboard/app/placeholders/demo-data.js` (deleted)
- `test/dashboard-api.test.js`
- `src/ui/planning/archived/2026-03-15_19-52-30_CROSS_GROUP_LISTINGS_DASHBOARD_PLAN/04_SHARED_CONTRACTS_AND_BOUNDARIES.txt`

Commands run
------------
- `npm run build:dashboard`
- `npm test`
- `npm run inspect:ui -- --port 4316`
- `curl -s http://127.0.0.1:4316/ | head -n 8`
- `curl -s http://127.0.0.1:4316/listings | head -n 8`
- `curl -s http://127.0.0.1:4316/posts | head -n 8`
- `curl -s http://127.0.0.1:4316/review | head -n 8`
- `curl -s http://127.0.0.1:4316/debug | head -n 8`
- `curl -s http://127.0.0.1:4316/inspector | head -n 8`
- `node --input-type=module -e '... fetch live dashboard ids for Williamsburg ...'`
- `agent-browser open 'http://127.0.0.1:4316/'`
- `agent-browser open 'http://127.0.0.1:4316/posts?sourceKey=williamsburggreenpointhousing&observationId=obs_001017&detail=open'`
- `agent-browser open 'http://127.0.0.1:4316/review?sourceKey=williamsburggreenpointhousing&page=2&reviewId=ambiguous%3Alst_000255&detail=open'`
- `agent-browser click @e26`
- `agent-browser get url`
- `agent-browser open 'http://127.0.0.1:4316/debug/runs/2026-03-16T03-35-22-550Z?detail=open'`
- `agent-browser open 'http://127.0.0.1:4316/inspector'`

What was simplified
-------------------
- moved shared source-option fetching, posted-within options, page-size options, and results-status formatting into `routes/shared/route-support.jsx`
- removed duplicated `useJsonResource`, `buildApiUrl`, and custom pagination code from `ListingsRoute.jsx`
- switched listings raw JSON panels onto the shared `JsonDetails` component
- deleted the now-unused placeholder/demo route files under `src/ui/dashboard/app/placeholders/`
- reused the same refresh/status footer pattern across Listings, Posts, Review, and Debug so the routes behave more like one app

Polish fixes
------------
- added a real `GET /api/dashboard/review/:reviewId` detail path so review deep links are no longer page-scoped
- made off-page selections explicit on Posts, Review, and Debug instead of silently implying the current page contains the selected row
- added `aria-busy` on data tables plus `aria-expanded`/`aria-controls` wiring on the detail-pane toggles
- added clearer disabled button treatment, stronger focused-row feedback, and wider overflow wrapping for metadata, detail facts, and route footers
- kept refresh/error status visible even when stale data remains on screen

Validation
----------
- `npm run build:dashboard` passed
- `npm test` passed
- verified browser loads for `/`, `/listings`, `/posts`, `/review`, `/debug`, and `/inspector`
- verified real Williamsburg data was present on Listings, Posts, Review, and Debug
- verified cross-route navigation from Review detail to Listing detail
- verified an off-page Review deep link still resolves its detail pane on `page=2`

Known remaining gaps
--------------------
- `Debug` still hands off to the legacy inspector for deeper observations/jobs/artifacts forensics instead of reproducing that entire workspace inside the dashboard shell
- cross-route links still prioritize getting the user to the right record over preserving every filter from the originating route
- duplicate clustering remains backend-deferred and is still intentionally out of scope for this pass

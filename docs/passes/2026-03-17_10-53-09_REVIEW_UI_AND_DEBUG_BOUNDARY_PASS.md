# Review UI And Debug Boundary Pass

Date: 2026-03-17 10:53:09 EDT

## What changed

- Updated `src/ui/dashboard/routes/review/ReviewRoute.jsx` so Review always loads `GET /api/dashboard/review/:reviewId`, even when the selected row is already on-page.
- Wired Review’s correction flow directly to the backend contract:
  - `actions.manualOverride`
  - `POST /api/dashboard/review/manual-overrides`
  - `POST /api/dashboard/review/manual-overrides/clear`
- Added Review-only manual override forms for supported location fields, including create/update/clear handling, route-local success/error state, and post-write refresh of review/listing detail.
- Kept raw / resolved / manual layers visible together in Review instead of collapsing the lower layers once a manual value wins.
- Tightened route messaging so Listings stays read-only and links into Review only when a listing still has a `reviewLinkTarget`, while Debug explicitly remains forensic.
- Added a focused UI bundle regression check in `test/inspect-ui.test.js`.

## Why it matters

- Review is now the actual correction surface for the new evidence-resolution layers instead of a read-only explanation view.
- Manual override affordances are gated by backend support rather than inferred on the client.
- Listings and Debug keep their intended roles:
  - Listings: read-only workspace with Review handoff
  - Debug: provenance / forensics only

## Validation

- `npm run build:dashboard`
- `node --test test/dashboard-api.test.js`
- `node --test test/inspect-ui.test.js`
- `npm test`
- Live validation against a disposable temp data dir with `npm run inspect:ui -- --data-dir <temp> --port 0`
  - confirmed `GET /api/dashboard/review/ambiguous:lst_000001?queue=ambiguous` returns `actions.manualOverride.supported: true`
  - confirmed `curl` POST create on `/api/dashboard/review/manual-overrides` returns `action: "created"` and `fieldState.effectiveLayer: "manual_override"`
  - confirmed `curl` POST clear on `/api/dashboard/review/manual-overrides/clear` returns `action: "cleared"` and restores the non-winning resolved/manual layering
  - confirmed `/dashboard/app.js` includes the Review override strings/endpoints and the Debug boundary copy

## Notes

- `agent-browser` was also tried against the disposable local Review deep link, but that tool session stayed on the static HTML shell for this ESM SPA. I treated the temp server + API + bundle validation as the reliable live check instead of claiming a browser interaction that did not actually execute the app bundle there.

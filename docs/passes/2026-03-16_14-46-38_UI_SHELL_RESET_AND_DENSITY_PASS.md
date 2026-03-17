# UI Shell Reset And Density Pass

## Scope

- replaced the fixed left icon rail with a thin top nav using full route labels
- flattened the shared dashboard shell so header, toolbar, content, and detail read as one calmer system
- reset the detail-pane header/actions and reduced the table/filter density
- preserved the current `detail=open|closed`, row-selection, deep-link, and off-page-warning behavior

## Files Changed

- `src/ui/dashboard/app/AppShell.jsx`
- `src/ui/dashboard/components/DetailPane.jsx`
- `src/ui/dashboard/styles/dashboard.css`
- `src/ui/dashboard/dist/app.js`
- `src/ui/planning/2026-03-16_14-13-54_SHELL_RESET_AND_DENSITY_PASS/handoffs/worker_1_status.txt`

## Commands Run

- `npm run build:dashboard`
- `npm test`
- `npm run inspect:ui -- --port 4316`
- `curl -s http://127.0.0.1:4316/ | head -n 8`
- `curl -s http://127.0.0.1:4316/listings | head -n 8`
- `curl -s http://127.0.0.1:4316/posts | head -n 8`
- `curl -s http://127.0.0.1:4316/review | head -n 8`
- `curl -s http://127.0.0.1:4316/debug | head -n 8`
- `curl -s http://127.0.0.1:4316/inspector | head -n 8`
- `agent-browser --session worker-1-shell-reset-4316 ...` for desktop and narrowed route checks, `Escape` close validation, row-selection reopen validation, and review off-page deep-link validation

## Shell And Layout Decisions

- moved the shell from a three-column rail layout to a topbar plus workspace split, which immediately gives the table back the old rail width
- kept the main route header and filter bar as separate surfaces, but flattened their padding, border, and shadow language to remove the card-inside-card feel
- reduced the desktop detail width to `min(400px, 27vw)` and switched the medium-width detail view to an offset fixed overlay so the top nav stays visible at narrower widths
- kept the listings filter bar compact and made the action group span extra grid width so `More filters` and `Clear filters` stay on one intentional row

## Typography And Radius Decisions

- standardized the main dashboard surface system around three radius tokens only:
  - `--radius-surface`
  - `--radius-control`
  - `--radius-pill`
- dropped the old oversized detail/title treatment and reset the detail header to `20px / 600` with muted inline metadata and boxed action controls
- set table primary text to `13px / 600`, supporting/meta text to `11.5px`, and pushed non-listing columns toward `--ink-muted` so Listings remains the strongest scan target

## Validation

- `npm run build:dashboard` passed
- `npm test` passed
- verified `/` redirects into `/listings`
- verified `/listings`, `/posts`, `/review`, `/debug`, and `/inspector` render in the updated shell
- verified the left rail is gone and the top nav uses `Listings`, `Posts`, `Review`, and `Debug`
- verified desktop and narrowed (`900x800`) layouts with `agent-browser`
- verified the narrowed top nav stays visible and does not fall into multi-row sprawl when the detail overlay is open
- verified the listings filter action row stays compact when detail is closed at narrow width
- verified `Escape` closes the detail pane and updates the URL to `detail=closed`
- verified selecting a listings row from `/listings?detail=closed` reopens detail and updates `listingId`
- verified a review deep link outside the current page (`/review?page=1&reviewId=incomplete%3Alst_000211&detail=open`) keeps detail open and shows `Outside current page`

## Remaining Gaps

- I did not run a full manual tab-order sweep across every interactive control, although the shared visible-focus styling remains intact and the close button stayed keyboard-invokable during the `Escape` validation pass
- at medium widths, the detail overlay still trades some table width for persistent context when detail is open; that is intentional for this pass rather than a route-behavior change

## Follow-Up Refinement

- collapsed the desktop topbar from a wasteful two-row layout into a single flex row so `Housing Scout`, the route tabs, and `Inspector` share one proper navbar line
- kept the wrap fallback only for narrower widths, where the inspector button can sit above the tabs without forcing horizontal overflow

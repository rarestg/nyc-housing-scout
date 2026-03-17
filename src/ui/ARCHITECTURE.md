# UI Architecture

Map for contributors working on the inspection and dashboard surfaces. Read this first, then go to the files it points at.

## Two-Tier Design

One Node.js HTTP server (`inspection-server.js`) serves two separate frontends on the same port (default 4310):

| Surface | Route | Stack | Role |
|---------|-------|-------|------|
| **Dashboard** | `/` and `/listings`, `/posts`, `/review`, `/debug` | React 19, React Router 7, TanStack Table 8 | Cross-group operator workspace: listings, source posts, review queue, debug forensics |
| **Inspector** | `/inspector` | Vanilla JS, no framework | Per-run deep inspection: observations, jobs, listings, steps, artifacts |

The dashboard is the primary surface. The inspector remains read-only.

The dashboard is still mostly read-oriented, but Review now has a narrow write surface for manual overrides and clears. SQLite is still the only data source; writes happen through the Node server, not directly from the browser to a separate backend.

The inspector is a legacy forensics fallback — the debug route still links out to it for deep observation/job/artifact inspection that has not been ported into React yet.

## File Map

```
src/ui/
├── inspection-server.js    ← HTTP server: static asset serving + all API routes
├── inspection-app.html     ← Inspector HTML shell
├── inspection-app.js       ← Inspector frontend (vanilla JS, ~39KB)
├── inspection-app.css      ← Inspector styles
├── dashboard/
│   ├── app/
│   │   ├── index.html          ← Dashboard HTML shell
│   │   ├── main.jsx            ← React DOM entry point
│   │   ├── DashboardApp.jsx    ← React Router route definitions
│   │   ├── AppShell.jsx        ← Top nav + workspace grid + detail pane layout
│   │   ├── shell-context.jsx   ← React Context: routes inject title, toolbar, detail content
│   │   └── build-dashboard.js  ← esbuild config (called at server start, not build time)
│   ├── components/
│   │   ├── DataTable.jsx       ← TanStack Table wrapper with row selection + keyboard nav
│   │   ├── DetailPane.jsx      ← Slide-in sidebar, Escape to close, inert when hidden
│   │   ├── FilterControls.jsx  ← Composable primitives: FilterBar, FilterField, FilterInput, FilterSelect, FilterToggle
│   │   ├── RoutePagination.jsx ← Page nav + page size control
│   │   ├── RouteScaffold.jsx   ← Section wrapper with optional footer
│   │   ├── StateViews.jsx      ← LoadingState, EmptyState, ErrorState
│   │   └── JsonDetails.jsx     ← Collapsible raw JSON viewer
│   ├── lib/
│   │   ├── query-state.js          ← Bidirectional URL ↔ typed state (read/write/patch)
│   │   ├── use-url-query-state.js  ← React hook wrapping query-state for React Router
│   │   └── formatters.js           ← Display helpers: time, price, confidence, counts, labels
│   ├── routes/
│   │   ├── shared/route-support.jsx  ← Shared hooks: useJsonResource, buildApiUrl, useDashboardSourceOptions, buildInspectorHref
│   │   ├── listings/ListingsRoute.jsx  ← Primary surface — listings table, filters, detail
│   │   ├── posts/PostsRoute.jsx        ← Source evidence — posts with processing status
│   │   ├── review/ReviewRoute.jsx      ← Review queue — 5 queue types, cross-links
│   │   └── debug/DebugRoute.jsx        ← Run forensics — validation, inspector handoff
│   ├── styles/
│   │   └── dashboard.css       ← All dashboard styles (~1,200 lines, CSS variables)
│   └── dist/
│       └── app.js              ← Bundled output (rebuilt at server start; not a source file)
└── planning/                   ← Working context for active UI changes; not canonical docs
```

## How the Pieces Connect

### Server → Storage → Browser

```
Browser                    Server (inspection-server.js)         Storage (sqlite-storage.js)
  │                              │                                      │
  │  GET /api/dashboard/…        │                                      │
  │─────────────────────────────→│  readWithRetry() →                   │
  │                              │  storage.listDashboard*() ──────────→│
  │                              │                              ←───────│
  │  ← JSON { items, pagination }│                                      │
  │←─────────────────────────────│                                      │
```

All storage calls are wrapped in `readWithRetry()` which retries twice on SQLite busy errors and returns 503 if the database stays locked.

### Route → Shell → Layout

Each route owns its data fetching, columns, filters, and detail content. It injects these into the shared shell via `useDashboardShellSlots()`:

```
Route Component
  │
  ├── useDashboardShellSlots({ title, toolbar, detailTitle, detailContent, ... })
  │       └── updates shell-context → AppShell re-renders header + detail pane
  │
  ├── useUrlQueryState(QUERY_SCHEMA)
  │       └── reads/writes URL search params as typed state
  │
  └── useJsonResource(buildApiUrl(path, params))
          └── fetches JSON, returns { data, error, isLoading }
```

### URL as State

All filter, pagination, sort, and detail-open state lives in URL query parameters. `query-state.js` handles type coercion (string ↔ boolean/number), default elision (defaults aren't written to the URL), and patching (updating some params without clobbering unrelated ones like `page`).

## Structural Decisions

**Dynamic bundling, not a build step.** `build-dashboard.js` runs esbuild at server startup and holds the bundle in memory. There is no required checked-in dashboard bundle; the server rebuilds on startup.

**Shell context pattern.** Routes don't render their own chrome. They call `useDashboardShellSlots()` in a `useLayoutEffect` to push title, toolbar, and detail content into the shared `AppShell`. This keeps layout consistent without prop-drilling through the router.

**Detail pane is URL-driven.** `?detail=open` / `?detail=closed` controls visibility. Each route has a selection param (`listingId`, `observationId`, `reviewId`, or a path param for runs). The detail pane is inert and hidden (not unmounted) when closed.

**Review queue is computed, not stored.** The 5 review queues (ambiguous, low-confidence, incomplete, pending, failed) are built at query time by `buildDashboardReviewCollection()` in the storage layer, not from a separate table. Thresholds like `lowConfidence: 0.75` are applied during the query.

**Variant collapsing.** Multiple extractor runs against the same post produce multiple listing records with different `extractor_version`. The storage layer collapses these into a single item with a `variantCount` for the list view, and expands them in the detail view.

## API Surface

Dashboard endpoints follow a consistent pattern:

| Method | Route | Returns |
|--------|-------|---------|
| GET | `/api/dashboard/listings` | `{ items, pagination, sort, filters }` |
| GET | `/api/dashboard/listings/:listingId` | `{ listing, variants, observation, jobs, provenance, ... }` |
| GET | `/api/dashboard/posts` | `{ items, pagination }` |
| GET | `/api/dashboard/posts/:observationId` | `{ post, linkedListings, jobs, provenance }` |
| GET | `/api/dashboard/review` | `{ items, pagination, queueCounts }` |
| GET | `/api/dashboard/review/:reviewId` | `{ item, thresholds }` |
| POST | `/api/dashboard/review/manual-overrides` | Creates or updates one manual override and emits an audit event |
| POST | `/api/dashboard/review/manual-overrides/clear` | Clears one manual override and emits an audit event |
| GET | `/api/dashboard/debug/runs` | `{ items, pagination }` |
| GET | `/api/dashboard/debug/runs/:runId` | `{ run, validation }` |

Legacy inspector endpoints (`/api/sources`, `/api/runs`, `/api/observations`, `/api/jobs`, `/api/listings`, `/api/run-steps`, `/api/artifacts`, `/api/validate-run`) are still live for the vanilla JS inspector.

List endpoints accept `page`, `pageSize`, `sort`, and route-specific filter params. Detail endpoints accept an ID (path param) and return the full record with linked entities. The two review write endpoints accept JSON request bodies and are intentionally scoped to manual override actions only.

## Changing the UI

| To do this | Go here |
|------------|---------|
| Add or change a table column | The route file's column definitions (near the top of `*Route.jsx`) |
| Add a filter | The route's `QUERY_SCHEMA` + its toolbar JSX (inside `useDashboardShellSlots`) |
| Change detail pane content | The route's `*Detail` component (bottom half of `*Route.jsx`) |
| Add a new route | `DashboardApp.jsx` (router), new route directory, `inspection-server.js` (`isDashboardAppRoute`), `AppShell.jsx` (nav link) |
| Change an API response shape | `sqlite-storage.js` (the `*Dashboard*` method) + `inspection-server.js` (the route handler) |
| Change shared table or detail behavior | `dashboard/components/` |
| Change layout, spacing, or colors | `dashboard/styles/dashboard.css` (CSS variable tokens at the top) |
| Change the shell or nav structure | `AppShell.jsx` + `shell-context.jsx` |
| Change URL state behavior | `lib/query-state.js` (serialization) or the route's `QUERY_SCHEMA` (field definitions) |
| Change how data is formatted in cells | `lib/formatters.js` or route-local format helpers |

## What's Not Here Yet

- The debug route still hands off to the legacy inspector for observation/job/artifact forensics instead of rendering them natively.
- No full keyboard/tab-order audit has been done, though `focus-visible` styling is in place.
- Duplicate clustering across posts is deferred and intentionally out of scope.
- The artifact viewer is text-only — no image or media previews.

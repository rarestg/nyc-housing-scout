# Cloudflare Deployment Readiness Review

Date: 2026-03-16

## Scope

Assess how ready `nyc-housing-scout` is to:

1. keep Facebook scraping, ingestion, and SQLite writes local on the operator laptop
2. serve a public-facing frontend from Cloudflare
3. decide between Cloudflare D1 and external Postgres/Supabase for the cloud read path

This review is based on the current repo, live local data, current Cloudflare docs, and parallel repo audits from explorer agents.

## Executive Verdict

The repo is not deployable to Cloudflare as-is.

The important split is:

- the current React dashboard frontend is close to deployable
- the current inspection server and storage implementation are not
- the Facebook collection and local processing path should remain on the laptop for now

My recommendation is:

1. Keep Stage A collection, local SQLite, raw artifacts, and optional Gemini processing on the laptop.
2. Publish a curated public read model to Cloudflare D1.
3. Deploy the public site as a Cloudflare Worker with Static Assets plus a small read-only API.
4. Keep the current operator/debug surfaces local, or later protect them separately with Cloudflare Access.

I do not recommend Postgres/Supabase as the first cloud target.

## Current Readiness

### What already works

- The repo has a real browser UI: a React 19 SPA bundled with esbuild from [`src/ui/dashboard/app/build-dashboard.js`](src/ui/dashboard/app/build-dashboard.js#L11) and mounted from [`src/ui/dashboard/app/index.html`](src/ui/dashboard/app/index.html#L1).
- The UI/API contract is already clear and stable enough to reuse. The current server exposes listings, posts, review, debug, and source endpoints from [`src/ui/inspection-server.js`](src/ui/inspection-server.js#L167).
- The canonical data model is already queryable in SQLite, with durable tables for `sources`, `crawl_runs`, `post_observations`, `listing_records`, `processing_jobs`, and `processed_payloads` described in [`data/README.md`](data/README.md#L155).
- The project explicitly wants the read/query layer shaped for a future frontend, not ad hoc JSON exports ([`README.md`](README.md#L35), [`docs/PIPELINE.md`](docs/PIPELINE.md#L240)).
- Current local scale is small:
  - `data/storage`: `10M`
  - `data/raw`: `35M`
  - `data/collected`: `3.0M`
  - `data/listings`: `460K`
  - live SQLite counts: `2` sources, `44` runs, `1156` observations, `256` listing rows, `142` processed payloads

### What is not deployable as-is

- Collection is explicitly tied to an attached logged-in Chrome tab and `openclaw browser evaluate` ([`docs/PIPELINE.md`](docs/PIPELINE.md#L5), [`src/core/browser-pipeline.js`](src/core/browser-pipeline.js#L4)).
- The current storage factory only supports a local SQLite file on disk ([`src/storage/storage.js`](src/storage/storage.js#L4)).
- The SQLite implementation is built on `DatabaseSync` from `node:sqlite` ([`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1)).
- The inspection surface is a local `node:http` server with `server.listen(...)` and direct filesystem reads from `data/` ([`src/ui/inspection-server.js`](src/ui/inspection-server.js#L13), [`src/ui/inspection-server.js`](src/ui/inspection-server.js#L28), [`src/ui/inspection-server.js`](src/ui/inspection-server.js#L154)).
- The app exposes operator/debug surfaces that should not be public unchanged:
  - `/posts`
  - `/review`
  - `/debug`
  - `/inspector`
  - `/artifact-file`
  - raw payload JSON and artifact paths

### Important nuance

The frontend and the current server are not the same thing.

The browser bundle is portable.
The current backend is not.

## Why The Current Cloudflare Lift-And-Shift Fails

### 1. Collection is intentionally local

The repo purpose and pipeline docs are explicit:

- local-first pipeline ([`README.md`](README.md#L3))
- attached Chrome tab for collection ([`README.md`](README.md#L45))
- raw artifacts and SQLite live under `data/` ([`README.md`](README.md#L68), [`data/README.md`](data/README.md#L3))

Your current collector shells out to `openclaw` and assumes your logged-in browser profile is present locally ([`src/core/browser-pipeline.js`](src/core/browser-pipeline.js#L4)).

That is the right place to keep it for now.

### 2. The current read surface is a Node server, not an edge Worker

The hosted surface today is:

- one local Node process
- `node:http`
- local asset reads
- local file serving for artifacts
- direct local SQLite access

That shape is documented in [`docs/PIPELINE.md`](docs/PIPELINE.md#L204) and implemented in [`src/ui/inspection-server.js`](src/ui/inspection-server.js#L13).

Even with Cloudflare's expanding Node compatibility, this exact implementation is still the wrong deployment shape because:

- Workers use request handlers, not a long-lived `server.listen(...)` origin
- `node:sqlite` is still not supported in Workers
- filesystem access in Workers is a virtual, per-request file system, not your laptop's `data/` directory

Cloudflare source:

- Node.js compatibility page says Workers support only a subset of Node APIs and lists SQLite as "not yet supported": https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- `node:fs` in Workers is a virtual in-memory file system, not a persistent local disk: https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/

### 3. The dashboard query layer is still optimized for local/operator use

The dashboard storage helpers currently:

- read candidate rows from SQLite
- collapse variants in JavaScript
- filter in JavaScript
- sort in JavaScript
- paginate with `Array.slice(...)`

See:

- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1401)
- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1484)
- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1673)
- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1933)
- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L3341)

That is acceptable for the current local dataset.
It is not the edge API I would ship unchanged.

The first cloud API should push filtering, ordering, pagination, and redaction into SQL.

### 4. The current frontend is still an operator app, not a public product shell

The current routes are:

- listings
- posts
- review
- debug
- inspector handoffs

That is a strong local operator console, not a public housing site.

For public release, only a subset should be exposed:

- sources
- listing search
- listing detail
- maybe a slim post provenance link to the original Facebook permalink

The current raw artifact links and payload views should stay private.

## D1 Vs Postgres / Supabase

## D1: recommended first target

Why D1 is the best first move:

- The repo already thinks in SQLite.
- Your canonical store is already SQLite.
- The live database is tiny relative to D1 limits.
- D1 keeps the cloud stack entirely inside Cloudflare.
- The public site only needs a read model, not multi-writer transactional backoffice complexity.

Current Cloudflare docs:

- D1 is Cloudflare's managed serverless SQL database with SQLite semantics: https://developers.cloudflare.com/d1/
- D1 limits page shows `10 GB` max database size on Workers Paid and notes each database is single-threaded: https://developers.cloudflare.com/d1/platform/limits/
- D1 supports global read replication: https://developers.cloudflare.com/d1/best-practices/read-replication/

Important implication:

Your current `10M` SQLite file and low row counts are nowhere near D1's size limits.

### I would not do a blind full clone first

A literal full clone of the operator SQLite database into D1 is feasible technically, but it is not the best product boundary.

Reasons:

- `artifact_refs.relative_path` points at local files
- run/debug/queue state is operator-only
- raw payload JSON is overexposed for a public app
- the public app does not need most of the current schema

The better first move is:

- keep local SQLite as source of truth
- publish a curated public subset into D1

### When D1 stops being the best choice

Move off or around D1 if you later need:

- many writes from many remote clients
- heavier analytical querying
- direct GIS operators over large coordinate sets
- complex database-native auth or RLS workflows
- a broader multi-service ecosystem than Cloudflare-only storage

## Postgres / Supabase: valid later, not my first recommendation

Postgres is still a valid option, especially if you want:

- PostGIS
- Supabase auth and RLS
- richer admin/reporting SQL
- more conventional backend tooling

Cloudflare path:

- Hyperdrive is Cloudflare's recommended way to access an existing Postgres/MySQL database from Workers: https://developers.cloudflare.com/hyperdrive/
- Cloudflare has a Supabase integration page that routes through Hyperdrive: https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/

Why I would not start there:

- you add another data platform immediately
- you now own SQLite -> Postgres replication instead of SQLite -> SQLite-shaped D1 publication
- Worker code will need database drivers plus `nodejs_compat`
- you pay operational cost before the product proves it needs Postgres

### PostGIS is not justified yet

The current schema and docs explicitly treat latitude/longitude as downstream enrichment:

- `location.lat`
- `location.lng`
- `geocodeConfidence`

are later-stage fields, not first-pass extraction targets ([`docs/LISTING_SCHEMA.md`](docs/LISTING_SCHEMA.md#L21)).

Right now, most useful location data is still:

- borough
- neighborhood
- free-form location text
- sometimes an address

That means PostGIS is not buying much today.

Supabase does support PostGIS if you need it later:

- https://supabase.com/docs/guides/database/extensions/postgis

But I would only pay that complexity once you have a reliable geocoding stage and a map-first product that truly needs spatial indexing.

## Ideal Cloudflare End State

### Recommended architecture

1. Local laptop remains source of truth for collection.
2. Local laptop keeps raw artifacts and operator SQLite.
3. A publish step derives a cloud-safe read model from local SQLite.
4. That read model is written to Cloudflare D1.
5. A Cloudflare Worker serves:
   - static frontend assets
   - public listing API
6. Optional public assets or mirrored exports go to R2.
7. Optional private admin app later gets its own auth boundary.

### Why Worker + Static Assets instead of Pages

Pages would work.
But for a new build I would use Workers Static Assets.

Cloudflare's current best practices explicitly recommend Workers Static Assets for new static/full-stack projects:

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://developers.cloudflare.com/workers/static-assets/

That gives you:

- one deploy target
- same-origin frontend + API
- direct D1/R2 bindings
- cleaner future path if you add auth, caching, or more API routes

### Public app boundary

Cloud app:

- `GET /api/sources`
- `GET /api/listings`
- `GET /api/listings/:id`
- optional map/search helpers

Local/private only:

- `GET /api/posts`
- `GET /api/review`
- `GET /api/debug`
- `GET /api/runs`
- `GET /artifact-file`
- raw payload JSON
- queue and worker metadata

### Recommended published schema

I would add a separate cloud-facing schema or table family rather than reuse every local table verbatim.

Suggested first cut:

- `public_sources`
  - `source_key`
  - `display_name`
  - `external_url`
- `public_listings`
  - `listing_id`
  - `source_key`
  - `post_url`
  - `author_name` only if you decide it is acceptable
  - `posted_at`
  - `summary`
  - `listing_type`
  - `intent`
  - `borough`
  - `neighborhood`
  - `price_amount`
  - `price_period`
  - `beds`
  - `baths`
  - `rooms_available`
  - `available_from`
  - `confidence_overall`
  - `updated_at`
- `public_listing_variants`
  - only if you want to preserve multiple extractor variants
- `public_sync_state`
  - last published run id
  - last published at
  - sync version

Do not publish by default:

- raw artifact paths
- collected payload JSON
- processed payload JSON
- internal job ids/statuses
- debug run counters

### Sync model

The simplest reliable sync is push-based from the laptop:

1. collect locally
2. optionally process locally
3. run `publish:cloud`
4. `publish:cloud` reads local SQLite
5. `publish:cloud` upserts the public tables into D1

I would make this one-way and idempotent.

If you later need full artifact availability in cloud:

- upload selected safe artifacts to R2
- rewrite public URLs to R2 object URLs or signed asset routes

## Suggested Implementation Phases

### Phase 1: define the public contract

Decide what the public site is allowed to expose:

- listings only
- listing + original Facebook permalink
- author names yes/no
- phone/email extracted from posts yes/no
- raw post body yes/no

This is the product/privacy boundary.

### Phase 2: add a cloud publication CLI

Add a local command that:

- reads from local SQLite
- materializes the public read model
- publishes to D1

I would not start by rewriting the whole storage layer.
I would start with a narrow publisher.

### Phase 3: deploy a Worker with Static Assets

New Cloudflare project:

- static assets for the public frontend
- D1 binding
- small read-only API
- observability enabled

### Phase 4: build the public frontend separately from the operator dashboard

The current dashboard is strong internal scaffolding.
It is not the public product shell.

Keep the local operator UI.
Create a smaller public app focused on:

- listing search
- filters
- map later if geocoding becomes real
- mobile-friendly detail views

### Phase 5: revisit Postgres only after product pressure

Reconsider Postgres/Supabase if one of these becomes true:

- you need PostGIS for real point/radius/bounding-box queries
- you want Supabase auth/RLS
- you need richer relational joins and analytics
- D1 query shape or write concurrency becomes a real bottleneck

## Concrete Risks To Address Before Public Launch

### 1. Redaction and privacy

The current operator views include raw evidence, artifact paths, and payload JSON.
That is not public-safe by default.

### 2. Query execution model

Current dashboard listing/post/review helpers do too much filtering and pagination in JavaScript after loading candidates from SQLite ([`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1508), [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1684), [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js#L1936)).

The cloud API should push more of that work into SQL.

### 3. Build/deploy polish

Current dashboard build is intentionally simple and dev-oriented:

- `process.env.NODE_ENV` forced to `"development"`
- `minify: false`

See [`src/ui/dashboard/app/build-dashboard.js`](src/ui/dashboard/app/build-dashboard.js#L15).

That is fine locally, but the cloud app should have a production build path.

### 4. No Cloudflare deployment surface exists yet

The repo currently has no:

- `wrangler.jsonc`
- Worker entrypoint
- D1 bindings
- R2 bindings
- Cloudflare test harness

This is expected, but it means cloud readiness is architectural, not operational, today.

## What I Would Build Next

If the next task is implementation, I would do it in this order:

1. add a small `docs/` contract for the public API and redaction rules
2. add `publish:cloud` to materialize and sync `public_*` tables into D1
3. scaffold a new Workers app with Static Assets
4. implement `/api/sources`, `/api/listings`, and `/api/listings/:id`
5. build a slim public listings UI against those endpoints
6. leave the current operator dashboard local

## Validation Performed

Commands run during this review:

- `npm test`
- `npm run build:dashboard`
- `npm run inspect:ui -- --port 4319`
- `curl -s http://127.0.0.1:4319/ | head -n 8`
- `curl -s 'http://127.0.0.1:4319/api/dashboard/listings?pageSize=2'`
- `curl -s 'http://127.0.0.1:4319/api/sources?limit=10'`
- SQLite table and row-count inspection against `data/storage/nyc-housing-scout.sqlite`

Observed results:

- `npm test`: passed `78/78`
- `npm run build:dashboard`: passed
- local inspection UI served successfully
- live dashboard API returned public-ish listing data and source counts from the local SQLite store

## References

### Repo references

- [`README.md`](README.md)
- [`docs/PIPELINE.md`](docs/PIPELINE.md)
- [`data/README.md`](data/README.md)
- [`src/ui/inspection-server.js`](src/ui/inspection-server.js)
- [`src/storage/sqlite-storage.js`](src/storage/sqlite-storage.js)
- [`src/storage/storage.js`](src/storage/storage.js)
- [`src/core/browser-pipeline.js`](src/core/browser-pipeline.js)

### Cloudflare references

- Workers best practices:
  - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Workers Static Assets:
  - https://developers.cloudflare.com/workers/static-assets/
- Workers Node.js compatibility:
  - https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Workers `node:fs` notes:
  - https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- D1 overview:
  - https://developers.cloudflare.com/d1/
- D1 limits:
  - https://developers.cloudflare.com/d1/platform/limits/
- D1 global read replication:
  - https://developers.cloudflare.com/d1/best-practices/read-replication/
- Hyperdrive overview:
  - https://developers.cloudflare.com/hyperdrive/
- Hyperdrive getting started:
  - https://developers.cloudflare.com/hyperdrive/get-started/
- Supabase via Hyperdrive:
  - https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/
- Cloudflare Agents overview:
  - https://developers.cloudflare.com/agents/

### Supabase references

- PostGIS on Supabase:
  - https://supabase.com/docs/guides/database/extensions/postgis

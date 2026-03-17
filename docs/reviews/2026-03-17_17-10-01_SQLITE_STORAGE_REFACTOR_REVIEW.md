# sqlite-storage Refactor Review

Point-in-time refactor recommendation for `src/storage/sqlite-storage.js`.

This is deferred engineering backlog, not an active execution plan. Use it when we decide to clean up storage organization or prepare dashboard query logic for a future public D1 read path.

**Note on the suggested module split:** This review proposes a decomposition into ~15 modules as one plausible breakdown. That is an analytical finding, not a prescription. The implementing engineer should use their own judgment about the right number of modules, the right grouping boundaries, and the right composition pattern. Fewer modules may be better. A different architecture may be better. The goals are: get presentation logic out of the storage layer, make each concern independently understandable, and set up the SQL pushdown work cleanly. How you get there is up to you.

## Current Shape

`src/storage/sqlite-storage.js` is 5,660 lines and the largest source file in the repo by a factor of 3.6x.

It currently mixes:

- core storage infrastructure and transaction control
- source / run / observation CRUD
- processing queue operations
- evidence / resolution / override writes
- generic list/read helpers
- dashboard query builders
- dashboard presentation logic
- row mappers and formatting helpers
- effective-value precedence logic
- date parsing and query helper utilities

Breakdown:

| Concern | Approx lines | Methods/functions | In class? |
|---------|-------------:|------------------:|:---------:|
| Core infrastructure (constructor, migrations, transactions, ID gen) | ~630 | 14 methods | yes |
| Source/Run/Observation CRUD | ~460 | 6 methods | yes |
| Evidence/Resolution/Override operations | ~720 | 11 methods | yes |
| Processing queue (enqueue, claim, complete, retry, sweep) | ~870 | 7 methods | yes |
| Read/List query methods | ~650 | 10 methods | yes |
| Dashboard query builders | ~610 | 14 methods | yes |
| Run validation | ~120 | 2 methods | yes |
| Row mappers (snake_case to camelCase) | ~470 | ~25 functions | no |
| Dashboard presentation logic (formatters, filters, sorting, pagination, review signals) | ~1,060 | ~80 functions | no |
| Dashboard field definitions (location config) | ~110 | constants | no |
| Effective-value precedence | ~140 | 1 key function | no |
| Posted-at date parsing | ~160 | ~7 functions | no |
| Query/SQL helpers | ~200 | ~10 functions | no |

The key finding is that a large portion of the file is no longer truly "storage code." The ~2,150 lines of standalone functions outside the class body have little or no database dependency and are mostly pure logic.

## Current Architectural Patterns

Important patterns a future refactorer should know about:

- **Database driver:** `node:sqlite` `DatabaseSync` (synchronous API). This means a D1 adapter cannot be a drop-in replacement, because D1 is async.
- **No prepared statement caching.** Every method calls `this.db.prepare(...)` inline with raw SQL template strings. The same SQL is re-parsed on every invocation.
- **No formal storage interface.** `src/storage/storage.js` is a 15-line factory that instantiates `SqliteStorage` with a resolved file path. The class itself IS the implicit contract.
- **Dynamic WHERE clause construction.** A recurring pattern: build `clauses[]` and `params[]`, then combine with `buildWhereClause(clauses)`. This is a hand-rolled query builder.
- **All JSON columns stored as `*_json` text columns.** Serialized with `toJson()`, deserialized with `parseJson()` in row mappers.
- **Dashboard filtering, sorting, and pagination all happen in JavaScript, not SQL.** `listDashboardListings` fetches all candidate rows, then filters by price/beds/baths/borough/neighborhood/confidence/time-window in JS, sorts with `Array.sort()`, and paginates with `Array.slice()`. This works at the current scale (~256 listings) but will not scale, and more importantly it cannot be reused for a D1 cloud API where SQL-level filtering is required.

## Biggest Extractable Block

The single strongest extraction seam is the dashboard presentation layer:

- filtering
- sorting
- pagination
- variant collapsing
- review signal derivation
- date parsing

This block is ~1,060 lines across ~80 functions, all operating on in-memory arrays after the SQL fetch. It has zero direct database dependency and can move out of `sqlite-storage.js` with low behavioral risk.

## Suggested Module Split

The decomposition targets both the standalone functions (~2,150 lines outside the class) and the class body itself (~3,490 lines). The class does not need to stay monolithic — its internal concerns have clear boundaries and can be split into focused modules that receive the `db` handle.

### Standalone function extraction

These are pure functions with no `this` or `db` dependency. Low-risk moves.

Storage-adjacent (stay in `src/storage/`):

- `row-mappers.js` (~470 lines)
  - all ~25 snake_case to camelCase entity row mappers
- `query-helpers.js` (~200 lines)
  - shared WHERE clause builder, placeholders, normalizers, text/duration utilities
- `effective-value.js` (~140 lines)
  - 4-layer precedence resolution (manual override > resolved field > raw extracted > raw observation)

UI/presentation concern (move to `src/ui/dashboard/lib/` or similar):

- `dashboard-formatters.js` (~300 lines)
  - list/detail item builders and projection mappers
- `dashboard-filters.js` (~200 lines)
  - variant collapsing, filter matchers, sort comparators
- `dashboard-review.js` (~315 lines)
  - review signal derivation, review item builders, queue counting
- `dashboard-field-definitions.js` (~110 lines)
  - location field config and review-eligibility rules
- `posted-at-parser.js` (~160 lines)
  - Facebook relative / weekday / absolute date parsing

### Class decomposition

The class body has clear internal seams. Each concern below has its own data model, its own lifecycle, and minimal coupling to the others. They can become separate modules that receive the `db` handle from the core storage instance.

| Module | Lines | What moves | Why it's separable |
|--------|------:|------------|-------------------|
| `sqlite-storage.js` (core) | ~630 | Constructor, pragmas, migrations, `withTransaction`, `nextId`, require/select helpers | This is the skeleton everything else hangs on |
| `sqlite-crawl-ops.js` | ~460 | `getOrCreateSource`, `beginRun`, `recordObservationBatch`, `recordListingsBatch`, `appendRunStep`, `finishRun`, stable post classification | Collection write path — one cohesive workflow |
| `sqlite-processing-queue.js` | ~870 | `enqueueProcessingJobs`, `claimProcessingJobs`, `completeProcessingJob`, `failProcessingJob`, `retryProcessingJobs`, `listProcessingJobs`, `summarizeProcessingQueueCoverage`, lease sweep | Self-contained job queue with its own lifecycle, lease semantics, and retry logic |
| `sqlite-evidence-ops.js` | ~720 | `recordEvidenceFragments`, `upsertResolvedField`, `applyManualOverrideAction`, `setManualOverride`, `clearManualOverride`, `appendAuditEvent`, `getEffectiveFieldValue`, and the write/select helpers for overrides and audit | Self-contained evidence/resolution/review concern |
| `sqlite-read-helpers.js` | ~650 | `listSources`, `listRecentRuns`, `listRunSteps`, `listObservations`, `listListings`, `listEvidenceFragments`, `listResolvedFields`, `listManualOverrides`, `listAuditEvents`, `listArtifactRefs` | CLI inspection read paths — all follow the same pattern (build clauses, run query, map rows) |
| `sqlite-dashboard-queries.js` | ~610 | `listDashboardListings`, `getDashboardListingDetail`, `listDashboardPosts`, `getDashboardPostDetail`, `listDashboardReviewItems`, `getDashboardReviewItem`, `listDashboardDebugRuns`, `getDashboardDebugRun`, `validateRun` | Dashboard/UI-specific read model — delegates to extracted presentation helpers |

### Composition pattern

The simplest approach: keep `SqliteStorage` as a thin facade that owns the `db` handle and delegates to the focused modules. Each module exports functions that accept `db` (and optionally shared helpers like `withTransaction`) as arguments. The facade re-exports them as methods so the rest of the codebase sees the same public API.

This avoids class inheritance, mixins, or complex DI patterns. The test suite continues to instantiate `SqliteStorage` and call the same method names.

### Expected result

| Before | After |
|--------|-------|
| 1 file, 5,660 lines | ~15 files averaging ~380 lines |
| Largest module: 5,660 lines | Largest module: ~870 lines (processing queue) |
| Pure presentation logic in storage layer | Presentation logic in `src/ui/dashboard/lib/` |
| Class mixes 6+ unrelated concerns | Each module owns one concern |

## Why This Refactor Is Worth Doing

- It replaces one 5,660-line file with ~15 focused modules averaging ~380 lines.
- It moves dashboard presentation logic out of the storage layer and into the UI layer where it belongs.
- It makes each concern independently testable without pulling in unrelated storage code.
- It makes the Phase 2 SQL pushdown work more focused, because the JS-side filtering/sorting/pagination is visibly separate from the SQL queries it replaces.
- It creates a cleaner seam between canonical local SQLite writes and any later public/cloud read surface.
- It makes the processing queue independently understandable — useful if queue behavior ever needs to change without touching collection or evidence logic.
- It reduces the cognitive load for any contributor touching storage: you only need to understand the module you are changing, not 5,660 lines of context.

## Important Constraint: No ORM

Do **not** adopt an ORM as part of this cleanup.

### What we evaluated

- **Drizzle ORM** — the only library with first-party `node:sqlite` + Cloudflare D1 support. Adopting it would mean: full TypeScript schema definition mirroring 3 migration files, rewriting 71 `db.prepare` calls, converting the synchronous transaction pattern. V1 is still in beta. High cost for a working local write-side.
- **Kysely** — no first-party `node:sqlite` support (would require switching to `better-sqlite3`). D1 dialect is community-maintained only, not first-party.
- **Raw D1 API** — almost identical to `node:sqlite` (`env.DB.prepare(sql).bind(...).all()` vs `db.prepare(sql).all(...)`). For 3-5 cloud read queries, raw SQL is sufficient without a library.
- **Prisma** — does not support Cloudflare D1. Not a fit.

### Recommended architecture

- local laptop canonical write-side
  - `node:sqlite` (`DatabaseSync`)
  - raw SQL
  - keep as-is
- later `publish:cloud` CLI
  - reads local SQLite
  - materializes curated public tables (`public_sources`, `public_listings`)
  - writes to D1 via wrangler or the D1 REST API
- Cloudflare Worker public read-side
  - D1 binding
  - a few raw SQL queries (3-5 endpoints)
  - no shared query logic with the local storage layer

### Why

- The local write-side already works: 5,660 lines of battle-tested raw SQL with 110 passing tests.
- The D1 read-side is a different, much smaller surface with different tables and read-only queries.
- Rewriting the whole storage layer for an ORM adds cost and risk without solving the real problem.
- The natural seam is the `publish:cloud` step, not a shared query builder.

If the D1 cloud query surface eventually grows to 15+ queries with complex filtering, reconsider Drizzle for the cloud Worker side only. Do not adopt it for the local write-side.

## Recommended Phases

### Phase 1a: extract standalone functions, no behavior change

Move the ~2,150 lines of pure standalone functions into dedicated modules. This is the lowest-risk step — these functions have no `this` or `db` dependency and can be extracted mechanically.

Target modules:
- `src/storage/row-mappers.js`
- `src/storage/query-helpers.js`
- `src/storage/effective-value.js`
- `src/ui/dashboard/lib/dashboard-formatters.js`
- `src/ui/dashboard/lib/dashboard-filters.js`
- `src/ui/dashboard/lib/dashboard-review.js`
- `src/ui/dashboard/lib/dashboard-field-definitions.js`
- `src/ui/dashboard/lib/posted-at-parser.js`

All 110 tests should continue passing with zero behavioral change. The class methods that call these functions simply import them from the new locations instead of referencing them as file-local functions.

### Phase 1b: decompose the class into focused modules

Split the class body into domain-specific modules that receive the `db` handle. Each module owns one concern:

- `src/storage/sqlite-storage.js` (~630 lines) — core skeleton and facade
- `src/storage/sqlite-crawl-ops.js` (~460 lines) — collection write path
- `src/storage/sqlite-processing-queue.js` (~870 lines) — job queue lifecycle
- `src/storage/sqlite-evidence-ops.js` (~720 lines) — evidence/resolution/override
- `src/storage/sqlite-read-helpers.js` (~650 lines) — CLI inspection reads
- `src/storage/sqlite-dashboard-queries.js` (~610 lines) — dashboard read model

The facade re-exports all methods so the rest of the codebase sees the same public API. This is still a behavior-preserving refactor — the test suite should pass unchanged.

### Phase 2: push dashboard filtering/sorting/pagination into SQL

Once the module structure is clean, replace the JavaScript-side filtering, sorting, and pagination with SQL equivalents. This is where the real performance and architectural wins happen.

#### Why this matters

SQLite `ORDER BY` with an index is dramatically faster than `Array.sort()` on fetched rows. SQL `WHERE` eliminates rows before they reach JavaScript. SQL `LIMIT/OFFSET` means you never materialize rows you do not need. At 256 listings the JS path is invisible. At 5,000+ it will matter. At scale it is the difference between sub-millisecond and multi-second responses.

More importantly, a D1 cloud API requires SQL-level filtering — you cannot fetch all rows from an edge database and filter them in a Worker.

#### Current JS operations and their SQL replacements

| Current JS operation | Current function | SQL replacement |
|---------------------|-----------------|-----------------|
| Price range filter | `matchesDashboardListingFilters` | `WHERE price_amount >= ? AND price_amount <= ?` |
| Beds/baths minimum | `matchesDashboardListingFilters` | `WHERE total_bedrooms >= ? AND bathrooms >= ?` |
| Borough/neighborhood filter | `matchesDashboardListingFilters` | `WHERE borough = ? AND neighborhood = ?` |
| Confidence minimum | `matchesDashboardListingFilters` | `WHERE confidence_overall >= ?` |
| Time-window filter (posted within N hours) | `matchesDashboardTimeWindow` | `WHERE posted_at >= ?` (precompute cutoff) |
| Text search | `matchesDashboardTextQuery` | `WHERE body_text LIKE ?` (or SQLite FTS5 for full-text) |
| Newest/oldest sort | `compareDashboardListingRows` | `ORDER BY posted_at DESC` / `ASC` |
| Price sort | `compareDashboardListingRows` | `ORDER BY price_amount ASC` / `DESC` |
| Confidence sort | `compareDashboardListingRows` | `ORDER BY confidence_overall DESC` |
| Pagination | `paginateDashboardItems` (`Array.slice`) | `LIMIT ? OFFSET ?` |
| Variant collapsing (group by observation+ordinal, pick best) | `collapseDashboardListingVariants` (JS `Map`) | `ROW_NUMBER() OVER (PARTITION BY observation_id, ordinal ORDER BY ...)` window function |
| Latest job per observation | `selectDashboardLatestJobCandidates` (JS `Map` dedup) | `ROW_NUMBER() OVER (PARTITION BY observation_id ORDER BY created_at DESC)` |

#### What stays in JS after Phase 2

Some operations are legitimately better in JS:

- Effective-value precedence resolution (crosses manual_overrides, resolved_fields, and in-payload JSON — awkward in SQL)
- Review signal derivation (computes reasons from multiple data sources per row)
- Dashboard formatting / projection (camelCase mapping, nested object construction)

These remain in the extracted presentation modules from Phase 1a.

### Phase 3: public/cloud read model

When the public D1 path is ready, build a thin publisher and a small raw-SQL Worker read layer against curated public tables.

Do not try to share the entire local storage layer with the cloud read model. The Phase 2 SQL queries will be reusable patterns for the D1 Worker, but the Worker should have its own thin query module, not import from the local storage layer.

See:
- `docs/reviews/2026-03-16_00-40-29_CLOUDFLARE_DEPLOYMENT_READINESS_REVIEW.md`

## Backlog Status

This is important, but it is not the next milestone.

Current sequencing:

1. multi-source collector runtime / ingest hardening
2. later storage modularization and dashboard SQL pushdown
3. later public/cloud read model work

## Recommended Use

When we decide to tackle this:

- start from this review
- make a fresh execution bundle
- Phase 1a and 1b should be strictly behavior-preserving: same public API, same test suite, zero behavioral change
- Phase 2 changes behavior (queries return the same data but via SQL instead of JS) — validate against real stored data, not just unit tests
- defer ORM discussions unless the public-cloud architecture changes materially
- do not combine Phase 1 and Phase 2 in the same pass — get the structure right first, then change the query strategy

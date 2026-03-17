# Lightweight Inspection Frontend Pass

Date: 2026-03-15

## Scope

Build the thinnest useful local-only operator UI for inspecting the current SQLite-backed pipeline state:

- recent crawl runs
- ingested observations
- processing jobs and processed Gemini payloads
- normalized listing rows
- run steps, provenance, and artifact refs

This pass stayed narrow. I did not change ingestion control flow, queue semantics, storage schema, or artifact formats. The UI is read-only and local-first.

## Files Changed

- `README.md`
- `docs/PIPELINE.md`
- `docs/passes/README.md`
- `docs/passes/2026-03-15_11-50-16_LIGHTWEIGHT_INSPECTION_FRONTEND_PASS.md`
- `package.json`
- `src/cli/inspect-ui.js`
- `src/ui/inspection-app.css`
- `src/ui/inspection-app.html`
- `src/ui/inspection-app.js`
- `src/ui/inspection-server.js`
- `test/inspect-ui.test.js`

## Exact Commands Run

### Required reading and code review

```bash
sed -n '1,220p' README.md
sed -n '1,260p' docs/INDEX.md
sed -n '1,320p' docs/VISION_AND_ARCHITECTURE.md
sed -n '1,320p' docs/PIPELINE.md
sed -n '1,260p' data/README.md
sed -n '1,320p' docs/LISTING_SCHEMA.md
sed -n '1,280p' docs/passes/2026-03-13_15-27-51_INGEST_LOOP_CONTROLLER_PASS.md
sed -n '1,260p' docs/passes/2026-03-13_17-18-26_PHASE1_BACKFILL_SESSION_AND_DEBUG_PASS.md
sed -n '1,320p' src/cli/inspect-storage.js
sed -n '1,320p' src/cli/inspect-jobs.js
sed -n '1,400p' src/storage/sqlite-storage.js
git status --short
```

### Required storage and artifact inspection

```bash
npm run inspect:storage -- runs --source-key williamsburggreenpointhousing --limit 10

npm run inspect:storage -- observations --run-id 2026-03-13T20-43-31-678Z --limit 20 --full
npm run inspect:storage -- observations --run-id 2026-03-13T20-47-43-444Z --freshness fresh --limit 20 --full
npm run inspect:storage -- observations --run-id 2026-03-13T20-59-37-736Z --freshness fresh --limit 10 --full

npm run inspect:jobs -- --run-id 2026-03-13T20-43-31-678Z --status processed --freshness fresh --full
npm run inspect:jobs -- --run-id 2026-03-13T20-47-43-444Z --status processed --freshness fresh --full
npm run inspect:jobs -- --status pending --source-key williamsburggreenpointhousing --limit 30

npm run inspect:storage -- listings --run-id 2026-03-13T20-43-31-678Z --limit 20 --full
npm run inspect:storage -- listings --run-id 2026-03-13T20-47-43-444Z --limit 20 --full

npm run inspect:storage -- run-steps --run-id 2026-03-13T20-47-43-444Z --limit 200
npm run inspect:storage -- artifacts --run-id 2026-03-13T20-47-43-444Z --limit 50
npm run inspect:storage -- validate-run --run-id 2026-03-13T20-47-43-444Z

ls data/collected/facebook/williamsburggreenpointhousing
ls data/listings/facebook/williamsburggreenpointhousing
ls data/raw/facebook/williamsburggreenpointhousing
```

### Frontend implementation validation

```bash
npm run inspect:ui -- --port 4310
curl -s http://127.0.0.1:4310/ | head -n 5
curl -s 'http://127.0.0.1:4310/api/runs?sourceKey=williamsburggreenpointhousing&limit=5' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const obj=JSON.parse(s);console.log(JSON.stringify(obj.items.map((run)=>({id:run.id,status:run.status,fresh:run.freshObservationCount,listings:run.listingCount,steps:run.runStepCount})),null,2));});"
node --check src/ui/inspection-app.js
node -e "const base='http://127.0.0.1:4310'; const runIds=['2026-03-13T20-43-31-678Z','2026-03-13T20-47-43-444Z','2026-03-13T20-59-37-736Z']; async function get(path){const res=await fetch(base+path); if(!res.ok) throw new Error(path+' '+res.status); return res.json();} (async()=>{const report=[]; for (const runId of runIds){const run=await get('/api/run?runId='+encodeURIComponent(runId)); const observations=await get('/api/observations?runId='+encodeURIComponent(runId)+'&limit=500&full=1'); const jobs=await get('/api/jobs?runId='+encodeURIComponent(runId)+'&limit=500&full=1'); const listings=await get('/api/listings?runId='+encodeURIComponent(runId)+'&limit=500&full=1'); const steps=await get('/api/run-steps?runId='+encodeURIComponent(runId)+'&limit=500'); const artifacts=await get('/api/artifacts?runId='+encodeURIComponent(runId)+'&limit=500'); report.push({runId, observations: observations.count, jobs: jobs.count, listings: listings.count, steps: steps.count, artifacts: artifacts.count, hasObservationPayload: Boolean(observations.items[0]?.payload), hasProcessedPayload: jobs.items.some((job)=>job.processedPayload), hasListingPayload: listings.items.some((listing)=>listing.payload), extractorVersions: [...new Set(listings.items.map((listing)=>listing.extractorVersion).filter(Boolean))], validationIssues: run.validation?.mismatches || []}); } console.log(JSON.stringify(report, null, 2)); })().catch((error)=>{console.error(error); process.exit(1);});"
npm test
```

## Architecture Chosen And Why

Chosen shape:

- one local Node process started by `npm run inspect:ui`
- built-in `node:http` server, no extra framework
- read-only JSON endpoints backed directly by existing storage helpers
- one static no-build browser app served by the same process

Why:

- it keeps SQLite as the canonical backing store
- it avoids turning CLI subprocess output into a browser contract
- it reuses repo-native storage logic instead of introducing a second data access layer
- it keeps iteration fast and local
- it gives us a clean read-only boundary that can later be swapped for a Cloudflare-hosted service if the data source moves off the laptop

Before locking this in, I dispatched fresh-context agents for:

- exact run/observation/job/listing/payload shapes
- the thinnest viable local-only UI architecture

The answers converged on the same approach: reuse storage helpers directly, keep the UI read-only, do not add frontend framework/build-tool sprawl, and do not make artifact JSON the source of truth.

## What Data Surfaces The UI Exposes

- Runs index with source key, run kind, status, timestamps, fresh/seen/unidentified counts, listing count, step count, and artifact count
- Run detail summary with `validate-run` output
- Observations tab with author, `postedAtText`, freshness, body preview, `postUrl`, `platformPostId`, `capturedAt`, raw artifact path, and expandable full JSON
- Jobs tab with status, processed listing count, provenance tuple, timestamps, and side-by-side observation input vs processed Gemini payload JSON
- Listings tab with listing type, post intent, borough, neighborhood, price, room/date fields, confidence, ambiguities, provenance, and full normalized payload JSON
- Run steps tab with step index, visible/fresh/seen/unidentified counters, cumulative counts, scroll position, and body height
- Artifacts tab with artifact kind, run/observation linkage, relative path, and direct file viewing inside `data/`
- Filters for source key, run search, observation freshness, job status, extractor version, and tab-local text search

## Validation

- `npm test` passed
- the UI launched locally with `npm run inspect:ui -- --port 4310`
- the HTML app shell served successfully from `http://127.0.0.1:4310/`
- API verification succeeded for:
  - `2026-03-13T20-43-31-678Z`
  - `2026-03-13T20-47-43-444Z`
  - `2026-03-13T20-59-37-736Z`
- each required run returned observations, jobs, listings, run steps, and artifacts through the UI API
- each required run exposed full observation payloads, processed Gemini payloads, and listing payloads
- the current Williamsburg dataset still shows mixed listing provenance in the UI:
  - `gemini-structured-v1|gemini-processed-payload-v1|gemini-3-flash-preview`
  - `text-extractor-v1`

## Known Gaps / Next Steps

- Filters inside a run are client-side over the fetched result set. There is no server-side pagination yet.
- The artifact viewer is intentionally simple and text-first. It does not render media previews.
- SQLite write activity can still contend with the read-only server during active ingestion. The server has a narrow retry for `SQLITE_BUSY`, but it is not a full concurrency layer.
- The UI is an operator surface, not a product shell. If this later moves behind Cloudflare, keep the read-only contract and swap the backing service rather than expanding this local pass into a premature hosted architecture.

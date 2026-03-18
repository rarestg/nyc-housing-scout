# Observability / Debuggability Pass — 2026-03-12

## Scope

This pass was intentionally small and local:

- no collector redesign
- no new backend beyond the current SQLite path
- no attempt to turn debugging into a service or dashboard

The goal was to make the active storage state inspectable during development without dropping into raw SQL.

## What Changed

- Added storage read/query helpers on top of the SQLite storage layer for:
  - sources
  - recent runs
  - run steps
  - observations
  - listings
  - artifact references
  - run validation
- Added a local CLI entrypoint:
  - `npm run inspect:storage -- ...`
- Kept the output pragmatic and JSON-shaped for development use.
- Added run validation that compares persisted summary counts against the actual stored observations, listings, and artifact references.
- Added tests for the new read helpers and CLI surface.

## Storage Read Helpers

The active storage interface now exposes:

- `listSources(...)`
- `listRecentRuns(...)`
- `listRunSteps(...)`
- `listObservations(...)`
- `listListings(...)`
- `listArtifactRefs(...)`
- `validateRun(...)`

These helpers return parsed records with source/run context and useful counts, rather than raw SQLite rows.

## CLI Surface

Primary commands:

- `npm run inspect:storage -- sources`
- `npm run inspect:storage -- runs --source-key nyc-housing-group --limit 5`
- `npm run inspect:storage -- run-steps --run-id <runId>`
- `npm run inspect:storage -- observations --run-id <runId> --limit 10`
- `npm run inspect:storage -- listings --run-id <runId> --full`
- `npm run inspect:storage -- artifacts --run-id <runId>`
- `npm run inspect:storage -- validate-run --run-id <runId>`

Useful flags:

- `--source-key <key>`
- `--run-id <runId>`
- `--limit <n>`
- `--full`
- `--data-dir <path>`

Notes:

- output is JSON
- default storage path remains `data/storage/nyc-housing-scout.sqlite`
- `--full` expands observations/listings to include full text and payload fields

## Validation Behavior

`validate-run` currently checks:

- summary observation counts vs persisted observation counts
- summary listing counts vs persisted listing counts
- summary identified-post counts vs persisted identified observations
- presence of expected completed-run export paths
- duplicate export artifact refs
- observations missing raw artifact refs

This is intentionally a light development check, not a formal migration or integrity framework.

## Tests

Added coverage for:

- source/run/step/observation/listing/artifact inspection helpers
- full-payload observation/listing reads
- run validation output
- CLI JSON output for runs, observations, and validate-run

## Non-Goals

- no dashboard
- no remote observability backend
- no schema redesign
- no changes to the legacy snapshot commands beyond staying compatible

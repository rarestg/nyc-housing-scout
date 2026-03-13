# Feed Capture Pipeline

## Primary Path

The primary collection path is now the DOM-based Facebook feed capture via the live attached Chrome tab and `openclaw browser evaluate`.

### Commands

- Capture latest visible DOM slice:
  - `npm run capture:dom -- --source-key nyc-housing-group --limit 20`
- Crawl down the DOM feed until enough fresh posts are collected:
  - `npm run crawl:dom -- --source-key nyc-housing-group --target 20 --max-scrolls 20`
- Inspect the SQLite-backed storage state without raw SQL:
  - `npm run inspect:storage -- runs --source-key nyc-housing-group --limit 5`
  - `npm run inspect:storage -- observations --run-id <runId> --limit 10`
  - `npm run inspect:storage -- listings --run-id <runId> --full`
  - `npm run inspect:storage -- validate-run --run-id <runId>`

The older snapshot commands still exist as fallback/debug tools:
- `npm run capture:feed -- --limit 20`
- `npm run crawl:latest -- --target 20 --max-scrolls 20`

## Artifact Layers

- raw browser-origin DOM payloads:
  - `data/raw/facebook/<sourceKey>/<runId>/<post-key>.json`
- per-run collected post bundle:
  - `data/collected/facebook/<sourceKey>/capture-<timestamp>.json`
  - `data/collected/facebook/<sourceKey>/crawl-<timestamp>.json`
- per-run extracted listing bundle:
  - `data/listings/facebook/<sourceKey>/capture-<timestamp>.json`
  - `data/listings/facebook/<sourceKey>/crawl-<timestamp>.json`
- SQLite storage database for the active DOM path:
  - `data/storage/nyc-housing-scout.sqlite`

Legacy snapshot commands still write the older global seen cache:
- `data/cache/seen-post-ids.json`

## Collected Post Contract

The active DOM path now normalizes feed posts into a canonical `CollectedPost` shape before extraction. The contract includes:

- `sourceKey`
- `postId`
- `postUrl`
- `authorName`
- `postedAtText`
- `bodyText`
- `comments`
- `media`
- `captureMethod`
- `captureRunId`
- `capturedAt`
- `rawArtifactPath`
- `derivedLocation`

Listing extraction in the DOM flow operates on `CollectedPost` objects so listing `source.*` metadata stays attached to extracted rows.

## Current Design

1. evaluate visible DOM cards from the attached browser tab
2. persist raw browser-origin payloads under a run-scoped raw directory
3. register or look up the tracked source in the storage layer
4. begin a crawl/capture run in the storage layer
5. normalize each raw record into a canonical collected post
6. persist collected-post observations and source-scoped seen-post state through the storage interface
7. extract listings only from fresh collected posts
8. persist listings, run checkpoints, and per-run export artifacts separately

## Crawl Semantics

For `crawl:dom`, `--target` now means fresh posts, not total unique posts seen during the run.

The crawl loop keeps separate counts for:
- `freshCollected`
- `seenCollected`
- `unidentifiedCollected`

Seen posts are still collected and persisted in the collected-post artifact, but they are not re-extracted into listings.

Run steps are also checkpointed into SQLite during the crawl so source/run history survives process completion.

## Storage Inspection Surface

The local inspection CLI sits on top of storage read helpers so development debugging does not need ad hoc SQLite queries.

Available subcommands:

- `sources`
  - list registered sources with run / observation / listing counts
- `runs`
  - list recent runs with per-run observation, listing, step, and artifact counts
- `run-steps`
  - inspect persisted crawl checkpoints for a run
- `observations`
  - inspect collected-post observations with freshness, source metadata, artifact references, and optional full payloads
- `listings`
  - inspect extracted listing rows with observation/source context and optional payloads
- `artifacts`
  - inspect raw/export artifact references for a run or observation
- `validate-run`
  - compare stored run summary counts against persisted observations/listings/artifacts and report mismatches

Useful flags:

- `--source-key <key>`
- `--run-id <runId>`
- `--limit <n>`
- `--full`
- `--data-dir <path>`

## Remaining Work

- better author/time extraction from DOM cards
- stronger mapping of post body -> permalink when Facebook hides direct `/posts/...` URLs
- cleaner modeling of wanted posts vs offered listings
- broader fixture coverage for real raw DOM captures

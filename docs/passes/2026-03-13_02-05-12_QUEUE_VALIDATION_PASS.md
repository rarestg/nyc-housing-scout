# Queue Validation Pass — 2026-03-13

## Scope

This pass exercised the real processing queue against recent stored crawl data.

- no Gemini integration
- no schema compatibility work for stale local state
- no new orchestration layer

The goal was to make queue coverage explicit from `post_observations`, then validate the real `enqueue -> process -> inspect` shape on a recent crawl run.

## What Changed

- Added `summarizeProcessingQueueCoverage(...)` to SQLite storage so queue coverage can be reported directly from scoped observations plus processing-job status.
- Added a shared batch runner for the current heuristic processor so `process:jobs` and the validator use the same claim/process/fail path.
- Added `npm run validate:queue -- ...` to run a repeatable local validation pass over a run/source/observation scope.
- Extended job filtering to accept observation `freshness` consistently across claim/list/retry surfaces.
- Added CLI test coverage for the validator, including repeat runs on the same scope.

## Validation Command

Primary command:

- `npm run validate:queue -- --run-id <runId>`

The validator reports:

- total observations in scope
- eligible observations
- excluded observations missing `postUrl`
- eligible observations with jobs vs without jobs
- job status counts in scope
- jobs created vs already existing
- jobs processed vs retryable/failed in the current run
- representative excluded observations and processed payload samples

## Live Run

Validation was run against the recent crawl run:

- `runId`: `2026-03-13T00-35-05-584Z`
- source: `facebook-default`
- run started: `2026-03-13T00:35:05.586Z`

First validation run:

- total observations in scope: `33`
- eligible observations: `30`
- excluded for missing `postUrl`: `3`
- eligible observations with jobs before enqueue: `0`
- jobs created: `30`
- jobs already existing: `0`
- jobs processed successfully: `30`
- jobs retryable: `0`
- jobs failed: `0`
- job status after validation: `30 processed`, `0 pending`, `0 retryable`, `0 failed`

Repeat validation run on the same scope:

- jobs created: `0`
- jobs already existing: `30`
- claimed jobs: `0`
- processed jobs: `0`
- job status remained: `30 processed`, `0 pending`, `0 retryable`, `0 failed`

This confirms the queue shape is working as intended on live-like stored crawl data:

- missing `postUrl` observations stay visible as explicit exclusions
- eligible observations enqueue once per provenance tuple
- the same scope is safe to rerun without duplicating work
- processed payloads remain inspectable through the queue surface

## Representative Samples

Excluded observations missing `postUrl` included:

- `obs_000103` — author `Manhad Mohamed` — unidentified post requesting a 2-bedroom sublet
- `obs_000092` — author `Anonymous member` — unidentified ISO post with no recoverable permalink

Representative processed payloads included:

- `obs_000108` / `job_000030`
  - post URL: `https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24422780034086569/`
  - heuristic output: `1` extracted listing
  - shape: furnished Greenpoint sublet, borough `Brooklyn`, price unresolved
- `obs_000107` / `job_000029`
  - post URL: `https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24416223784742194/`
  - heuristic output: `1` extracted listing
  - shape: East Williamsburg entire-apartment listing, `$4,999/month`, `1 bed`

## Notes

- `postUrl` is now an explicit queue-coverage metric instead of only an enqueue side effect.
- This pass still uses the heuristic processor only; `processed_payloads` are the inspection boundary for now.
- Inline listing extraction during crawl still exists as transitional behavior, but the validator now proves the queue path works on real stored observations.

## Next Step

The next implementation step is to define the Gemini structured processed-payload schema and plug it into `process:jobs` behind the same provenance tuple, while keeping `validate:queue` as the repeatable real-data regression check.

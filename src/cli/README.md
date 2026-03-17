# CLI Map

Quick map from npm script to stage and entrypoint.

For flags, examples, and runtime behavior, use `docs/PIPELINE.md`.

## Collection

| Script | File | Role |
|--------|------|------|
| `capture:dom` | `src/cli/capture-dom-feed.js` | One visible DOM feed slice with raw + collected artifact output |
| `crawl:dom` | `src/cli/crawl-dom-latest.js` | Multi-step crawl with freshness stopping rules and optional CDP network assist |
| `ingest:loop` | `src/cli/ingest-loop.js` | Repeated collection loop with preflight, idle handling, and optional downstream processing |

## Storage And Operator Inspection

| Script | File | Role |
|--------|------|------|
| `inspect:storage` | `src/cli/inspect-storage.js` | Inspect sources, runs, observations, listings, artifacts, evidence, resolved fields, manual overrides, and audit history |
| `inspect:ui` | `src/cli/inspect-ui.js` | Launch the local operator UI server on `127.0.0.1:4310` |
| `inspect:jobs` | `src/cli/inspect-jobs.js` | Inspect queue/job state without opening SQLite manually |

## Queue And Processing

| Script | File | Role |
|--------|------|------|
| `enqueue:processing` | `src/cli/enqueue-processing.js` | Create processing jobs for eligible observations |
| `validate:queue` | `src/cli/validate-queue.js` | Validate enqueue/process coverage for a run or slice of observations |
| `process:jobs` | `src/cli/process-jobs.js` | Claim and process queued jobs into `processed_payloads` and `listing_records` |
| `retry:jobs` | `src/cli/retry-jobs.js` | Requeue failed or retryable jobs |

## Evidence And Review Support

| Script | File | Role |
|--------|------|------|
| `enrich:evidence` | `src/cli/enrich-evidence.js` | Derive observation-scoped evidence fragments |
| `resolve:addresses` | `src/cli/resolve-addresses.js` | Write resolved location fields for listing records |

## Extractor Spot Checks

| Script | File | Role |
|--------|------|------|
| `extract:text` | `src/cli/extract-text.js` | Heuristic extraction against a text fixture |
| `extract:html` | `src/cli/extract-html.js` | Heuristic extraction against an HTML fixture |
| `gemini:extract` | `src/cli/gemini-structured-extract.js` | Direct Gemini structured extraction spot check |

## Legacy / Debug Helpers

| Script | File | Role |
|--------|------|------|
| `capture:feed` | `src/cli/capture-feed.js` | Older snapshot collector |
| `crawl:latest` | `src/cli/crawl-latest.js` | Older multi-scroll collector |
| `expand:posts` | `src/cli/expand-posts.js` | Older helper for expanding post cards |

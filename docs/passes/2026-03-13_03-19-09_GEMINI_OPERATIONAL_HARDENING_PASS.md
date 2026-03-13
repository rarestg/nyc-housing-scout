# Gemini Operational Hardening — 2026-03-13

## Scope

This pass hardened the existing Gemini-backed queue path without changing the overall pipeline shape.

- no backward-compatibility work for old local state
- no new orchestration layer
- no new observability subsystem

The target was narrow:

1. add explicit timeout / cancellation to live Gemini calls
2. make sequential lease behavior safe so one stuck call does not pin a whole claimed batch
3. expose lightweight operational metrics directly in the existing `process:jobs` / `validate:queue` path

## What Changed

### 1. Explicit Gemini timeout / cancellation

- Gemini structured extraction now sets both:
  - `config.abortSignal`
  - `config.httpOptions.timeout`
- the default request timeout is now `180000ms`
- the effective timeout is clamped below the job lease so the request fails before lease expiry
- timeout failures are normalized to a clear error:
  - `Gemini request timed out after <n>ms`

### 2. Sequential claim safety

`runProcessingBatch(...)` no longer claims the whole requested batch up front and then processes sequentially.

Instead it now:

1. claims exactly one job
2. processes it
3. completes or fails it
4. claims the next job

This keeps the current local-first queue model intact while making slow sequential batches safe:

- one stuck call now holds at most one leased job
- later jobs remain unclaimed and available
- timeout + retry recovery no longer depends on lease sweep to unblock a whole batch

### 3. Lightweight metrics in the existing path

The queue runner and CLI JSON now emit:

- batch `claimToCompleteMs`
- per-job `latencyMs`
- `timeoutCount`
- `retryCount`
- aggregated Gemini `tokenUsage`
- batch outcomes split into `processed`, `retryable`, and `failed`

Successful `processed_payloads.payload_json` rows now also store:

- `gemini.requestTimeoutMs`
- `processing.status`
- `processing.claimedBy`
- `processing.attemptCount`
- `processing.retryCount`
- `processing.claimedAt`
- `processing.completedAt`
- `processing.latencyMs`

## Code / Doc Changes

- `src/processing/gemini/config.js`
  - added timeout defaults and lease guard constants
- `src/processing/gemini/processor.js`
  - resolves an effective request timeout that stays under the lease
- `src/processing/gemini/structured-output-experiment.js`
  - added abortable timeout handling around live Gemini requests
  - records `requestTimeoutMs` in the stored Gemini envelope
- `src/processing/run-processing-batch.js`
  - switched to claim-one/process-one sequential flow
  - added batch/job metrics and timeout classification
- `src/cli/processing-cli-helpers.js`
  - added `--request-timeout-ms`
- `src/cli/process-jobs.js`
  - surfaces request-timeout config and batch metrics
- `src/cli/validate-queue.js`
  - surfaces request-timeout config and batch metrics
- `test/gemini-structured-output.test.js`
  - added timeout and timeout-clamping coverage
- `test/processing-pipeline.test.js`
  - added sequential-claim + timeout + metrics coverage
- `docs/PIPELINE.md`
  - documented timeout behavior, sequential claims, and emitted metrics

## Live Validation

Validation used the real crawl run:

- `runId`: `2026-03-13T00-35-05-584Z`
- scope: `fresh` observations

To avoid disturbing the already-processed canonical Gemini rows, validation used isolated hardening provenance:

- `processorVersion`: `gemini-structured-v1-hardening`
- `schemaVersion`: `gemini-processed-payload-v1-hardening`
- `modelName`: `gemini-3-flash-preview`

### 1. Enqueue isolated live cohort

Command:

```bash
npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --enqueue-limit 4 --process-limit 0 --sample-limit 2 --full --processor-version gemini-structured-v1-hardening --schema-version gemini-processed-payload-v1-hardening --model-name gemini-3-flash-preview
```

Result:

- created `4` jobs
- observations:
  - `obs_000096`
  - `obs_000097`
  - `obs_000098`
  - `obs_000099`

### 2. Forced live timeout

Targeted the known slow observation `obs_000098` with a deliberately tiny timeout.

Command:

```bash
npm run process:jobs -- --observation-id obs_000098 --limit 1 --env-file data/cache/gemini/gemini.env --request-timeout-ms 50 --retry-delay-ms 0 --processor-version gemini-structured-v1-hardening --schema-version gemini-processed-payload-v1-hardening --model-name gemini-3-flash-preview --worker-id hardening-timeout-check
```

Observed result:

- claimed: `1`
- processed: `0`
- retryable: `1`
- failed: `0`
- `timeoutCount: 1`
- `claimToCompleteMs: 55`
- job status returned as `retryable`
- error stored as: `Gemini request timed out after 50ms`

This is the practical behavior change the repo needed: the row returned quickly as retryable instead of pinning a claimed batch until lease expiry.

### 3. Live retry recovery

Retried the same observation with a sane timeout.

Command:

```bash
npm run process:jobs -- --observation-id obs_000098 --limit 1 --env-file data/cache/gemini/gemini.env --request-timeout-ms 180000 --retry-delay-ms 0 --processor-version gemini-structured-v1-hardening --schema-version gemini-processed-payload-v1-hardening --model-name gemini-3-flash-preview --worker-id hardening-retry-check
```

Observed result:

- claimed: `1`
- processed: `1`
- retryable: `0`
- failed: `0`
- `retryCount: 1`
- `claimToCompleteMs: 4819`
- per-job latency: `4817ms`
- token usage:
  - `promptTokenCount: 1054`
  - `candidatesTokenCount: 732`
  - `totalTokenCount: 1786`

Stored payload metrics for the recovered row now include:

- `processing.attemptCount: 2`
- `processing.retryCount: 1`
- `processing.latencyMs: 4817`
- `gemini.requestTimeoutMs: 180000`

### 4. Remaining live batch

Processed the remaining three queued observations in one real batch.

Command:

```bash
npm run process:jobs -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --limit 3 --env-file data/cache/gemini/gemini.env --request-timeout-ms 180000 --retry-delay-ms 0 --processor-version gemini-structured-v1-hardening --schema-version gemini-processed-payload-v1-hardening --model-name gemini-3-flash-preview --worker-id hardening-batch-check
```

Observed result:

- claimed: `3`
- processed: `3`
- retryable: `0`
- failed: `0`
- `claimToCompleteMs: 11122`
- `timeoutCount: 0`
- `retryCount: 0`
- per-job latencies:
  - `obs_000096`: `3873ms`
  - `obs_000097`: `4315ms`
  - `obs_000099`: `2926ms`
- aggregated token usage:
  - `promptTokenCount: 5766`
  - `candidatesTokenCount: 1622`
  - `totalTokenCount: 7388`
  - `cachedContentTokenCount: 3024`

### 5. Final hardening snapshot

Command:

```bash
npm run validate:queue -- --run-id 2026-03-13T00-35-05-584Z --freshness fresh --enqueue-limit 4 --process-limit 0 --sample-limit 2 --processor-version gemini-structured-v1-hardening --schema-version gemini-processed-payload-v1-hardening --model-name gemini-3-flash-preview
```

Final queue state for the isolated hardening cohort:

- total jobs: `4`
- pending: `0`
- processing: `0`
- processed: `4`
- retryable: `0`
- failed: `0`

## Verification

- `node --test test/gemini-structured-output.test.js`
- `node --test test/processing-pipeline.test.js`
- `npm test`
- real live timeout on `obs_000098`
- real live retry of `obs_000098`
- real live three-job Gemini batch on `obs_000096`, `obs_000097`, and `obs_000099`

## Outcome

This pass closes the concrete operational gap found in the earlier Gemini validation work:

- stuck Gemini calls now time out explicitly
- sequential workers no longer pin a whole claimed batch
- timeout / retry / latency / token metrics are visible immediately in the current CLI path

## Next Recommended Follow-Up

Add a compact inspection surface for historical queue metrics by provenance and run, so timeout/retry tuning can be reviewed from stored rows without replaying raw CLI output.

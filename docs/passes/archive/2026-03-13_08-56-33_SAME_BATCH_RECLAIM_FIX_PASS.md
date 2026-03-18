# Same-Batch Re-Claim Fix — 2026-03-13

## Scope

This pass fixed a narrow queue bug introduced after the Gemini operational hardening work:

- a job that timed out and became immediately retryable could be claimed again within the same `process:jobs` invocation
- the failure mode showed up when `retryDelayMs=0` and `limit > 1`
- one queued row could burn through multiple attempts in one batch and even end `failed`

No queue model changes, migrations, or orchestration changes were added.

## What Changed

### 1. Batch-local claim exclusion

`runProcessingBatch(...)` now tracks the processing job IDs it has already handled in the current invocation and passes them back into `claimProcessingJobs(...)` as an exclusion list.

That means a row claimed once in a batch cannot be selected again by a later claim in that same batch, even if:

- the row becomes `retryable`
- `retryDelayMs=0`
- the requested `limit` is still not exhausted

### 2. Storage claim filter support

`storage.claimProcessingJobs(...)` now accepts `excludeJobIds` / `excludeJobId` and adds a `j.id NOT IN (...)` filter to the claim query.

The queue lifecycle stays the same:

- `pending` and due `retryable` rows are still claimable
- lease sweeping is unchanged
- retries across separate invocations still work normally

### 3. Exact regression coverage

Added a focused regression test for the reported failure mode:

- one queued observation
- Gemini request forced to time out
- `limit: 3`
- `requestTimeoutMs: 50`
- `retryDelayMs: 0`

Expected behavior now:

- the batch claims exactly once
- the row ends `retryable`
- `attemptCount` remains `1`
- the same invocation does not re-claim it

## Files Changed

- `src/processing/run-processing-batch.js`
- `src/storage/sqlite-storage.js`
- `test/processing-pipeline.test.js`

## Live Validation

Validation used isolated provenance against a real stored observation so canonical rows were untouched.

- observation: `obs_000098`
- run: `2026-03-13T00-35-05-584Z`
- processorVersion: `gemini-structured-v1-same-batch-fix`
- schemaVersion: `gemini-processed-payload-v1-same-batch-fix`
- modelName: `gemini-3-flash-preview`

### 1. Enqueue isolated row

Command:

```bash
npm run validate:queue -- --observation-id obs_000098 --sample-limit 1 --process-limit 0 --processor-version gemini-structured-v1-same-batch-fix --schema-version gemini-processed-payload-v1-same-batch-fix --model-name gemini-3-flash-preview
```

Result:

- created `1` job
- eligible observations: `1`

### 2. Exact live timeout repro

Command:

```bash
npm run process:jobs -- --observation-id obs_000098 --limit 3 --env-file data/cache/gemini/gemini.env --request-timeout-ms 50 --retry-delay-ms 0 --processor-version gemini-structured-v1-same-batch-fix --schema-version gemini-processed-payload-v1-same-batch-fix --model-name gemini-3-flash-preview --worker-id same-batch-reclaim-live-timeout
```

Result:

- claimed: `1`
- processed: `0`
- retryable: `1`
- failed: `0`
- `timeoutCount: 1`
- `claimToCompleteMs: 54`
- job status: `retryable`
- error: `Gemini request timed out after 50ms`

This is the bug fix in practice: the same invocation did not re-claim the row up to the requested limit of `3`.

### 3. Live retry recovery

Command:

```bash
npm run process:jobs -- --observation-id obs_000098 --limit 1 --env-file data/cache/gemini/gemini.env --request-timeout-ms 180000 --retry-delay-ms 0 --processor-version gemini-structured-v1-same-batch-fix --schema-version gemini-processed-payload-v1-same-batch-fix --model-name gemini-3-flash-preview --worker-id same-batch-reclaim-live-retry
```

Result:

- claimed: `1`
- processed: `1`
- retryable: `0`
- failed: `0`
- `retryCount: 1`
- `claimToCompleteMs: 4423`
- per-job latency: `4419ms`
- token usage:
  - `promptTokenCount: 1054`
  - `candidatesTokenCount: 732`
  - `totalTokenCount: 1786`

### 4. Final isolated queue state

Command:

```bash
npm run validate:queue -- --observation-id obs_000098 --sample-limit 1 --process-limit 0 --processor-version gemini-structured-v1-same-batch-fix --schema-version gemini-processed-payload-v1-same-batch-fix --model-name gemini-3-flash-preview
```

Result:

- total jobs: `1`
- pending: `0`
- processing: `0`
- processed: `1`
- retryable: `0`
- failed: `0`

## Verification

- `node --test test/processing-pipeline.test.js`
- `npm test`
- live Gemini timeout repro on `obs_000098`
- live Gemini retry recovery on `obs_000098`

## Notes

The tiny-lease timeout clamp behavior was not changed in this pass.

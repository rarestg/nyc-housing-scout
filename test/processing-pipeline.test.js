import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createCollectedPost } from '../src/core/collected-post.js';
import { DEFAULT_MODEL_NAME, DEFAULT_PROCESSOR_VERSION, DEFAULT_SCHEMA_VERSION } from '../src/processing/config.js';
import { processObservationWithHeuristics } from '../src/processing/heuristic-processor.js';
import { createStorage } from '../src/storage/storage.js';

test('processing jobs are idempotent per observation and provenance, with claim/complete/fail/retry lifecycle', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-'));
  const fixture = seedProcessingFixture(dataDir);
  const { storage, run } = fixture;

  const enqueueResult = storage.enqueueProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(enqueueResult.counts.created, 2);
  assert.equal(enqueueResult.counts.existing, 0);
  assert.equal(enqueueResult.counts.skipped_missing_post_url, 1);

  const enqueueAgain = storage.enqueueProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(enqueueAgain.counts.created, 0);
  assert.equal(enqueueAgain.counts.existing, 2);

  const claimed = storage.claimProcessingJobs({
    runId: run.id,
    claimedBy: 'worker-1',
    limit: 2,
    includeObservationPayload: true,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(claimed.length, 2);
  assert.equal(claimed.every((job) => job.status === 'processing'), true);
  assert.equal(claimed.every((job) => job.attemptCount === 1), true);

  const firstCompleted = storage.completeProcessingJob({
    jobId: claimed[0].id,
    claimedBy: 'worker-1',
    payload: processObservationWithHeuristics(toObservationInput(claimed[0]), {
      processorVersion: DEFAULT_PROCESSOR_VERSION,
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      modelName: DEFAULT_MODEL_NAME,
    }),
    includeProcessedPayload: true,
  });

  assert.equal(firstCompleted.status, 'processed');
  assert.ok(firstCompleted.processedPayloadId);
  assert.ok(firstCompleted.processedPayload);
  assert.equal(firstCompleted.processedPayload.observation.postUrl, firstCompleted.postUrl);

  const failed = storage.failProcessingJob({
    jobId: claimed[1].id,
    claimedBy: 'worker-1',
    errorMessage: 'temporary processing failure',
    retryDelayMs: 0,
  });

  assert.equal(failed.status, 'retryable');
  assert.equal(failed.lastError, 'temporary processing failure');

  const retried = storage.retryProcessingJobs({
    jobId: claimed[1].id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(retried.length, 1);
  assert.equal(retried[0].status, 'pending');
  assert.equal(retried[0].attemptCount, 0);

  const reclaimed = storage.claimProcessingJobs({
    observationId: claimed[1].observationId,
    claimedBy: 'worker-2',
    limit: 1,
    includeObservationPayload: true,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].status, 'processing');

  storage.completeProcessingJob({
    jobId: reclaimed[0].id,
    claimedBy: 'worker-2',
    payload: processObservationWithHeuristics(toObservationInput(reclaimed[0]), {
      processorVersion: DEFAULT_PROCESSOR_VERSION,
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      modelName: DEFAULT_MODEL_NAME,
    }),
  });

  const jobs = storage.listProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
    includeProcessedPayload: true,
    limit: 10,
  });

  storage.close();

  assert.equal(jobs.length, 2);
  assert.equal(jobs.every((job) => job.status === 'processed'), true);
  assert.equal(jobs.every((job) => job.processedListingCount >= 1), true);

  const db = new DatabaseSync(path.join(dataDir, 'storage', 'nyc-housing-scout.sqlite'));
  const counts = {
    jobs: db.prepare('SELECT COUNT(*) AS count FROM processing_jobs').get().count,
    payloads: db.prepare('SELECT COUNT(*) AS count FROM processed_payloads').get().count,
  };
  db.close();

  assert.equal(counts.jobs, 2);
  assert.equal(counts.payloads, 2);
});

test('processing CLIs enqueue, process, inspect, and retry jobs', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-cli-'));
  const fixture = seedProcessingFixture(dataDir);
  fixture.storage.close();

  const enqueueResult = runCli('src/cli/enqueue-processing.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
  ]);
  assert.equal(enqueueResult.command, 'enqueue:processing');
  assert.equal(enqueueResult.counts.created, 2);
  assert.equal(enqueueResult.counts.skipped_missing_post_url, 1);

  const processResult = runCli('src/cli/process-jobs.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--limit',
    '2',
  ]);
  assert.equal(processResult.command, 'process:jobs');
  assert.equal(processResult.claimedCount, 2);
  assert.equal(processResult.processedCount, 2);

  const inspectResult = runCli('src/cli/inspect-jobs.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--status',
    'processed',
    '--limit',
    '10',
  ]);
  assert.equal(inspectResult.command, 'inspect:jobs');
  assert.equal(inspectResult.count, 2);
  assert.equal(inspectResult.results.every((job) => job.status === 'processed'), true);

  let storage = createStorage({ dataDir });
  const requeueScope = storage.enqueueProcessingJobs({
    observationId: fixture.firstObservationId,
    processorVersion: 'heuristic-text-v2',
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });
  const targetJobId = requeueScope.results.find((entry) => entry.action === 'created').job.id;
  const [claimed] = storage.claimProcessingJobs({
    observationId: fixture.firstObservationId,
    claimedBy: 'retry-worker',
    limit: 1,
    processorVersion: 'heuristic-text-v2',
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });
  storage.failProcessingJob({
    jobId: claimed.id,
    claimedBy: 'retry-worker',
    errorMessage: 'force retry from cli test',
    retryable: false,
  });
  storage.close();

  const retryResult = runCli('src/cli/retry-jobs.js', [
    '--data-dir',
    dataDir,
    '--job-id',
    targetJobId,
    '--processor-version',
    'heuristic-text-v2',
  ]);
  assert.equal(retryResult.command, 'retry:jobs');
  assert.equal(retryResult.count, 1);
  assert.equal(retryResult.results[0].status, 'pending');
  assert.equal(retryResult.results[0].attemptCount, 0);
});

function seedProcessingFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'processing-group',
    sourceType: 'group',
    displayName: 'Processing Group',
  });
  const run = storage.beginRun({
    runId: '2026-03-13T10-00-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });

  const firstPost = createCollectedPost({
    postId: 'post-001',
    postUrl: 'https://www.facebook.com/groups/test/posts/post-001/',
    author: 'Alex Rivera',
    postedAtText: '1 h',
    bodyText: 'Private room available in Williamsburg for $1,650/month starting April 1.',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-13T10:00:00.000Z',
  });
  const secondPost = createCollectedPost({
    postId: 'post-002',
    postUrl: 'https://www.facebook.com/groups/test/posts/post-002/',
    author: 'Jamie Chen',
    postedAtText: '35 m',
    bodyText: 'Sublet in Greenpoint. $2,200/month for a furnished one bedroom.',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-13T10:05:00.000Z',
  });
  const missingUrlPost = createCollectedPost({
    postId: 'post-003',
    author: 'Missing URL',
    postedAtText: '10 m',
    bodyText: 'Room in Bushwick for $1,200/month.',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-13T10:10:00.000Z',
  });

  const recorded = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    entries: [
      { post: firstPost },
      { post: secondPost },
      { post: missingUrlPost },
    ],
  });

  return {
    storage,
    source,
    run,
    firstObservationId: recorded[0].observation.id,
  };
}

function toObservationInput(job) {
  return {
    id: job.observationId,
    runId: job.observationRunId,
    sourceId: job.sourceId,
    stablePostId: job.stablePostId,
    platformPostId: job.platformPostId,
    sourceKey: job.sourceKey,
    groupName: job.sourceDisplayName,
    postUrl: job.postUrl,
    authorName: job.authorName,
    postedAtText: job.postedAtText,
    capturedAt: job.capturedAt,
    freshness: job.observationFreshness,
    payload: job.observationPayload,
  };
}

function runCli(relativeCliPath, args) {
  const result = spawnSync('node', [path.resolve(process.cwd(), relativeCliPath), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

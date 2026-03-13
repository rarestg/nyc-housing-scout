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
import { runProcessingBatch } from '../src/processing/run-processing-batch.js';
import { createStorage } from '../src/storage/storage.js';

const HEURISTIC_PROVENANCE = Object.freeze({
  processorVersion: 'heuristic-text-v1',
  schemaVersion: 'processed-payload-v1',
  modelName: 'heuristic:none',
});

test('processing jobs are idempotent per observation and provenance, with claim/complete/fail/retry lifecycle', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-'));
  const fixture = seedProcessingFixture(dataDir);
  const { storage, run } = fixture;

  const enqueueResult = storage.enqueueProcessingJobs({
    runId: run.id,
    ...HEURISTIC_PROVENANCE,
  });

  assert.equal(enqueueResult.counts.created, 2);
  assert.equal(enqueueResult.counts.existing, 0);
  assert.equal(enqueueResult.counts.skipped_missing_post_url, 1);

  const enqueueAgain = storage.enqueueProcessingJobs({
    runId: run.id,
    ...HEURISTIC_PROVENANCE,
  });

  assert.equal(enqueueAgain.counts.created, 0);
  assert.equal(enqueueAgain.counts.existing, 2);

  const claimed = storage.claimProcessingJobs({
    runId: run.id,
    claimedBy: 'worker-1',
    limit: 2,
    includeObservationPayload: true,
    ...HEURISTIC_PROVENANCE,
  });

  assert.equal(claimed.length, 2);
  assert.equal(claimed.every((job) => job.status === 'processing'), true);
  assert.equal(claimed.every((job) => job.attemptCount === 1), true);

  const firstCompleted = storage.completeProcessingJob({
    jobId: claimed[0].id,
    claimedBy: 'worker-1',
    payload: processObservationWithHeuristics(toObservationInput(claimed[0]), {
      ...HEURISTIC_PROVENANCE,
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
    ...HEURISTIC_PROVENANCE,
  });

  assert.equal(retried.length, 1);
  assert.equal(retried[0].status, 'pending');
  assert.equal(retried[0].attemptCount, 0);

  const reclaimed = storage.claimProcessingJobs({
    observationId: claimed[1].observationId,
    claimedBy: 'worker-2',
    limit: 1,
    includeObservationPayload: true,
    ...HEURISTIC_PROVENANCE,
  });

  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].status, 'processing');

  storage.completeProcessingJob({
    jobId: reclaimed[0].id,
    claimedBy: 'worker-2',
    payload: processObservationWithHeuristics(toObservationInput(reclaimed[0]), {
      ...HEURISTIC_PROVENANCE,
    }),
  });

  const jobs = storage.listProcessingJobs({
    runId: run.id,
    ...HEURISTIC_PROVENANCE,
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
    listings: db.prepare('SELECT COUNT(*) AS count FROM listing_records').get().count,
  };
  db.close();

  assert.equal(counts.jobs, 2);
  assert.equal(counts.payloads, 2);
  assert.equal(counts.listings, 2);
});

test('runProcessingBatch processes Gemini jobs and maps them into listing records', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-gemini-'));
  const fixture = seedProcessingFixture(dataDir);
  const { storage, run } = fixture;

  const enqueueResult = storage.enqueueProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(enqueueResult.counts.created, 2);

  const fakeClient = {
    models: {
      async generateContent(request) {
        const postUrlMatch = String(request.contents).match(/https:\/\/www\.facebook\.com\/groups\/test\/posts\/post-\d+\//u);
        const postUrl = postUrlMatch?.[0] || 'https://www.facebook.com/groups/test/posts/post-001/';
        const amount = postUrl.endsWith('post-001/') ? 1650 : 2200;
        const neighborhood = postUrl.endsWith('post-001/') ? 'Williamsburg' : 'Greenpoint';
        const listingType = postUrl.endsWith('post-001/') ? 'room_in_shared' : 'sublet';

        return {
          text: JSON.stringify({
            source: {
              postUrl,
            },
            listings: [
              {
                postIntent: 'offering',
                listingType,
                location: {
                  rawText: neighborhood,
                  address: null,
                  neighborhood,
                  borough: 'Brooklyn',
                  city: 'New York',
                  state: 'NY',
                  lat: null,
                  lng: null,
                  geocodeConfidence: null,
                },
                pricing: {
                  amount,
                  currency: 'USD',
                  period: 'month',
                  deposit: null,
                  brokerFee: null,
                  utilitiesIncluded: null,
                },
                rooms: {
                  roomsAvailable: 1,
                  totalBedrooms: listingType === 'sublet' ? 1 : 3,
                  bathrooms: 1,
                  occupancyNotes: null,
                },
                dates: {
                  availableFrom: null,
                  availableTo: null,
                  leaseTermText: null,
                },
                features: {
                  petsAllowed: null,
                  laundry: null,
                  furnished: listingType === 'sublet',
                  privateBath: null,
                  outdoorSpace: null,
                  doorman: null,
                  elevator: null,
                },
                contact: {
                  contactMethod: 'dm',
                  contactValue: null,
                },
                notes: {
                  summary: `${neighborhood} listing for ${amount}`,
                  rawSignals: [neighborhood, String(amount)],
                  ambiguities: [],
                },
                confidence: {
                  overall: 0.84,
                  fields: {
                    postIntent: 0.9,
                    listingType: 0.88,
                    location: 0.9,
                    borough: 0.95,
                    price: 0.92,
                    rooms: 0.72,
                    dates: 0.3,
                  },
                },
              },
            ],
            overallAmbiguities: [],
          }),
          responseId: `resp_${amount}`,
          modelVersion: 'gemini-3-flash-preview',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 12,
            totalTokenCount: 22,
          },
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        };
      },
    },
  };

  const result = await runProcessingBatch(storage, {
    runId: run.id,
    limit: 2,
    claimedBy: 'gemini-worker',
    apiKey: 'test-key',
    client: fakeClient,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(result.claimedCount, 2);
  assert.equal(result.processedCount, 2);

  const jobs = storage.listProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
    includeProcessedPayload: true,
    limit: 10,
  });
  const listings = storage.listListings({
    runId: run.id,
    includePayload: true,
    limit: 10,
  });

  storage.close();

  assert.equal(jobs.length, 2);
  assert.equal(jobs.every((job) => job.status === 'processed'), true);
  assert.equal(jobs[0].processedPayload.extracted.structuredData.source.postUrl, jobs[0].postUrl);
  assert.equal(jobs.every((job) => job.processedPayload.extracted.listings.length === 1), true);
  assert.equal(listings.length, 2);
  assert.equal(listings.every((listing) => listing.extractorVersion === `${DEFAULT_PROCESSOR_VERSION}|${DEFAULT_SCHEMA_VERSION}|${DEFAULT_MODEL_NAME}`), true);
});

test('runProcessingBatch claims sequentially, times out stuck Gemini calls, and records batch metrics', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-timeout-'));
  const fixture = seedProcessingFixture(dataDir);
  const { storage, run } = fixture;

  storage.enqueueProcessingJobs({
    runId: run.id,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  const originalClaimProcessingJobs = storage.claimProcessingJobs.bind(storage);
  const claimLimits = [];
  storage.claimProcessingJobs = (input = {}) => {
    claimLimits.push(Number(input.limit));
    return originalClaimProcessingJobs(input);
  };

  let callCount = 0;
  const fakeClient = {
    models: {
      async generateContent(request) {
        callCount += 1;

        if (callCount === 1) {
          await new Promise((resolve, reject) => {
            request.config.abortSignal.addEventListener('abort', () => {
              reject(request.config.abortSignal.reason || new Error('aborted'));
            }, { once: true });
          });
        }

        return {
          text: JSON.stringify({
            source: {
              postUrl: 'https://www.facebook.com/groups/test/posts/post-002/',
            },
            listings: [
              {
                postIntent: 'offering',
                listingType: 'sublet',
                location: {
                  rawText: 'Greenpoint',
                  address: null,
                  neighborhood: 'Greenpoint',
                  borough: 'Brooklyn',
                  city: 'New York',
                  state: 'NY',
                  lat: null,
                  lng: null,
                  geocodeConfidence: null,
                },
                pricing: {
                  amount: 2200,
                  currency: 'USD',
                  period: 'month',
                  deposit: null,
                  brokerFee: null,
                  utilitiesIncluded: null,
                },
                rooms: {
                  roomsAvailable: 1,
                  totalBedrooms: 1,
                  bathrooms: 1,
                  occupancyNotes: null,
                },
                dates: {
                  availableFrom: null,
                  availableTo: null,
                  leaseTermText: null,
                },
                features: {
                  petsAllowed: null,
                  laundry: null,
                  furnished: true,
                  privateBath: null,
                  outdoorSpace: null,
                  doorman: null,
                  elevator: null,
                },
                contact: {
                  contactMethod: 'dm',
                  contactValue: null,
                },
                notes: {
                  summary: 'Greenpoint sublet for 2200',
                  rawSignals: ['Greenpoint', '2200'],
                  ambiguities: [],
                },
                confidence: {
                  overall: 0.82,
                  fields: {
                    postIntent: 0.9,
                    listingType: 0.88,
                    location: 0.9,
                    borough: 0.95,
                    price: 0.9,
                    rooms: 0.75,
                    dates: 0.2,
                  },
                },
              },
            ],
            overallAmbiguities: [],
          }),
          responseId: 'resp_2200',
          modelVersion: 'gemini-3-flash-preview',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 12,
            totalTokenCount: 22,
          },
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        };
      },
    },
  };

  const result = await runProcessingBatch(storage, {
    runId: run.id,
    limit: 2,
    leaseMs: 200,
    requestTimeoutMs: 180,
    claimedBy: 'gemini-timeout-worker',
    retryDelayMs: 0,
    apiKey: 'test-key',
    client: fakeClient,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
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

  assert.deepEqual(claimLimits, [1, 1]);
  assert.equal(result.claimedCount, 2);
  assert.equal(result.processedCount, 1);
  assert.equal(result.retryableCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.metrics.claimedSequentially, true);
  assert.equal(result.metrics.timeoutCount, 1);
  assert.equal(result.metrics.retryCount, 0);
  assert.equal(result.metrics.tokenUsage.totalTokenCount, 22);
  assert.equal(result.metrics.outcomes.processed, 1);
  assert.equal(result.metrics.outcomes.retryable, 1);
  assert.equal(result.metrics.outcomes.failed, 0);
  assert.equal(result.results[0].timedOut, true);
  assert.equal(result.results[1].status, 'processed');
  assert.equal(result.results[1].tokenUsage.totalTokenCount, 22);

  const retryableJob = jobs.find((job) => job.status === 'retryable');
  const processedJob = jobs.find((job) => job.status === 'processed');
  assert.ok(retryableJob);
  assert.ok(processedJob);
  assert.equal(processedJob.processedPayload.processing.retryCount, 0);
  assert.equal(processedJob.processedPayload.gemini.requestTimeoutMs, 150);
});

test('runProcessingBatch does not reclaim the same retryable job within one invocation', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-processing-same-batch-'));
  const fixture = seedProcessingFixture(dataDir);
  const { storage, firstObservationId } = fixture;

  const enqueueResult = storage.enqueueProcessingJobs({
    observationId: firstObservationId,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  assert.equal(enqueueResult.counts.created, 1);

  let callCount = 0;
  const fakeClient = {
    models: {
      async generateContent(request) {
        callCount += 1;

        await new Promise((resolve, reject) => {
          request.config.abortSignal.addEventListener('abort', () => {
            reject(request.config.abortSignal.reason || new Error('aborted'));
          }, { once: true });
        });
      },
    },
  };

  const result = await runProcessingBatch(storage, {
    observationId: firstObservationId,
    limit: 3,
    requestTimeoutMs: 50,
    claimedBy: 'gemini-same-batch-worker',
    retryDelayMs: 0,
    apiKey: 'test-key',
    client: fakeClient,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
  });

  const [job] = storage.listProcessingJobs({
    observationId: firstObservationId,
    processorVersion: DEFAULT_PROCESSOR_VERSION,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    modelName: DEFAULT_MODEL_NAME,
    limit: 1,
  });

  storage.close();

  assert.equal(callCount, 1);
  assert.equal(result.claimedCount, 1);
  assert.equal(result.processedCount, 0);
  assert.equal(result.retryableCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'retryable');
  assert.equal(result.results[0].timedOut, true);
  assert.equal(result.metrics.timeoutCount, 1);
  assert.equal(result.metrics.outcomes.retryable, 1);
  assert.equal(job.status, 'retryable');
  assert.equal(job.attemptCount, 1);
  assert.equal(job.lastError, 'Gemini request timed out after 50ms');
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
    '--processor-version',
    HEURISTIC_PROVENANCE.processorVersion,
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
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
    '--processor-version',
    HEURISTIC_PROVENANCE.processorVersion,
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
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
    '--processor-version',
    HEURISTIC_PROVENANCE.processorVersion,
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
  ]);
  assert.equal(inspectResult.command, 'inspect:jobs');
  assert.equal(inspectResult.count, 2);
  assert.equal(inspectResult.results.every((job) => job.status === 'processed'), true);

  let storage = createStorage({ dataDir });
  const requeueScope = storage.enqueueProcessingJobs({
    observationId: fixture.firstObservationId,
    processorVersion: 'heuristic-text-v2',
    schemaVersion: HEURISTIC_PROVENANCE.schemaVersion,
    modelName: HEURISTIC_PROVENANCE.modelName,
  });
  const targetJobId = requeueScope.results.find((entry) => entry.action === 'created').job.id;
  const [claimed] = storage.claimProcessingJobs({
    observationId: fixture.firstObservationId,
    claimedBy: 'retry-worker',
    limit: 1,
    processorVersion: 'heuristic-text-v2',
    schemaVersion: HEURISTIC_PROVENANCE.schemaVersion,
    modelName: HEURISTIC_PROVENANCE.modelName,
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
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
  ]);
  assert.equal(retryResult.command, 'retry:jobs');
  assert.equal(retryResult.count, 1);
  assert.equal(retryResult.results[0].status, 'pending');
  assert.equal(retryResult.results[0].attemptCount, 0);
});

test('validate queue CLI reports coverage, exclusions, and representative processed payloads', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-queue-validation-'));
  const fixture = seedProcessingFixture(dataDir);
  fixture.storage.close();

  const firstRun = runCli('src/cli/validate-queue.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--sample-limit',
    '2',
    '--processor-version',
    HEURISTIC_PROVENANCE.processorVersion,
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
  ]);

  assert.equal(firstRun.command, 'validate:queue');
  assert.equal(firstRun.before.observations.totalObservations, 3);
  assert.equal(firstRun.before.observations.eligibleObservations, 2);
  assert.equal(firstRun.before.observations.excludedMissingPostUrl, 1);
  assert.equal(firstRun.before.jobs.totalJobs, 0);
  assert.equal(firstRun.enqueue.counts.created, 2);
  assert.equal(firstRun.enqueue.counts.existing, 0);
  assert.equal(firstRun.enqueue.counts.skipped_missing_post_url, 1);
  assert.equal(firstRun.processing.claimedCount, 2);
  assert.equal(firstRun.processing.processedCount, 2);
  assert.equal(firstRun.after.coverage.eligibleWithJobs, 2);
  assert.equal(firstRun.after.coverage.eligibleWithoutJobs, 0);
  assert.equal(firstRun.after.jobs.processed, 2);
  assert.equal(firstRun.after.jobs.retryable, 0);
  assert.equal(firstRun.after.jobs.failed, 0);
  assert.equal(firstRun.samples.excludedMissingPostUrl.length, 1);
  assert.equal(firstRun.samples.processedPayloads.length, 2);
  assert.equal(
    firstRun.samples.processedPayloads.every((sample) => sample.processedPayload?.observation?.postUrl),
    true,
  );

  const secondRun = runCli('src/cli/validate-queue.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--sample-limit',
    '2',
    '--processor-version',
    HEURISTIC_PROVENANCE.processorVersion,
    '--schema-version',
    HEURISTIC_PROVENANCE.schemaVersion,
    '--model-name',
    HEURISTIC_PROVENANCE.modelName,
  ]);

  assert.equal(secondRun.enqueue.counts.created, 0);
  assert.equal(secondRun.enqueue.counts.existing, 2);
  assert.equal(secondRun.enqueue.counts.skipped_missing_post_url, 1);
  assert.equal(secondRun.processing.claimedCount, 0);
  assert.equal(secondRun.processing.processedCount, 0);
  assert.equal(secondRun.after.jobs.processed, 2);
  assert.equal(secondRun.samples.processedPayloads.length, 2);
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

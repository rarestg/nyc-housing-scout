import { runProcessingBatch } from '../processing/run-processing-batch.js';
import { createStorage } from '../storage/storage.js';
import {
  compactObject,
  hasFlag,
  hasQueueScope,
  printJson,
  readDataDir,
  readFlag,
  readProcessingProvenanceFlags,
  readQueueDefaults,
} from './processing-cli-helpers.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

if (!hasQueueScope(args)) {
  printUsage(1, 'validate:queue requires --run-id, --source-key, or --observation-id');
}

const full = hasFlag(args, '--full');
const dataDir = readDataDir(args);
const provenance = readProcessingProvenanceFlags(args);
const queueDefaults = readQueueDefaults(args);
const retryDelayMs = readFlag(args, '--retry-delay-ms', '0');
const sampleLimit = readNonNegativeIntegerFlag(args, '--sample-limit', 2, 10);
const workerId = readFlag(
  args,
  '--worker-id',
  `queue-validator-${process.pid}-${Date.now()}`,
);
const storage = createStorage({ dataDir });

try {
  const scopeFilters = compactObject({
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    freshness: readFlag(args, '--freshness', undefined),
  });

  const before = storage.summarizeProcessingQueueCoverage({
    ...scopeFilters,
    ...provenance,
    sampleLimit,
  });
  const enqueueLimit = readNonNegativeIntegerFlag(
    args,
    '--enqueue-limit',
    Math.max(before.observations.totalObservations, 1),
    500,
  );

  const enqueue = storage.enqueueProcessingJobs({
    ...scopeFilters,
    limit: enqueueLimit,
    maxAttempts: queueDefaults.maxAttempts,
    ...provenance,
  });

  const afterEnqueue = storage.summarizeProcessingQueueCoverage({
    ...scopeFilters,
    ...provenance,
    sampleLimit,
  });
  const defaultProcessLimit = afterEnqueue.jobs.pending + afterEnqueue.jobs.retryable;
  const processLimit = readNonNegativeIntegerFlag(
    args,
    '--process-limit',
    defaultProcessLimit,
    500,
  );
  const processing = processLimit > 0
    ? runProcessingBatch(storage, {
        ...scopeFilters,
        limit: processLimit,
        leaseMs: queueDefaults.leaseMs,
        claimedBy: workerId,
        retryDelayMs,
        ...provenance,
      })
    : emptyProcessingResult();

  const after = storage.summarizeProcessingQueueCoverage({
    ...scopeFilters,
    ...provenance,
    sampleLimit,
  });
  const processedPayloadSamples = selectRepresentativeProcessedPayloads(storage, {
    ...scopeFilters,
    ...provenance,
    sampleLimit,
  });
  const scopeRun = scopeFilters.runId
    ? storage.listRecentRuns({ runId: scopeFilters.runId, limit: 1 })[0] || null
    : null;

  printJson({
    command: 'validate:queue',
    filters: scopeFilters,
    provenance,
    run: scopeRun,
    before,
    enqueue: {
      requestedLimit: enqueueLimit,
      counts: enqueue.counts,
      ...(full ? { results: enqueue.results } : {}),
    },
    processing: {
      workerId,
      requestedLimit: processLimit,
      claimedCount: processing.claimedCount,
      processedCount: processing.processedCount,
      retryableCount: processing.retryableCount,
      failedCount: processing.failedCount,
      ...(full ? { results: processing.results } : {}),
    },
    after,
    samples: {
      excludedMissingPostUrl: after.missingPostUrlSamples,
      processedPayloads: processedPayloadSamples,
    },
  });
} finally {
  storage.close?.();
}

function selectRepresentativeProcessedPayloads(storage, input) {
  const sampleLimit = Math.max(0, Number(input.sampleLimit || 0));
  if (!sampleLimit) {
    return [];
  }

  const candidates = storage.listProcessingJobs({
    runId: input.runId,
    sourceKey: input.sourceKey,
    observationId: input.observationId,
    freshness: input.freshness,
    status: 'processed',
    limit: Math.max(sampleLimit * 5, 10),
    processorVersion: input.processorVersion,
    schemaVersion: input.schemaVersion,
    modelName: input.modelName,
    includeProcessedPayload: true,
  });
  const preferred = candidates.filter((job) => (job.processedListingCount || 0) > 0);
  const ordered = [
    ...preferred,
    ...candidates.filter((job) => (job.processedListingCount || 0) <= 0),
  ];

  return ordered.slice(0, sampleLimit).map((job) => ({
    jobId: job.id,
    observationId: job.observationId,
    sourceKey: job.sourceKey,
    postUrl: job.postUrl,
    authorName: job.authorName,
    postedAtText: job.postedAtText,
    capturedAt: job.capturedAt,
    processedAt: job.processedAt,
    processedListingCount: job.processedListingCount,
    processedPayload: job.processedPayload || null,
  }));
}

function emptyProcessingResult() {
  return {
    claimed: [],
    results: [],
    claimedCount: 0,
    processedCount: 0,
    retryableCount: 0,
    failedCount: 0,
  };
}

function readNonNegativeIntegerFlag(argv, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const raw = readFlag(argv, name, undefined);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function hasHelpFlag(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run validate:queue -- --run-id <runId> [--sample-limit 2]
  npm run validate:queue -- --source-key <key> [--process-limit 25]
  npm run validate:queue -- --observation-id <obsId>

Options:
  --freshness <value>          Optional observation freshness filter for enqueue coverage.
  --enqueue-limit <n>         Override how many scoped observations are considered for enqueue.
  --process-limit <n>         Override how many pending/retryable jobs are processed in this run.
  --sample-limit <n>          Representative excluded/processed samples to include. Defaults to 2.
  --processor-version <value> Defaults to heuristic-text-v1
  --schema-version <value>    Defaults to processed-payload-v1
  --model-name <value>        Defaults to heuristic:none
  --max-attempts <n>          Defaults to 3
  --lease-ms <n>              Defaults to 300000
  --retry-delay-ms <n>        Defaults to 0
  --worker-id <value>         Override the generated validator worker id.
  --full                      Include full enqueue/process result arrays.
  --data-dir <path>           Override the default ./data directory.`);

  process.exit(exitCode);
}

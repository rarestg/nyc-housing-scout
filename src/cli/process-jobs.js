import { processObservationWithHeuristics } from '../processing/heuristic-processor.js';
import { createStorage } from '../storage/storage.js';
import {
  compactObject,
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

const dataDir = readDataDir(args);
const provenance = readProcessingProvenanceFlags(args);
const queueDefaults = readQueueDefaults(args);
const retryDelayMs = readFlag(args, '--retry-delay-ms', '0');
const workerId = readFlag(
  args,
  '--worker-id',
  `local-worker-${process.pid}-${Date.now()}`,
);
const storage = createStorage({ dataDir });

try {
  const claimed = storage.claimProcessingJobs({
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    limit: readFlag(args, '--limit', '10'),
    leaseMs: queueDefaults.leaseMs,
    claimedBy: workerId,
    includeObservationPayload: true,
    ...provenance,
  });

  const results = [];

  for (const job of claimed) {
    try {
      const payload = processObservationWithHeuristics(toObservationInput(job), provenance);
      const completed = storage.completeProcessingJob({
        jobId: job.id,
        claimedBy: workerId,
        payload,
      });

      results.push({
        jobId: completed.id,
        observationId: completed.observationId,
        status: completed.status,
        processedListingCount: payload.extracted.listingCount,
      });
    } catch (error) {
      const failed = storage.failProcessingJob({
        jobId: job.id,
        claimedBy: workerId,
        errorMessage: error instanceof Error ? error.message : String(error),
        retryDelayMs,
      });

      results.push({
        jobId: failed.id,
        observationId: failed.observationId,
        status: failed.status,
        error: failed.lastError,
      });
    }
  }

  printJson({
    command: 'process:jobs',
    workerId,
    filters: compactObject({
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      limit: readFlag(args, '--limit', '10'),
      processorVersion: provenance.processorVersion,
      schemaVersion: provenance.schemaVersion,
      modelName: provenance.modelName,
      leaseMs: queueDefaults.leaseMs,
      retryDelayMs,
    }),
    claimedCount: claimed.length,
    processedCount: results.filter((result) => result.status === 'processed').length,
    retryableCount: results.filter((result) => result.status === 'retryable').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    results,
  });
} finally {
  storage.close?.();
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

function hasHelpFlag(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run process:jobs -- [--source-key key] [--limit 10]
  npm run process:jobs -- --run-id <runId> [--limit 10]

Options:
  --processor-version <value>  Defaults to heuristic-text-v1
  --schema-version <value>     Defaults to processed-payload-v1
  --model-name <value>         Defaults to heuristic:none
  --lease-ms <n>               Claim lease in milliseconds. Defaults to 300000.
  --retry-delay-ms <n>         Delay before retryable jobs become claimable. Defaults to 0.
  --worker-id <value>          Override the generated local worker id.
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}

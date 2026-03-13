import { createStorage } from '../storage/storage.js';
import {
  compactObject,
  printJson,
  readDataDir,
  readFlag,
  readProcessingProvenanceFlags,
} from './processing-cli-helpers.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

const dataDir = readDataDir(args);
const provenance = readProcessingProvenanceFlags(args);
const resetAttempts = !args.includes('--keep-attempts');
const storage = createStorage({ dataDir });

try {
  const retried = storage.retryProcessingJobs({
    jobId: readFlag(args, '--job-id', undefined),
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    freshness: readFlag(args, '--freshness', undefined),
    status: readFlag(args, '--status', undefined),
    limit: readFlag(args, '--limit', '50'),
    resetAttempts,
    ...provenance,
  });

  printJson({
    command: 'retry:jobs',
    filters: compactObject({
      jobId: readFlag(args, '--job-id', undefined),
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      freshness: readFlag(args, '--freshness', undefined),
      status: readFlag(args, '--status', undefined),
      limit: readFlag(args, '--limit', '50'),
      processorVersion: provenance.processorVersion,
      schemaVersion: provenance.schemaVersion,
      modelName: provenance.modelName,
      resetAttempts,
    }),
    count: retried.length,
    results: retried,
  });
} finally {
  storage.close?.();
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
  npm run retry:jobs -- [--source-key key] [--freshness fresh] [--status failed] [--limit 50]
  npm run retry:jobs -- --job-id <jobId>

Options:
  --processor-version <value>  Defaults to heuristic-text-v1
  --schema-version <value>     Defaults to processed-payload-v1
  --model-name <value>         Defaults to heuristic:none
  --keep-attempts              Requeue without resetting attempt counters.
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}

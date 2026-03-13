import { createStorage } from '../storage/storage.js';
import {
  compactObject,
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
  printUsage(1, 'enqueue:processing requires --run-id, --source-key, or --observation-id');
}

const dataDir = readDataDir(args);
const provenance = readProcessingProvenanceFlags(args);
const queueDefaults = readQueueDefaults(args);
const storage = createStorage({ dataDir });

try {
  const result = storage.enqueueProcessingJobs({
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    freshness: readFlag(args, '--freshness', undefined),
    limit: readFlag(args, '--limit', '100'),
    maxAttempts: queueDefaults.maxAttempts,
    ...provenance,
  });

  printJson({
    command: 'enqueue:processing',
    filters: compactObject({
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      freshness: readFlag(args, '--freshness', undefined),
      limit: readFlag(args, '--limit', '100'),
    }),
    provenance: result.provenance,
    counts: result.counts,
    results: result.results,
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
  npm run enqueue:processing -- --run-id <runId> [--freshness fresh] [--limit 100]
  npm run enqueue:processing -- --source-key <key> [--limit 100]
  npm run enqueue:processing -- --observation-id <obsId>

Options:
  --processor-version <value>  Defaults to gemini-structured-v1
  --schema-version <value>     Defaults to gemini-processed-payload-v1
  --model-name <value>         Defaults to gemini-3-flash-preview
  --max-attempts <n>           Defaults to 3
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}

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

const full = args.includes('--full');
const dataDir = readDataDir(args);
const storage = createStorage({ dataDir });

try {
  const provenance = readProcessingProvenanceFlags(args);
  const result = storage.listProcessingJobs({
    jobId: readFlag(args, '--job-id', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    freshness: readFlag(args, '--freshness', undefined),
    status: readFlag(args, '--status', undefined),
    limit: readFlag(args, '--limit', '20'),
    processorVersion: readFlag(args, '--processor-version', provenance.processorVersion),
    schemaVersion: readFlag(args, '--schema-version', provenance.schemaVersion),
    modelName: readFlag(args, '--model-name', provenance.modelName),
    includeObservationPayload: full,
    includeProcessedPayload: full,
  });

  printJson({
    command: 'inspect:jobs',
    filters: compactObject({
      jobId: readFlag(args, '--job-id', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      freshness: readFlag(args, '--freshness', undefined),
      status: readFlag(args, '--status', undefined),
      limit: readFlag(args, '--limit', '20'),
      processorVersion: readFlag(args, '--processor-version', provenance.processorVersion),
      schemaVersion: readFlag(args, '--schema-version', provenance.schemaVersion),
      modelName: readFlag(args, '--model-name', provenance.modelName),
      full,
    }),
    count: result.length,
    results: result,
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
  npm run inspect:jobs -- [--status pending] [--source-key key] [--freshness fresh] [--limit 20]
  npm run inspect:jobs -- --run-id <runId> [--status processed] [--freshness fresh]
  npm run inspect:jobs -- --job-id <jobId> [--full]

Options:
  --processor-version <value>  Defaults to heuristic-text-v1
  --schema-version <value>     Defaults to processed-payload-v1
  --model-name <value>         Defaults to heuristic:none
  --full                       Include observation and processed payload JSON.
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}

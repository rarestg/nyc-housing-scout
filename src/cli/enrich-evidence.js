import { runEvidenceEnrichment } from '../processing/run-evidence-enrichment.js';
import { createStorage } from '../storage/storage.js';
import {
  compactObject,
  hasQueueScope,
  printJson,
  readDataDir,
  readFlag,
} from './processing-cli-helpers.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

if (!hasQueueScope(args)) {
  printUsage(1, 'enrich:evidence requires --run-id, --source-key, or --observation-id');
}

const dataDir = readDataDir(args);
const storage = createStorage({ dataDir });

try {
  const result = runEvidenceEnrichment(storage, {
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    freshness: readFlag(args, '--freshness', undefined),
    limit: readFlag(args, '--limit', '20'),
    scanLimit: readFlag(args, '--scan-limit', undefined),
    producerKind: readFlag(args, '--producer-kind', undefined),
    producerVersion: readFlag(args, '--producer-version', undefined),
  });

  printJson({
    command: 'enrich:evidence',
    filters: compactObject({
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      freshness: readFlag(args, '--freshness', undefined),
      limit: readFlag(args, '--limit', '20'),
      scanLimit: readFlag(args, '--scan-limit', undefined),
      producerKind: readFlag(args, '--producer-kind', undefined),
      producerVersion: readFlag(args, '--producer-version', undefined),
    }),
    result,
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
  npm run enrich:evidence -- --run-id <runId> [--freshness fresh] [--limit 20]
  npm run enrich:evidence -- --source-key <key> [--limit 20] [--scan-limit 100]
  npm run enrich:evidence -- --observation-id <obsId>

Options:
  --scan-limit <n>            Maximum observations to scan before stopping. Defaults to max(limit * 5, 100).
  --producer-kind <value>     Override the evidence producer kind. Defaults to observation_enrichment.
  --producer-version <value>  Override the evidence producer version. Defaults to evidence-enrichment-v1.
  --data-dir <path>           Override the default ./data directory.`);

  process.exit(exitCode);
}

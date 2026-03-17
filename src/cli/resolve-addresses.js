import { runAddressResolution } from '../processing/run-address-resolution.js';
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
  printUsage(1, 'resolve:addresses requires --run-id, --source-key, or --observation-id');
}

const dataDir = readDataDir(args);
const storage = createStorage({ dataDir });

try {
  const result = runAddressResolution(storage, {
    runId: readFlag(args, '--run-id', undefined),
    sourceKey: readFlag(args, '--source-key', undefined),
    observationId: readFlag(args, '--observation-id', undefined),
    limit: readFlag(args, '--limit', '20'),
    scanLimit: readFlag(args, '--scan-limit', undefined),
    resolutionKind: readFlag(args, '--resolution-kind', undefined),
    resolverVersion: readFlag(args, '--resolver-version', undefined),
  });

  printJson({
    command: 'resolve:addresses',
    filters: compactObject({
      runId: readFlag(args, '--run-id', undefined),
      sourceKey: readFlag(args, '--source-key', undefined),
      observationId: readFlag(args, '--observation-id', undefined),
      limit: readFlag(args, '--limit', '20'),
      scanLimit: readFlag(args, '--scan-limit', undefined),
      resolutionKind: readFlag(args, '--resolution-kind', undefined),
      resolverVersion: readFlag(args, '--resolver-version', undefined),
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
  npm run resolve:addresses -- --run-id <runId> [--limit 20]
  npm run resolve:addresses -- --source-key <key> [--limit 20] [--scan-limit 100]
  npm run resolve:addresses -- --observation-id <obsId>

Options:
  --scan-limit <n>             Maximum listings to scan before stopping. Defaults to max(limit * 5, 100).
  --resolution-kind <value>    Override the resolved field kind. Defaults to address_resolution.
  --resolver-version <value>   Override the resolver version. Defaults to nyc-address-resolver-v1.
  --data-dir <path>            Override the default ./data directory.`);

  process.exit(exitCode);
}

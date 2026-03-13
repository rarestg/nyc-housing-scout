import path from 'node:path';
import { createStorage } from '../storage/storage.js';

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage(0);
}

const dataDir = path.resolve(process.cwd(), readFlag(commandArgs, '--data-dir', 'data'));
const storage = createStorage({ dataDir });

try {
  switch (command) {
    case 'sources':
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', '50'),
        platform: readFlag(commandArgs, '--platform', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
      }, storage.listSources({
        limit: readFlag(commandArgs, '--limit', '50'),
        platform: readFlag(commandArgs, '--platform', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
      }));
      break;

    case 'runs':
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', '10'),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        status: readFlag(commandArgs, '--status', undefined),
        runKind: readFlag(commandArgs, '--run-kind', undefined),
      }, storage.listRecentRuns({
        limit: readFlag(commandArgs, '--limit', '10'),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        status: readFlag(commandArgs, '--status', undefined),
        runKind: readFlag(commandArgs, '--run-kind', undefined),
      }));
      break;

    case 'run-steps':
    case 'steps':
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', command === 'steps' ? '50' : '200'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
      }, storage.listRunSteps({
        limit: readFlag(commandArgs, '--limit', command === 'steps' ? '50' : '200'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
      }));
      break;

    case 'observations': {
      const full = hasFlag(commandArgs, '--full');
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        freshness: readFlag(commandArgs, '--freshness', undefined),
        full,
      }, storage.listObservations({
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        freshness: readFlag(commandArgs, '--freshness', undefined),
        includeFullText: full,
        includeCollections: full,
        includePayload: full,
      }));
      break;
    }

    case 'listings': {
      const full = hasFlag(commandArgs, '--full');
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        listingType: readFlag(commandArgs, '--listing-type', undefined),
        full,
      }, storage.listListings({
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        listingType: readFlag(commandArgs, '--listing-type', undefined),
        includePayload: full,
      }));
      break;
    }

    case 'artifacts':
      printCollection(command, {
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        observationId: readFlag(commandArgs, '--observation-id', undefined),
        artifactKind: readFlag(commandArgs, '--artifact-kind', undefined),
      }, storage.listArtifactRefs({
        limit: readFlag(commandArgs, '--limit', '20'),
        runId: readFlag(commandArgs, '--run-id', undefined),
        sourceKey: readFlag(commandArgs, '--source-key', undefined),
        observationId: readFlag(commandArgs, '--observation-id', undefined),
        artifactKind: readFlag(commandArgs, '--artifact-kind', undefined),
      }));
      break;

    case 'validate-run': {
      const runId = requireFlag(commandArgs, '--run-id');
      printJson({
        command,
        runId,
        result: storage.validateRun({ runId }),
      });
      break;
    }

    default:
      printUsage(1, `Unknown inspect-storage command: ${command}`);
  }
} finally {
  storage.close?.();
}

function printCollection(commandName, filters, results) {
  printJson({
    command: commandName,
    filters: compactObject(filters),
    count: results.length,
    results,
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run inspect:storage -- sources [--platform facebook] [--source-key key] [--limit 50]
  npm run inspect:storage -- runs [--source-key key] [--status completed] [--run-kind crawl] [--limit 10]
  npm run inspect:storage -- run-steps --run-id <runId> [--limit 200]
  npm run inspect:storage -- observations [--run-id <runId>] [--source-key key] [--freshness fresh] [--limit 20] [--full]
  npm run inspect:storage -- listings [--run-id <runId>] [--source-key key] [--listing-type room_share] [--limit 20] [--full]
  npm run inspect:storage -- artifacts [--run-id <runId>] [--observation-id <obsId>] [--artifact-kind raw_post_payload] [--limit 20]
  npm run inspect:storage -- validate-run --run-id <runId>

Options:
  --data-dir <path>   Override the default ./data directory for storage lookup.
  --full              Include full text / payload fields for observations and listings.`);

  process.exit(exitCode);
}

function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return argv[index + 1] ?? fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function requireFlag(argv, name) {
  const value = readFlag(argv, name, undefined);
  if (!value) {
    printUsage(1, `Missing required flag: ${name}`);
  }

  return value;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== false),
  );
}

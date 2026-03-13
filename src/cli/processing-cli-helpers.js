import path from 'node:path';
import {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROCESSOR_VERSION,
  DEFAULT_SCHEMA_VERSION,
} from '../processing/config.js';

export function readFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return argv[index + 1] ?? fallback;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function readDataDir(argv) {
  return path.resolve(process.cwd(), readFlag(argv, '--data-dir', 'data'));
}

export function readProcessingProvenanceFlags(argv) {
  return {
    processorVersion: readFlag(argv, '--processor-version', DEFAULT_PROCESSOR_VERSION),
    schemaVersion: readFlag(argv, '--schema-version', DEFAULT_SCHEMA_VERSION),
    modelName: readFlag(argv, '--model-name', DEFAULT_MODEL_NAME),
  };
}

export function readQueueDefaults(argv) {
  return {
    maxAttempts: readFlag(argv, '--max-attempts', String(DEFAULT_MAX_ATTEMPTS)),
    leaseMs: readFlag(argv, '--lease-ms', String(DEFAULT_LEASE_MS)),
  };
}

export function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== false),
  );
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function hasQueueScope(argv) {
  return Boolean(
    readFlag(argv, '--run-id', undefined)
      || readFlag(argv, '--source-key', undefined)
      || readFlag(argv, '--observation-id', undefined),
  );
}

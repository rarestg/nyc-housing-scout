export const DEFAULT_PROCESSOR_VERSION = 'heuristic-text-v1';
export const DEFAULT_SCHEMA_VERSION = 'processed-payload-v1';
export const DEFAULT_MODEL_NAME = 'heuristic:none';
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export const PROCESSING_JOB_STATUSES = Object.freeze([
  'pending',
  'processing',
  'processed',
  'retryable',
  'failed',
]);

export function buildProcessingDedupeKey(input) {
  return [
    input.observationId,
    input.processorVersion,
    input.schemaVersion,
    input.modelName,
  ].join('|');
}

export function resolveProcessingProvenance(input = {}) {
  return {
    processorVersion: String(input.processorVersion || DEFAULT_PROCESSOR_VERSION).trim(),
    schemaVersion: String(input.schemaVersion || DEFAULT_SCHEMA_VERSION).trim(),
    modelName: String(input.modelName || DEFAULT_MODEL_NAME).trim(),
  };
}

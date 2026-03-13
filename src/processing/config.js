import {
  DEFAULT_GEMINI_MODEL_NAME,
  DEFAULT_GEMINI_PROCESSOR_VERSION,
  DEFAULT_GEMINI_SCHEMA_VERSION,
} from './gemini/config.js';

export const DEFAULT_PROCESSOR_VERSION = DEFAULT_GEMINI_PROCESSOR_VERSION;
export const DEFAULT_SCHEMA_VERSION = DEFAULT_GEMINI_SCHEMA_VERSION;
export const DEFAULT_MODEL_NAME = DEFAULT_GEMINI_MODEL_NAME;
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

export function isGeminiProcessingProvenance(input = {}) {
  const provenance = resolveProcessingProvenance(input);

  return provenance.processorVersion.startsWith('gemini-')
    || provenance.modelName.includes('gemini');
}

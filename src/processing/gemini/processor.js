import {
  DEFAULT_GEMINI_ENV_FILE_CANDIDATES,
  DEFAULT_GEMINI_LEASE_GUARD_MS,
  DEFAULT_GEMINI_MODEL_NAME,
  DEFAULT_GEMINI_PROCESSOR_VERSION,
  DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
  DEFAULT_GEMINI_SCHEMA_VERSION,
  DEFAULT_GEMINI_TEMPERATURE,
  DEFAULT_GEMINI_THINKING_LEVEL,
  MIN_GEMINI_REQUEST_TIMEOUT_MS,
} from './config.js';
import {
  GEMINI_CANONICAL_SCHEMA_SOURCE,
  GEMINI_STRUCTURED_OUTPUT_SCHEMA,
  normalizeGeminiStructuredData,
} from './canonical-schema.js';
import {
  findGeminiEnvFile,
  loadEnvFile,
  resolveGeminiApiKey,
  runGeminiStructuredExtraction,
} from './structured-output-experiment.js';

export async function processObservationWithGemini(observation, options = {}) {
  const runtime = resolveGeminiRuntime(options);
  const requestTimeoutMs = resolveGeminiRequestTimeoutMs(options);

  return runGeminiStructuredExtraction({
    apiKey: runtime.apiKey,
    client: options.client,
    modelName: options.modelName || DEFAULT_GEMINI_MODEL_NAME,
    processorVersion: options.processorVersion || DEFAULT_GEMINI_PROCESSOR_VERSION,
    schemaVersion: options.schemaVersion || DEFAULT_GEMINI_SCHEMA_VERSION,
    temperature: options.temperature ?? DEFAULT_GEMINI_TEMPERATURE,
    thinkingLevel: options.thinkingLevel || DEFAULT_GEMINI_THINKING_LEVEL,
    inputPost: observation,
    inputSource: {
      kind: 'processing-job',
      observationId: observation?.id || null,
      runId: observation?.runId || null,
    },
    outputSchema: options.outputSchema || GEMINI_STRUCTURED_OUTPUT_SCHEMA,
    schemaSource: options.schemaSource || GEMINI_CANONICAL_SCHEMA_SOURCE,
    normalizeStructuredData: options.normalizeStructuredData || normalizeGeminiStructuredData,
    abortSignal: options.abortSignal,
    requestTimeoutMs,
  });
}

export function resolveGeminiRuntime(options = {}) {
  if (options.apiKey) {
    return {
      apiKey: String(options.apiKey).trim(),
      envFile: null,
      envVar: null,
    };
  }

  if (options.targetEnv) {
    const resolved = resolveGeminiApiKey(options.targetEnv);
    if (resolved.apiKey) {
      return {
        apiKey: resolved.apiKey,
        envFile: null,
        envVar: resolved.envVar,
      };
    }
  }

  const envFilePath = resolveGeminiEnvFile(options.envFile, options.cwd);
  let loadedEnvFile = null;
  if (envFilePath) {
    loadedEnvFile = loadEnvFile(envFilePath, options.targetEnv || process.env).path;
  }

  const resolved = resolveGeminiApiKey(options.targetEnv || process.env);
  if (!resolved.apiKey) {
    throw new Error(
      'Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY, pass --env-file <path>, or create data/cache/gemini/gemini.env.',
    );
  }

  return {
    apiKey: resolved.apiKey,
    envFile: loadedEnvFile,
    envVar: resolved.envVar,
  };
}

function resolveGeminiEnvFile(explicitEnvFile, cwd = process.cwd()) {
  if (explicitEnvFile) {
    return explicitEnvFile;
  }

  return findGeminiEnvFile(DEFAULT_GEMINI_ENV_FILE_CANDIDATES, cwd);
}

export function resolveGeminiRequestTimeoutMs(options = {}) {
  const requestedTimeoutMs = normalizePositiveInteger(
    options.requestTimeoutMs,
    DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
    24 * 60 * 60 * 1000,
  );
  const leaseMs = normalizePositiveInteger(options.leaseMs, null, 24 * 60 * 60 * 1000);

  if (!leaseMs) {
    return requestedTimeoutMs;
  }

  const guardMs = Math.min(
    DEFAULT_GEMINI_LEASE_GUARD_MS,
    Math.max(MIN_GEMINI_REQUEST_TIMEOUT_MS, Math.floor(leaseMs / 10)),
  );
  const maxAllowedTimeoutMs = Math.max(
    MIN_GEMINI_REQUEST_TIMEOUT_MS,
    leaseMs - guardMs,
  );

  return Math.min(requestedTimeoutMs, maxAllowedTimeoutMs);
}

function normalizePositiveInteger(value, fallback, max) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import {
  DEFAULT_GEMINI_ENV_FILE_CANDIDATES,
  DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME,
  DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL,
  DEFAULT_GEMINI_MODEL_NAME,
  DEFAULT_GEMINI_PROCESSOR_VERSION,
  DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
  DEFAULT_GEMINI_SCHEMA_VERSION,
  DEFAULT_GEMINI_THINKING_LEVEL,
  GEMINI_API_KEY_ENV_VARS,
  MIN_GEMINI_REQUEST_TIMEOUT_MS,
} from './config.js';

export {
  DEFAULT_GEMINI_ENV_FILE_CANDIDATES,
  DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME,
  DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL,
  DEFAULT_GEMINI_MODEL_NAME,
  DEFAULT_GEMINI_PROCESSOR_VERSION,
  DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
  DEFAULT_GEMINI_SCHEMA_VERSION,
  DEFAULT_GEMINI_THINKING_LEVEL,
  GEMINI_API_KEY_ENV_VARS,
  MIN_GEMINI_REQUEST_TIMEOUT_MS,
};

export class GeminiRequestTimeoutError extends Error {
  constructor(timeoutMs, cause) {
    super(`Gemini request timed out after ${timeoutMs}ms`);
    this.name = 'GeminiRequestTimeoutError';
    this.code = 'GEMINI_REQUEST_TIMEOUT';
    this.timeoutMs = timeoutMs;
    this.cause = cause;
  }
}

export class GeminiRequestCancelledError extends Error {
  constructor(cause) {
    super('Gemini request was cancelled');
    this.name = 'GeminiRequestCancelledError';
    this.code = 'GEMINI_REQUEST_CANCELLED';
    this.cause = cause;
  }
}

export function parseEnvFile(source) {
  const parsed = {};
  const lines = String(source || '').split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = normalized.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    let value = normalized.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

export function loadEnvFile(filePath, targetEnv = process.env) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const parsed = parseEnvFile(fs.readFileSync(resolvedPath, 'utf8'));

  for (const [key, value] of Object.entries(parsed)) {
    if (targetEnv[key] === undefined) {
      targetEnv[key] = value;
    }
  }

  return {
    path: resolvedPath,
    loadedKeys: Object.keys(parsed),
  };
}

export function findGeminiEnvFile(
  candidates = DEFAULT_GEMINI_ENV_FILE_CANDIDATES,
  cwd = process.cwd(),
) {
  for (const candidate of candidates) {
    const resolvedPath = path.resolve(cwd, candidate);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

export function resolveGeminiApiKey(env = process.env) {
  for (const key of GEMINI_API_KEY_ENV_VARS) {
    const value = String(env[key] || '').trim();
    if (value) {
      return {
        envVar: key,
        apiKey: value,
      };
    }
  }

  return {
    envVar: null,
    apiKey: '',
  };
}

export async function runGeminiApiKeyCheck(options) {
  const apiKey = normalizeString(options.apiKey);
  const modelName = normalizeString(
    options.modelName || DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME,
  );
  const thinkingLevel = normalizeString(
    options.thinkingLevel || DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL,
  );

  if (!apiKey) {
    throw new Error('Gemini API key check requires an API key');
  }

  if (!modelName) {
    throw new Error('Gemini API key check requires modelName');
  }

  if (!thinkingLevel) {
    throw new Error('Gemini API key check requires thinkingLevel');
  }

  const client = options.client || new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: modelName,
    contents: 'Say hi in one short sentence.',
    config: {
      temperature: 0,
      thinkingConfig: {
        thinkingLevel,
      },
    },
  });

  return {
    ok: true,
    modelName,
    thinkingLevel,
    text: normalizeNullableString(response.text),
    responseId: normalizeNullableString(response.responseId),
    modelVersion: normalizeNullableString(response.modelVersion),
    finishReason: normalizeNullableString(response.candidates?.[0]?.finishReason),
    usageMetadata: response.usageMetadata || null,
  };
}

export function normalizeGeminiInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Gemini structured extraction requires a JSON object input');
  }

  const payload = isPlainObject(input.payload) ? input.payload : {};
  const comments = normalizeArray(payload.comments ?? input.comments);
  const media = normalizeArray(payload.media ?? input.media);
  const captureHints = isPlainObject(payload.captureHints)
    ? payload.captureHints
    : isPlainObject(input.captureHints)
      ? input.captureHints
      : {};
  const derivedLocation = isPlainObject(payload.derivedLocation)
    ? payload.derivedLocation
    : isPlainObject(input.derivedLocation)
      ? input.derivedLocation
      : null;

  const post = {
    sourceKey: normalizeNullableString(payload.sourceKey ?? input.sourceKey),
    groupName: normalizeNullableString(payload.groupName ?? input.groupName),
    postId: normalizeNullableString(payload.postId ?? input.postId ?? input.platformPostId),
    postUrl: normalizeNullableString(payload.postUrl ?? input.postUrl),
    authorName: normalizeNullableString(payload.authorName ?? input.authorName),
    postedAtText: normalizeNullableString(payload.postedAtText ?? input.postedAtText),
    bodyText: normalizeString(payload.bodyText ?? input.bodyText),
    comments,
    media,
    captureMethod: normalizeNullableString(payload.captureMethod ?? input.captureMethod),
    captureRunId: normalizeNullableString(payload.captureRunId ?? input.captureRunId ?? input.runId),
    capturedAt: normalizeNullableString(payload.capturedAt ?? input.capturedAt),
    rawArtifactPath: normalizeNullableString(payload.rawArtifactPath ?? input.rawArtifactPath),
    captureHints,
    derivedLocation,
  };

  if (!post.postUrl) {
    throw new Error('Gemini structured extraction requires postUrl in the input');
  }

  return {
    observation: {
      id: normalizeNullableString(input.id),
      runId: normalizeNullableString(input.runId ?? input.captureRunId ?? post.captureRunId),
      sourceId: normalizeNullableString(input.sourceId),
      stablePostId: normalizeNullableString(input.stablePostId),
      platformPostId: normalizeNullableString(input.platformPostId ?? post.postId),
      sourceKey: post.sourceKey,
      groupName: post.groupName,
      authorName: post.authorName,
      postedAtText: post.postedAtText,
      capturedAt: post.capturedAt,
      freshness: normalizeNullableString(input.freshness),
      postUrl: post.postUrl,
    },
    post,
  };
}

export function buildGeminiStructuredPrompt(normalizedInput) {
  const promptInput = {
    observation: normalizedInput.observation,
    post: normalizedInput.post,
  };

  return [
    'You extract structured housing data from Facebook posts for a local-first processing pipeline.',
    'Return only JSON that matches the provided response schema.',
    'Use only evidence from the input post.',
    'If a field is unknown, return null, an empty array, or another schema-valid unknown value instead of guessing.',
    'If the schema includes source or provenance fields, copy postUrl exactly from the input.',
    'If the post contains multiple housing offerings, return all of them.',
    '',
    'Input post JSON:',
    JSON.stringify(promptInput, null, 2),
  ].join('\n');
}

export async function runGeminiStructuredExtraction(options) {
  const modelName = normalizeString(options.modelName || DEFAULT_GEMINI_MODEL_NAME);
  const processorVersion = normalizeString(
    options.processorVersion || DEFAULT_GEMINI_PROCESSOR_VERSION,
  );
  const schemaVersion = normalizeString(
    options.schemaVersion || DEFAULT_GEMINI_SCHEMA_VERSION,
  );
  const processedAt = normalizeString(options.processedAt || new Date().toISOString());
  const temperature = normalizeTemperature(options.temperature);
  const thinkingLevel = normalizeThinkingLevel(
    options.thinkingLevel || DEFAULT_GEMINI_THINKING_LEVEL,
  );
  const requestTimeoutMs = normalizeRequestTimeoutMs(options.requestTimeoutMs);
  const responseMimeType = 'application/json';

  if (!modelName) {
    throw new Error('Gemini structured extraction requires modelName');
  }

  if (!processorVersion) {
    throw new Error('Gemini structured extraction requires processorVersion');
  }

  if (!schemaVersion) {
    throw new Error('Gemini structured extraction requires schemaVersion');
  }

  if (!options.outputSchema || !isPlainObject(options.outputSchema)) {
    throw new Error('Gemini structured extraction requires a JSON schema object');
  }

  const normalizedInput = normalizeGeminiInput(options.inputPost);
  const prompt = buildGeminiStructuredPrompt(normalizedInput);
  const apiKey = normalizeString(options.apiKey);

  if (!apiKey) {
    throw new Error('Gemini structured extraction requires an API key');
  }

  const client = options.client || new GoogleGenAI({ apiKey });
  const requestAbort = createRequestAbortController({
    timeoutMs: requestTimeoutMs,
    abortSignal: options.abortSignal,
  });
  let response;

  try {
    response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType,
        responseJsonSchema: options.outputSchema,
        temperature,
        httpOptions: {
          ...normalizeHttpOptions(options.httpOptions),
          timeout: requestTimeoutMs,
        },
        abortSignal: requestAbort.signal,
        // Gemini 3 should use thinkingLevel explicitly so extraction never falls back to dynamic thinking.
        thinkingConfig: {
          thinkingLevel,
        },
      },
    });
  } catch (error) {
    if (requestAbort.didTimeout()) {
      throw new GeminiRequestTimeoutError(requestTimeoutMs, error);
    }

    if (requestAbort.didCancel()) {
      throw new GeminiRequestCancelledError(error);
    }

    throw error;
  } finally {
    requestAbort.cleanup();
  }
  const rawResponseText = normalizeString(response.text);

  if (!rawResponseText) {
    throw new Error('Gemini returned an empty structured response');
  }

  let structuredData;
  try {
    structuredData = JSON.parse(rawResponseText);
  } catch (error) {
    throw new Error(
      `Gemini returned non-JSON structured output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const normalizedOutput = typeof options.normalizeStructuredData === 'function'
    ? options.normalizeStructuredData(structuredData, normalizedInput)
    : {
        structuredData,
        listingCount: detectListingCount(structuredData),
        listings: undefined,
      };
  const listingCount = Number.isInteger(normalizedOutput?.listingCount)
    ? normalizedOutput.listingCount
    : detectListingCount(normalizedOutput?.structuredData ?? structuredData);

  return {
    processorVersion,
    schemaVersion,
    modelName,
    processedAt,
    observation: normalizedInput.observation,
    inputPost: normalizedInput.post,
    extracted: {
      listingCount,
      structuredData: normalizedOutput?.structuredData ?? structuredData,
      ...(Array.isArray(normalizedOutput?.listings)
        ? {
            listings: normalizedOutput.listings,
          }
        : {}),
    },
    gemini: {
      responseMimeType,
      temperature,
      requestTimeoutMs,
      thinkingConfig: {
        thinkingLevel,
      },
      inputSource: options.inputSource || null,
      schemaSource: options.schemaSource || null,
      schema: options.outputSchema,
      prompt,
      rawResponseText,
      responseId: normalizeNullableString(response.responseId),
      modelVersion: normalizeNullableString(response.modelVersion),
      finishReason: normalizeNullableString(response.candidates?.[0]?.finishReason),
      usageMetadata: response.usageMetadata || null,
    },
  };
}

function detectListingCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (!value || typeof value !== 'object') {
    return 0;
  }

  if (Array.isArray(value.listings)) {
    return value.listings.length;
  }

  if (Array.isArray(value.extracted?.listings)) {
    return value.extracted.listings.length;
  }

  if (Number.isInteger(value.listingCount) && value.listingCount >= 0) {
    return value.listingCount;
  }

  return 0;
}

function normalizeTemperature(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Gemini structured extraction requires a numeric temperature, received: ${value}`);
  }

  return numericValue;
}

function normalizeThinkingLevel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return DEFAULT_GEMINI_THINKING_LEVEL;
  }

  if (!['minimal', 'low', 'medium', 'high'].includes(normalized)) {
    throw new Error(
      `Gemini structured extraction requires thinkingLevel to be one of minimal, low, medium, or high, received: ${value}`,
    );
  }

  return normalized;
}

function normalizeRequestTimeoutMs(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_GEMINI_REQUEST_TIMEOUT_MS;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < MIN_GEMINI_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `Gemini structured extraction requires requestTimeoutMs to be an integer >= ${MIN_GEMINI_REQUEST_TIMEOUT_MS}, received: ${value}`,
    );
  }

  return numericValue;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHttpOptions(value) {
  return isPlainObject(value) ? value : {};
}

function createRequestAbortController(options = {}) {
  const controller = new AbortController();
  const parentSignal = options.abortSignal;
  const timeoutMs = options.timeoutMs;
  let timedOut = false;
  let cancelled = false;
  let timeoutHandle = null;

  const abortFromParent = () => {
    cancelled = true;
    controller.abort(parentSignal?.reason || new Error('Gemini request was cancelled'));
  };

  if (parentSignal instanceof AbortSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Gemini request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    didCancel: () => cancelled,
    cleanup() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (parentSignal instanceof AbortSignal && !parentSignal.aborted) {
        parentSignal.removeEventListener('abort', abortFromParent);
      }
    },
  };
}

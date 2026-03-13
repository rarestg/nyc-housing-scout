export const DEFAULT_GEMINI_MODEL_NAME = 'gemini-3-flash-preview';
export const DEFAULT_GEMINI_PROCESSOR_VERSION = 'gemini-structured-v1';
export const DEFAULT_GEMINI_SCHEMA_VERSION = 'gemini-processed-payload-v1';
export const DEFAULT_GEMINI_TEMPERATURE = 0;
// Gemini 3 defaults to dynamic/high thinking when omitted, so keep extraction pinned to minimal.
export const DEFAULT_GEMINI_THINKING_LEVEL = 'minimal';
// Keep request timeout below the default 5 minute lease so stuck calls fail before lease expiry.
export const DEFAULT_GEMINI_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
export const MIN_GEMINI_REQUEST_TIMEOUT_MS = 50;
export const DEFAULT_GEMINI_LEASE_GUARD_MS = 15 * 1000;

export const DEFAULT_GEMINI_KEY_CHECK_MODEL_NAME = 'gemini-3.1-flash-lite-preview';
export const DEFAULT_GEMINI_KEY_CHECK_THINKING_LEVEL = DEFAULT_GEMINI_THINKING_LEVEL;

export const GEMINI_API_KEY_ENV_VARS = Object.freeze([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
]);

export const DEFAULT_GEMINI_ENV_FILE_CANDIDATES = Object.freeze([
  'data/cache/gemini/gemini.env',
  'data/gemini/gemini.env',
]);

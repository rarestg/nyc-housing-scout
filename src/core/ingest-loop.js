import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BROWSER_PROFILE = 'chrome';
export const DEFAULT_TARGET = 10;
export const DEFAULT_MAX_SCROLLS = 10;
export const DEFAULT_PROCESS_LIMIT = 10;
export const DEFAULT_SAMPLE_LIMIT = 3;
export const DEFAULT_POLL_INTERVAL_MS = 120000;
export const DEFAULT_IDLE_INTERVAL_MS = 60000;
export const DEFAULT_SETTLE_MS = 2000;
export const DEFAULT_NOTIFY_MODE = 'important';

const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const IMPORTANT_NOTIFICATION_TYPES = new Set([
  'fresh_cycle',
  'preflight_error',
  'cycle_error',
  'max_idle_reached',
  'stopped',
]);
const VERBOSE_NOTIFICATION_TYPES = new Set([
  ...IMPORTANT_NOTIFICATION_TYPES,
  'dry_run',
  'idle_cycle',
  'reset_action',
]);
const THROTTLED_NOTIFICATION_TYPES = new Set(['preflight_error', 'cycle_error']);

export function normalizeFacebookGroupUrl(value) {
  try {
    const url = new URL(value);
    if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || parts[0] !== 'groups') {
      return null;
    }

    const normalized = new URL(`https://www.facebook.com/groups/${parts[1]}/`);
    const sortingSetting = url.searchParams.get('sorting_setting');
    if (sortingSetting) {
      normalized.searchParams.set('sorting_setting', sortingSetting);
    }

    return normalized.toString();
  } catch {
    return null;
  }
}

export function isMatchingFacebookGroupUrl(actualUrl, requestedUrl) {
  const normalizedActual = normalizeFacebookGroupUrl(actualUrl);
  const normalizedRequested = normalizeFacebookGroupUrl(requestedUrl);

  if (!normalizedActual || !normalizedRequested) {
    return false;
  }

  if (normalizedActual === normalizedRequested) {
    return true;
  }

  const actual = new URL(normalizedActual);
  const requested = new URL(normalizedRequested);
  const actualParts = actual.pathname.split('/').filter(Boolean);
  const requestedParts = requested.pathname.split('/').filter(Boolean);

  if (actualParts[1] !== requestedParts[1]) {
    return false;
  }

  const requestedSorting = requested.searchParams.get('sorting_setting');
  const actualSorting = actual.searchParams.get('sorting_setting');
  if (requestedSorting && actualSorting && actualSorting !== requestedSorting) {
    return false;
  }

  return true;
}

export function classifyCycle(crawlSummary) {
  return Number(crawlSummary?.freshCollected || 0) > 0 ? 'fresh' : 'idle';
}

export function stopFileExists(stopFilePath) {
  return Boolean(stopFilePath) && fs.existsSync(stopFilePath);
}

export function createInitialState({
  sourceKey,
  displayName,
  groupUrl,
  browserProfile,
  startedAt = new Date().toISOString(),
}) {
  return {
    sourceKey,
    displayName,
    groupUrl,
    browserProfile,
    startedAt,
    updatedAt: startedAt,
    cycle: 0,
    idleCycles: 0,
    status: 'starting',
    lastOutcome: null,
    lastRunId: null,
    lastFreshCollected: 0,
    lastProcessedCount: 0,
    lastError: null,
    lastNextAction: null,
    lastWaitMs: 0,
    stopReason: null,
  };
}

export function applyCycleResult(state, cycleResult) {
  const idleCycles = cycleResult.outcome === 'idle'
    ? state.idleCycles + 1
    : cycleResult.outcome === 'fresh'
      ? 0
      : state.idleCycles;

  return {
    ...state,
    updatedAt: cycleResult.completedAt || new Date().toISOString(),
    cycle: cycleResult.cycleIndex ?? state.cycle,
    idleCycles,
    status: cycleResult.status || 'running',
    lastOutcome: cycleResult.outcome || state.lastOutcome,
    lastRunId: cycleResult.runId || null,
    lastFreshCollected: Number(cycleResult.freshCollected || 0),
    lastProcessedCount: Number(cycleResult.processedCount || 0),
    lastError: cycleResult.errorMessage || null,
    lastNextAction: cycleResult.nextAction || null,
    lastWaitMs: Number(cycleResult.waitMs || 0),
    stopReason: cycleResult.stopReason || null,
  };
}

export function finalizeState(state, { status = 'stopped', stopReason, updatedAt = new Date().toISOString(), lastError } = {}) {
  return {
    ...state,
    updatedAt,
    status,
    stopReason: stopReason || state.stopReason || null,
    lastError: lastError === undefined ? state.lastError : lastError,
  };
}

export function writeStateFile(stateFilePath, state) {
  ensureParentDirectory(stateFilePath);
  fs.writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function appendJsonLine(logFilePath, value) {
  ensureParentDirectory(logFilePath);
  fs.appendFileSync(logFilePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export function shouldSendNotification({
  notifyMode,
  eventType,
  dedupeKey,
  previousDedupeKey,
}) {
  if (notifyMode === 'off') {
    return {
      send: false,
      nextDedupeKey: previousDedupeKey || null,
    };
  }

  const allowedTypes = notifyMode === 'verbose'
    ? VERBOSE_NOTIFICATION_TYPES
    : IMPORTANT_NOTIFICATION_TYPES;
  if (!allowedTypes.has(eventType)) {
    return {
      send: false,
      nextDedupeKey: previousDedupeKey || null,
    };
  }

  const resolvedKey = dedupeKey || eventType;
  if (
    THROTTLED_NOTIFICATION_TYPES.has(eventType)
    && resolvedKey
    && previousDedupeKey === resolvedKey
  ) {
    return {
      send: false,
      nextDedupeKey: previousDedupeKey || null,
    };
  }

  return {
    send: true,
    nextDedupeKey: resolvedKey,
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

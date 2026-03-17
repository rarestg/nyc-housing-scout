import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { stripCliBanner } from '../core/browser-pipeline.js';
import {
  DEFAULT_BROWSER_PROFILE,
  DEFAULT_IDLE_INTERVAL_MS,
  DEFAULT_MAX_SCROLLS,
  DEFAULT_NOTIFY_MODE,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PROCESS_LIMIT,
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_SETTLE_MS,
  DEFAULT_TARGET,
  appendJsonLine,
  applyCycleResult,
  classifyCycle,
  createInitialState,
  finalizeState,
  isMatchingFacebookGroupUrl,
  normalizeFacebookGroupUrl,
  shouldSendNotification,
  stopFileExists,
  writeStateFile,
} from '../core/ingest-loop.js';
import { hasFlag, readFlag } from './processing-cli-helpers.js';

const args = process.argv.slice(2);

if (hasHelpFlag(args)) {
  printUsage(0);
}

const config = readConfig(args);
let state = createInitialState({
  sourceKey: config.sourceKey,
  displayName: config.displayName,
  groupUrl: config.groupUrl,
  browserProfile: config.browserProfile,
});
let activeChild = null;
let stopRequested = false;
let stopReason = null;
let lastNotificationKey = null;

const requestStop = (reason) => {
  if (!stopRequested) {
    stopRequested = true;
    stopReason = reason;
  }

  if (activeChild && !activeChild.killed) {
    activeChild.kill('SIGTERM');
  }
};

process.on('SIGINT', () => requestStop('signal:SIGINT'));
process.on('SIGTERM', () => requestStop('signal:SIGTERM'));

try {
  await main();
} catch (error) {
  const message = sanitizeError(error);
  state = finalizeState(state, {
    status: 'error',
    stopReason: stopReason || 'fatal-error',
    lastError: message,
  });
  writeStateFile(config.stateFile, state);
  appendJsonLine(config.logFile, {
    event: 'stop',
    sourceKey: config.sourceKey,
    status: 'error',
    stopReason: state.stopReason,
    cycle: state.cycle,
    updatedAt: state.updatedAt,
    error: message,
  });
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  writeStateFile(config.stateFile, state);

  let finalStopReason = getImmediateStopReason(state);
  if (finalStopReason) {
    await finalizeLoop(finalStopReason);
    return;
  }

  while (!finalStopReason) {
    const cycleIndex = state.cycle + 1;
    let cycleSummary;

    try {
      cycleSummary = await runSingleCycle(cycleIndex);
    } catch (error) {
      if (isStopError(error) || stopRequested) {
        finalStopReason = stopReason || error.stopReason || 'stopped';
        break;
      }

      throw error;
    }

    const nextState = applyCycleResult(state, {
      cycleIndex: cycleSummary.cycle,
      outcome: cycleSummary.outcome,
      runId: cycleSummary.runId,
      freshCollected: cycleSummary.crawl?.freshCollected || 0,
      processedCount: cycleSummary.processing.processedCount || 0,
      errorMessage: cycleSummary.error?.message || null,
      nextAction: cycleSummary.nextAction,
      waitMs: cycleSummary.waitMs,
      completedAt: cycleSummary.completedAt,
      status: 'running',
    });

    const postCycleStopReason = getOutcomeStopReason(cycleSummary)
      || getImmediateStopReason(nextState)
      || getMaxIdleStopReason(nextState);

    cycleSummary.idleCycles = nextState.idleCycles;
    if (postCycleStopReason) {
      cycleSummary.nextAction = 'stopped';
      cycleSummary.waitMs = 0;
      cycleSummary.stopReason = postCycleStopReason;
    }

    nextState.lastNextAction = cycleSummary.nextAction;
    nextState.lastWaitMs = cycleSummary.waitMs;
    nextState.stopReason = cycleSummary.stopReason || null;

    const cycleNotification = await emitCycleNotification(cycleSummary);
    if (cycleNotification) {
      cycleSummary.callbacks.push(cycleNotification);
    }

    if (postCycleStopReason === 'max-idle-cycles') {
      const idleStopNotification = await emitNotification({
        eventType: 'max_idle_reached',
        dedupeKey: `max-idle:${config.sourceKey}:${nextState.idleCycles}`,
        text: `Ingest loop: ${config.sourceKey} reached max idle cycles (${nextState.idleCycles}); stopping.`,
      });
      if (idleStopNotification) {
        cycleSummary.callbacks.push(idleStopNotification);
      }
    }

    state = nextState;
    writeStateFile(config.stateFile, state);
    appendJsonLine(config.logFile, cycleSummary);
    console.log(JSON.stringify(cycleSummary));

    finalStopReason = postCycleStopReason;
    if (finalStopReason) {
      break;
    }

    const waitStopReason = await waitForInterval(cycleSummary.waitMs);
    if (waitStopReason) {
      finalStopReason = waitStopReason;
    }
  }

  await finalizeLoop(finalStopReason || stopReason || 'stopped');
}

async function runSingleCycle(cycleIndex) {
  const startedAt = new Date().toISOString();
  const cycleSummary = {
    event: 'cycle',
    cycle: cycleIndex,
    sourceKey: config.sourceKey,
    displayName: config.displayName,
    startedAt,
    completedAt: null,
    outcome: 'error',
    runId: null,
    idleCycles: state.idleCycles,
    preflight: null,
    reset: {
      attempted: false,
      groupUrl: config.groupUrl,
      settledMs: config.settleMs,
      href: null,
      title: null,
    },
    crawl: null,
    processing: emptyProcessingSummary(config.skipProcessing ? 'skip-processing' : 'not-fresh'),
    callbacks: [],
    nextAction: 'retry',
    waitMs: config.idleIntervalMs,
    stopReason: null,
    error: null,
  };

  try {
    ensureNotStopping();

    const preflight = await performPreflight();
    cycleSummary.preflight = {
      href: preflight.page.href,
      title: preflight.page.title,
      normalizedHref: preflight.normalizedHref,
      requestedGroupUrl: config.normalizedGroupUrl,
      browserStatus: {
        enabled: preflight.status.enabled,
        running: preflight.status.running,
        cdpReady: preflight.status.cdpReady,
        cdpHttp: preflight.status.cdpHttp,
      },
    };

    if (config.dryRun) {
      cycleSummary.outcome = 'dry_run';
      cycleSummary.processing = emptyProcessingSummary('dry-run');
      cycleSummary.nextAction = 'stopped';
      cycleSummary.waitMs = 0;
      cycleSummary.completedAt = new Date().toISOString();
      return cycleSummary;
    }

    const resetNotification = await emitNotification({
      eventType: 'reset_action',
      dedupeKey: `reset:${config.sourceKey}:${cycleIndex}`,
      text: `Ingest loop: resetting ${config.sourceKey} to ${config.groupUrl}.`,
    });
    if (resetNotification) {
      cycleSummary.callbacks.push(resetNotification);
    }

    ensureNotStopping();

    const reset = await navigateToRequestedGroup();
    cycleSummary.reset = {
      attempted: true,
      groupUrl: config.groupUrl,
      settledMs: config.settleMs,
      href: reset.page.href,
      title: reset.page.title,
      normalizedHref: reset.normalizedHref,
    };

    ensureNotStopping();

    const crawl = await runCrawlCycle();
    cycleSummary.runId = crawl.runId || null;
    cycleSummary.crawl = summarizeCrawl(crawl);
    cycleSummary.outcome = classifyCycle(crawl);
    cycleSummary.processing = emptyProcessingSummary('not-fresh');
    cycleSummary.waitMs = cycleSummary.outcome === 'fresh'
      ? config.pollIntervalMs
      : config.idleIntervalMs;
    cycleSummary.nextAction = 'sleep';

    ensureNotStopping();

    if (cycleSummary.outcome === 'fresh' && !config.skipProcessing) {
      if (!cycleSummary.runId) {
        throw createLoopError('crawl', 'crawl-dom-latest output did not include runId');
      }

      const validation = await runFreshQueueProcessing(cycleSummary.runId);
      cycleSummary.processing = summarizeProcessing(validation);
    } else if (config.skipProcessing) {
      cycleSummary.processing = emptyProcessingSummary('skip-processing');
    }
  } catch (error) {
    if (isStopError(error) || stopRequested) {
      throw error;
    }

    cycleSummary.outcome = 'error';
    cycleSummary.nextAction = 'retry';
    cycleSummary.waitMs = config.idleIntervalMs;
    cycleSummary.error = {
      stage: error.stage || 'cycle',
      message: sanitizeError(error),
    };
  }

  cycleSummary.completedAt = new Date().toISOString();
  return cycleSummary;
}

async function performPreflight() {
  const status = await runJsonCommand('openclaw', [
    'browser',
    '--browser-profile',
    config.browserProfile,
    '--json',
    'status',
  ], { stage: 'preflight' });

  if (!status?.running || !status?.cdpReady || status?.enabled === false) {
    throw createLoopError(
      'preflight',
      `browser profile ${config.browserProfile} is not healthy (running=${status?.running}, cdpReady=${status?.cdpReady})`,
    );
  }

  const evaluation = await runJsonCommand('openclaw', [
    'browser',
    '--browser-profile',
    config.browserProfile,
    '--json',
    'evaluate',
    '--fn',
    '() => ({ title: document.title, href: location.href })',
  ], { stage: 'preflight' });
  const page = evaluation?.result || {};

  if (!page.title || !page.href) {
    throw createLoopError('preflight', 'page-context evaluate did not return title and href');
  }

  const normalizedHref = normalizeFacebookGroupUrl(page.href);
  if (!normalizedHref) {
    throw createLoopError('preflight', `attached tab is not a Facebook group page: ${page.href}`);
  }

  if (!isMatchingFacebookGroupUrl(page.href, config.groupUrl)) {
    throw createLoopError('preflight', `attached tab does not match requested group URL: ${page.href}`);
  }

  return {
    status,
    page,
    normalizedHref,
  };
}

async function navigateToRequestedGroup() {
  await runCommand('openclaw', [
    'browser',
    '--browser-profile',
    config.browserProfile,
    'navigate',
    config.groupUrl,
  ], { stage: 'navigate' });
  await runCommand('openclaw', [
    'browser',
    '--browser-profile',
    config.browserProfile,
    'wait',
    '--time',
    String(config.settleMs),
  ], { stage: 'navigate' });

  const evaluation = await runJsonCommand('openclaw', [
    'browser',
    '--browser-profile',
    config.browserProfile,
    '--json',
    'evaluate',
    '--fn',
    '() => ({ title: document.title, href: location.href })',
  ], { stage: 'navigate' });
  const page = evaluation?.result || {};
  const normalizedHref = normalizeFacebookGroupUrl(page.href);

  if (!normalizedHref || !isMatchingFacebookGroupUrl(page.href, config.groupUrl)) {
    throw createLoopError('navigate', `post-navigate page does not match requested group URL: ${page.href || 'unknown'}`);
  }

  return {
    page,
    normalizedHref,
  };
}

async function runCrawlCycle() {
  return runJsonCommand(process.execPath, [
    path.resolve(process.cwd(), 'src/cli/crawl-dom-latest.js'),
    '--browser-profile',
    config.browserProfile,
    '--source-key',
    config.sourceKey,
    '--source-name',
    config.displayName,
    '--source-url',
    config.groupUrl,
    '--target',
    String(config.target),
    '--max-scrolls',
    String(config.maxScrolls),
  ], { stage: 'crawl' });
}

async function runFreshQueueProcessing(runId) {
  return runJsonCommand(process.execPath, [
    path.resolve(process.cwd(), 'src/cli/validate-queue.js'),
    '--run-id',
    runId,
    '--freshness',
    'fresh',
    '--process-limit',
    String(config.processLimit),
    '--sample-limit',
    String(config.sampleLimit),
  ], { stage: 'processing' });
}

async function emitCycleNotification(cycleSummary) {
  if (cycleSummary.outcome === 'fresh') {
    return emitNotification({
      eventType: 'fresh_cycle',
      dedupeKey: `fresh:${cycleSummary.runId || cycleSummary.cycle}`,
      text: buildFreshCycleMessage(cycleSummary),
    });
  }

  if (cycleSummary.outcome === 'idle') {
    return emitNotification({
      eventType: 'idle_cycle',
      dedupeKey: `idle:${config.sourceKey}:${cycleSummary.cycle}`,
      text: `Ingest loop: no fresh posts this cycle for ${config.sourceKey}; resetting and retrying in ${cycleSummary.waitMs}ms.`,
    });
  }

  if (cycleSummary.outcome === 'dry_run') {
    return emitNotification({
      eventType: 'dry_run',
      dedupeKey: `dry-run:${config.sourceKey}`,
      text: `Ingest loop: dry-run preflight succeeded for ${config.sourceKey}; no crawl or processing was started.`,
    });
  }

  const eventType = cycleSummary.error?.stage === 'preflight'
    ? 'preflight_error'
    : 'cycle_error';
  return emitNotification({
    eventType,
    dedupeKey: `${eventType}:${cycleSummary.error?.message || 'unknown'}`,
    text: `Ingest loop: ${cycleSummary.error?.stage || 'cycle'} failed for ${config.sourceKey}: ${cycleSummary.error?.message || 'unknown error'}`,
  });
}

async function emitNotification({ eventType, dedupeKey, text }) {
  const decision = shouldSendNotification({
    notifyMode: config.notifyMode,
    eventType,
    dedupeKey,
    previousDedupeKey: lastNotificationKey,
  });
  if (!decision.send) {
    return null;
  }

  try {
    await runCommand('openclaw', [
      'system',
      'event',
      '--mode',
      'now',
      '--text',
      text,
    ], { stage: 'notify' });
    lastNotificationKey = decision.nextDedupeKey;
    return {
      eventType,
      sent: true,
      text,
    };
  } catch (error) {
    return {
      eventType,
      sent: false,
      text,
      error: sanitizeError(error),
    };
  }
}

async function finalizeLoop(finalReason) {
  state = finalizeState(state, {
    status: 'stopped',
    stopReason: finalReason,
  });
  writeStateFile(config.stateFile, state);

  const stopNotification = await emitNotification({
    eventType: 'stopped',
    dedupeKey: `stop:${config.sourceKey}:${finalReason}:${state.cycle}`,
    text: `Ingest loop: stopped for ${config.sourceKey} (${finalReason}) after ${state.cycle} cycle(s).`,
  });

  const stopEvent = {
    event: 'stop',
    sourceKey: config.sourceKey,
    cycle: state.cycle,
    idleCycles: state.idleCycles,
    stopReason: finalReason,
    status: state.status,
    updatedAt: state.updatedAt,
    callback: stopNotification,
  };
  appendJsonLine(config.logFile, stopEvent);
  console.log(JSON.stringify(stopEvent));
}

async function waitForInterval(waitMs) {
  if (!waitMs) {
    return getImmediateStopReason(state);
  }

  const stepMs = Math.min(waitMs, 250);
  let remaining = waitMs;

  while (remaining > 0) {
    const immediateStopReason = getImmediateStopReason(state);
    if (immediateStopReason) {
      return immediateStopReason;
    }

    const nextDelay = Math.min(stepMs, remaining);
    await sleep(nextDelay);
    remaining -= nextDelay;
  }

  return getImmediateStopReason(state);
}

function getImmediateStopReason(currentState) {
  if (stopRequested) {
    return stopReason || 'stopped';
  }

  if (stopFileExists(config.stopFile)) {
    return 'stop-file';
  }

  if (config.maxCycles > 0 && currentState.cycle >= config.maxCycles) {
    return 'max-cycles';
  }

  return null;
}

function getMaxIdleStopReason(currentState) {
  if (config.maxIdleCycles > 0 && currentState.idleCycles >= config.maxIdleCycles) {
    return 'max-idle-cycles';
  }

  return null;
}

function getOutcomeStopReason(cycleSummary) {
  if (cycleSummary.outcome === 'dry_run') {
    return 'dry-run';
  }

  return null;
}

function ensureNotStopping() {
  if (stopRequested) {
    throw createStopError(stopReason || 'stopped');
  }

  if (stopFileExists(config.stopFile)) {
    throw createStopError('stop-file');
  }
}

function summarizeCrawl(crawl) {
  return {
    collected: Number(crawl?.collected || 0),
    freshCollected: Number(crawl?.freshCollected || 0),
    seenCollected: Number(crawl?.seenCollected || 0),
    unidentifiedCollected: Number(crawl?.unidentifiedCollected || 0),
    stepCount: Array.isArray(crawl?.stepLog) ? crawl.stepLog.length : 0,
  };
}

function summarizeProcessing(validation) {
  const processing = validation?.processing || {};
  return {
    ran: true,
    skipped: false,
    reason: null,
    claimedCount: Number(processing.claimedCount || 0),
    processedCount: Number(processing.processedCount || 0),
    retryableCount: Number(processing.retryableCount || 0),
    failedCount: Number(processing.failedCount || 0),
    enqueueCreated: Number(validation?.enqueue?.counts?.created || 0),
    enqueueExisting: Number(validation?.enqueue?.counts?.existing || 0),
    timeoutCount: Number(processing?.metrics?.timeoutCount || 0),
    retryCount: Number(processing?.metrics?.retryCount || 0),
    claimToCompleteMs: Number(processing?.metrics?.claimToCompleteMs || 0),
  };
}

function emptyProcessingSummary(reason) {
  return {
    ran: false,
    skipped: reason !== 'not-fresh',
    reason,
    claimedCount: 0,
    processedCount: 0,
    retryableCount: 0,
    failedCount: 0,
    enqueueCreated: 0,
    enqueueExisting: 0,
    timeoutCount: 0,
    retryCount: 0,
    claimToCompleteMs: 0,
  };
}

function buildFreshCycleMessage(cycleSummary) {
  const processedSummary = cycleSummary.processing.ran
    ? `${cycleSummary.processing.processedCount} processed, ${cycleSummary.processing.retryableCount} retryable, ${cycleSummary.processing.failedCount} failed`
    : 'processing skipped';
  return `Ingest loop: ${cycleSummary.crawl?.freshCollected || 0} fresh post(s) captured for ${config.sourceKey}; ${processedSummary} (run ${cycleSummary.runId}).`;
}

async function runJsonCommand(command, commandArgs, { stage }) {
  const result = await runCommand(command, commandArgs, { stage });
  try {
    return JSON.parse(stripCliBanner(result.stdout));
  } catch (error) {
    throw createLoopError(
      stage,
      `failed to parse JSON output from ${command}: ${sanitizeError(error)}`,
    );
  }
}

function runCommand(command, commandArgs, { stage }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChild = child;

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      activeChild = null;
      reject(createLoopError(stage, sanitizeError(error)));
    });
    child.on('close', (code, signal) => {
      activeChild = null;

      if (signal) {
        reject(createLoopError(stage, `command exited via signal ${signal}`, {
          stdout,
          stderr,
        }));
        return;
      }

      if (code !== 0) {
        const detail = stripCliBanner(stderr || stdout).trim() || `exit code ${code}`;
        reject(createLoopError(stage, detail, {
          code,
          stdout,
          stderr,
        }));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function readConfig(argv) {
  const sourceKey = readRequiredFlag(argv, '--source-key');
  const displayName = readRequiredFlag(argv, '--display-name');
  const groupUrl = readRequiredFlag(argv, '--group-url');
  const normalizedGroupUrl = normalizeFacebookGroupUrl(groupUrl);

  if (!normalizedGroupUrl) {
    printUsage(1, `--group-url must be a Facebook group URL: ${groupUrl}`);
  }

  return {
    sourceKey,
    displayName,
    groupUrl,
    normalizedGroupUrl,
    browserProfile: readFlag(argv, '--browser-profile', DEFAULT_BROWSER_PROFILE),
    target: readIntegerFlag(argv, '--target', DEFAULT_TARGET, { min: 1 }),
    maxScrolls: readIntegerFlag(argv, '--max-scrolls', DEFAULT_MAX_SCROLLS, { min: 0 }),
    processLimit: readIntegerFlag(argv, '--process-limit', DEFAULT_PROCESS_LIMIT, { min: 0 }),
    sampleLimit: readIntegerFlag(argv, '--sample-limit', DEFAULT_SAMPLE_LIMIT, { min: 0 }),
    pollIntervalMs: readIntegerFlag(argv, '--poll-interval-ms', DEFAULT_POLL_INTERVAL_MS, { min: 0 }),
    idleIntervalMs: readIntegerFlag(argv, '--idle-interval-ms', DEFAULT_IDLE_INTERVAL_MS, { min: 0 }),
    maxCycles: readIntegerFlag(argv, '--max-cycles', 0, { min: 0 }),
    maxIdleCycles: readIntegerFlag(argv, '--max-idle-cycles', 0, { min: 0 }),
    stateFile: resolveLoopFile(argv, '--state-file', `${sourceKey}.json`),
    stopFile: resolveLoopFile(argv, '--stop-file', `${sourceKey}.stop`),
    logFile: resolveLoopFile(argv, '--log-file', `${sourceKey}.jsonl`),
    notifyMode: readNotifyMode(argv),
    skipProcessing: hasFlag(argv, '--skip-processing'),
    dryRun: hasFlag(argv, '--dry-run'),
    settleMs: DEFAULT_SETTLE_MS,
  };
}

function resolveLoopFile(argv, flagName, defaultBaseName) {
  const fallback = path.join('data', 'state', 'ingest-loop', defaultBaseName);
  return path.resolve(process.cwd(), readFlag(argv, flagName, fallback));
}

function readRequiredFlag(argv, name) {
  const value = readFlag(argv, name, undefined);
  if (!value) {
    printUsage(1, `Missing required flag: ${name}`);
  }

  return value;
}

function readIntegerFlag(argv, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = readFlag(argv, name, undefined);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function readNotifyMode(argv) {
  const notifyMode = readFlag(argv, '--notify', DEFAULT_NOTIFY_MODE);
  if (notifyMode === 'off' || notifyMode === 'important' || notifyMode === 'verbose') {
    return notifyMode;
  }

  return DEFAULT_NOTIFY_MODE;
}

function createLoopError(stage, message, details = {}) {
  const error = new Error(message);
  error.stage = stage;
  Object.assign(error, details);
  return error;
}

function createStopError(reason) {
  const error = new Error(`stop requested: ${reason}`);
  error.stopReason = reason;
  error.isStopError = true;
  return error;
}

function isStopError(error) {
  return Boolean(error?.isStopError);
}

function sanitizeError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasHelpFlag(argv) {
  return hasFlag(argv, '--help') || hasFlag(argv, '-h');
}

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  npm run ingest:loop -- --source-key <key> --display-name "<name>" --group-url <url> [options]

Required:
  --source-key <key>
  --display-name <name>
  --group-url <url>

Options:
  --browser-profile <profile>  Defaults to ${DEFAULT_BROWSER_PROFILE}
  --target <n>                 Defaults to ${DEFAULT_TARGET}
  --max-scrolls <n>            Defaults to ${DEFAULT_MAX_SCROLLS}
  --process-limit <n>          Defaults to ${DEFAULT_PROCESS_LIMIT}
  --sample-limit <n>           Defaults to ${DEFAULT_SAMPLE_LIMIT}
  --poll-interval-ms <n>       Defaults to ${DEFAULT_POLL_INTERVAL_MS}
  --idle-interval-ms <n>       Defaults to ${DEFAULT_IDLE_INTERVAL_MS}
  --max-cycles <n>             Defaults to 0 (run until stopped)
  --max-idle-cycles <n>        Defaults to 0 (unlimited)
  --state-file <path>          Defaults to data/state/ingest-loop/<source-key>.json
  --stop-file <path>           Defaults to data/state/ingest-loop/<source-key>.stop
  --log-file <path>            Defaults to data/state/ingest-loop/<source-key>.jsonl
  --notify <mode>              off | important | verbose (default: ${DEFAULT_NOTIFY_MODE})
  --skip-processing            Skip validate:queue even when fresh posts are found
  --dry-run                    Run preflight only; do not navigate, crawl, or process`);

  process.exit(exitCode);
}

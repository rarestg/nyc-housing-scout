import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
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
} from '../src/core/ingest-loop.js';

test('classifyCycle treats positive fresh counts as fresh and zero as idle', () => {
  assert.equal(classifyCycle({ freshCollected: 3 }), 'fresh');
  assert.equal(classifyCycle({ freshCollected: 0 }), 'idle');
  assert.equal(classifyCycle({}), 'idle');
});

test('facebook group URL helpers normalize and match the requested group path', () => {
  const requested = 'https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL';
  const attached = 'https://facebook.com/groups/williamsburggreenpointhousing';
  const otherGroup = 'https://www.facebook.com/groups/greenpointrooms/';

  assert.equal(
    normalizeFacebookGroupUrl(requested),
    'https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL',
  );
  assert.equal(
    normalizeFacebookGroupUrl(attached),
    'https://www.facebook.com/groups/williamsburggreenpointhousing/',
  );
  assert.equal(isMatchingFacebookGroupUrl(attached, requested), true);
  assert.equal(isMatchingFacebookGroupUrl(otherGroup, requested), false);
});

test('stopFileExists reflects stop file presence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-stop-file-'));
  const stopFile = path.join(tempDir, 'loop.stop');

  assert.equal(stopFileExists(stopFile), false);
  fs.writeFileSync(stopFile, 'stop\n', 'utf8');
  assert.equal(stopFileExists(stopFile), true);
});

test('state and log writers persist cycle progress and clean stop state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-ingest-state-'));
  const stateFile = path.join(tempDir, 'state', 'loop.json');
  const logFile = path.join(tempDir, 'state', 'loop.jsonl');

  let state = createInitialState({
    sourceKey: 'williamsburggreenpointhousing',
    displayName: 'Williamsburg Greenpoint Housing',
    groupUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL',
    browserProfile: 'chrome',
    startedAt: '2026-03-13T18:00:00.000Z',
  });
  writeStateFile(stateFile, state);

  state = applyCycleResult(state, {
    cycleIndex: 1,
    outcome: 'idle',
    runId: '2026-03-13T18-01-00-000Z',
    freshCollected: 0,
    processedCount: 0,
    nextAction: 'sleep',
    waitMs: 60000,
    completedAt: '2026-03-13T18:01:10.000Z',
  });
  writeStateFile(stateFile, state);
  appendJsonLine(logFile, {
    event: 'cycle',
    cycle: 1,
    outcome: 'idle',
    runId: state.lastRunId,
  });

  state = finalizeState(state, {
    status: 'stopped',
    stopReason: 'max-cycles',
    updatedAt: '2026-03-13T18:01:10.500Z',
  });
  writeStateFile(stateFile, state);
  appendJsonLine(logFile, {
    event: 'stop',
    cycle: state.cycle,
    stopReason: state.stopReason,
  });

  const writtenState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const logLines = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(writtenState.sourceKey, 'williamsburggreenpointhousing');
  assert.equal(writtenState.cycle, 1);
  assert.equal(writtenState.idleCycles, 1);
  assert.equal(writtenState.lastOutcome, 'idle');
  assert.equal(writtenState.lastRunId, '2026-03-13T18-01-00-000Z');
  assert.equal(writtenState.status, 'stopped');
  assert.equal(writtenState.stopReason, 'max-cycles');
  assert.equal(logLines.length, 2);
  assert.equal(logLines[0].event, 'cycle');
  assert.equal(logLines[1].event, 'stop');
});

test('notification decisions respect mode and throttle repeated important errors', () => {
  const firstError = shouldSendNotification({
    notifyMode: 'important',
    eventType: 'preflight_error',
    dedupeKey: 'preflight:mismatch',
    previousDedupeKey: null,
  });
  const repeatedError = shouldSendNotification({
    notifyMode: 'important',
    eventType: 'preflight_error',
    dedupeKey: 'preflight:mismatch',
    previousDedupeKey: firstError.nextDedupeKey,
  });
  const verboseIdle = shouldSendNotification({
    notifyMode: 'verbose',
    eventType: 'idle_cycle',
    dedupeKey: 'idle:1',
    previousDedupeKey: null,
  });
  const importantIdle = shouldSendNotification({
    notifyMode: 'important',
    eventType: 'idle_cycle',
    dedupeKey: 'idle:1',
    previousDedupeKey: null,
  });
  const notificationsOff = shouldSendNotification({
    notifyMode: 'off',
    eventType: 'fresh_cycle',
    dedupeKey: 'fresh:1',
    previousDedupeKey: null,
  });

  assert.equal(firstError.send, true);
  assert.equal(repeatedError.send, false);
  assert.equal(verboseIdle.send, true);
  assert.equal(importantIdle.send, false);
  assert.equal(notificationsOff.send, false);
});

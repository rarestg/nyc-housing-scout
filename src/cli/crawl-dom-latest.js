import path from 'node:path';
import { DOM_EXTRACTOR_FN } from '../browser/dom-extractor.js';
import { DOM_EXPAND_VISIBLE_FN, DOM_SCROLL_PAGE_FN, DOM_PAGE_STATE_FN } from '../browser/dom-helpers.js';
import {
  PRIMARY_NETWORK_CAPTURE_MODE,
  normalizeNetworkCaptureOptions,
} from '../browser/network-capture.js';
import {
  createFacebookCdpNetworkCaptureController,
  filterFacebookCdpRequestsByTimestampWindow,
} from '../browser/cdp-network-capture.js';
import {
  buildEvaluateCall,
  evaluateJson,
  hasFlag,
  readFlag,
  runBrowser,
} from '../core/browser-pipeline.js';
import {
  beginNetworkIntegrationStep,
  createWorkingSetEntry,
  createNetworkIntegrationState,
  recordAcceptedNetworkMerge,
  registerNetworkCandidates,
  registerResolvedPostForReuse,
  resolveWorkingSetEntries,
} from './crawl-dom-latest.network-integration.js';
import {
  accumulateNetworkDrainCompletionResult,
  buildCrawlStepReport,
  buildNetworkCaptureFinalizationResult,
  createNetworkCaptureBootstrapPlan,
  createNetworkCaptureSessionState,
  createCrawlStepAdvancePlan,
  createEmptyNetworkDrainResult,
  createNetworkDrainOperationResult,
  createPinnedBrowserSession,
} from './crawl-dom-latest.step-helpers.js';
import { prepareArtifactLayers, writeRawArtifact, writeRunArtifact } from '../core/artifacts.js';
import {
  buildCollectedPostArtifactId,
  choosePreferredCollectedPost,
  createCollectedPost,
  getCollectedIdentityAliases,
  getCollectedPostKey,
} from '../core/collected-post.js';
import { createStorage } from '../storage/storage.js';
import { readSourceOptions } from '../storage/source-config.js';

const args = process.argv.slice(2);
if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
  printUsage(0);
}

if (hasFlag(args, '--network-capture-mode')) {
  printUsage(
    1,
    '--network-capture-mode has been removed. crawl:dom now uses CDP-only network capture. Use --disable-network-capture to turn network assist off.',
  );
}

const target = Number(readFlag(args, '--target', '20'));
const maxScrolls = Number(readFlag(args, '--max-scrolls', '20'));
const profile = readFlag(args, '--browser-profile', 'chrome');
const networkCaptureEnabled = !hasFlag(args, '--disable-network-capture');
const navigateBeforeCrawl = hasFlag(args, '--navigate-before-crawl');
const sourceOptions = readSourceOptions(readFlag, args, {
  platform: 'facebook',
  sourceType: 'group',
});
const outDir = path.resolve(process.cwd(), 'data');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const storage = createStorage({ dataDir: outDir });
const source = storage.getOrCreateSource({
  ...sourceOptions,
  browserProfile: profile,
});
const sourceUrl = source.externalUrl || sourceOptions.externalUrl || null;
const run = storage.beginRun({
  runId,
  sourceId: source.id,
  runKind: 'crawl',
  targetFresh: target,
  maxScrolls,
  browserProfile: profile,
  captureMethod: 'dom',
  metadata: {
    cli: 'crawl-dom-latest',
  },
});
const artifactLayers = prepareArtifactLayers({
  outDir,
  platform: source.platform,
  sourceKey: source.sourceKey,
  runId: run.id,
});
const networkCaptureOptions = normalizeNetworkCaptureOptions({
  targetGroupIds: readFlag(args, '--network-target-group-ids', readFlag(args, '--network-target-group-id', '')),
  maxBufferedEnvelopes: readFlag(args, '--network-max-buffered', undefined),
  maxRequestChars: readFlag(args, '--network-max-request-chars', undefined),
  maxVariablesChars: readFlag(args, '--network-max-variables-chars', undefined),
  maxResponsePreviewChars: readFlag(args, '--network-max-response-preview-chars', undefined),
  maxFullResponseChars: readFlag(args, '--network-max-full-response-chars', undefined),
  maxHighSignalFullResponseChars: readFlag(args, '--network-max-high-signal-full-response-chars', undefined),
  maxFullTextEnvelopes: readFlag(args, '--network-max-full-text-envelopes', undefined),
  maxMatchedFragments: readFlag(args, '--network-max-matched-fragments', undefined),
  maxFragmentChars: readFlag(args, '--network-max-fragment-chars', undefined),
});
const networkDrainMaxItems = Number(readFlag(
  args,
  '--network-drain-max-items',
  String(networkCaptureOptions.maxBufferedEnvelopes),
));
const maxPersistedNetworkEnvelopes = Number(readFlag(
  args,
  '--network-max-persisted',
  String(Math.max(networkCaptureOptions.maxBufferedEnvelopes, 120)),
));
const networkLateDrainSafetyCap = 5;
const collected = new Map();
const collectedIdentityAliases = new Map();
const stepLog = [];
const counters = {
  fresh: 0,
  seen: 0,
  unidentified: 0,
};
const capturedAt = new Date().toISOString();
const networkCapture = createNetworkCaptureSessionState({
  enabled: networkCaptureEnabled,
  options: networkCaptureOptions,
});
const networkCaptureBootstrap = createNetworkCaptureBootstrapPlan({
  enabled: networkCapture.enabled,
  navigateBeforeCrawl,
});
const networkIntegration = createNetworkIntegrationState(networkCapture.enabled);
const pinnedBrowser = createPinnedBrowserSession({
  browserProfile: profile,
  getTargetId: () => networkCapture.controller?.getTargetId?.() || networkCapture.targetId || null,
  runBrowserCommand: runBrowser,
  evaluateJsonCommand: evaluateJson,
});

function refreshInstalledNetworkCaptureState() {
  if (!networkCapture.controller) {
    return;
  }

  networkCapture.installed = networkCapture.controller.getInstalledSummary();
  networkCapture.startup = networkCapture.installed.startup || networkCapture.startup;
  networkCapture.targetId = networkCapture.installed.targetId || networkCapture.targetId || null;
}

async function syncNetworkCaptureControllerState({ waitForIdle = false, idleMs = 100 } = {}) {
  if (!networkCapture.controller) {
    return;
  }

  if (waitForIdle) {
    await waitForNetworkCaptureIdle(idleMs);
  }

  refreshInstalledNetworkCaptureState();
  networkCapture.graphQlRequests = networkCapture.controller.getGraphQlRequests();
}

function disableNetworkCapture(stage, transport, error, note = null) {
  networkCapture.error = {
    stage,
    transport,
    message: error instanceof Error ? error.message : String(error),
    ...(note ? { note } : {}),
  };
  networkCapture.enabled = false;
  networkIntegration.enabled = false;
}

async function installNetworkCaptureTransport() {
  if (!networkCaptureBootstrap.shouldInstall) {
    return;
  }

  try {
    networkCapture.controller = await createFacebookCdpNetworkCaptureController({
      profileName: profile,
      rawOptions: networkCapture.options,
      preferredUrl: sourceUrl,
    });
    networkCapture.transport = PRIMARY_NETWORK_CAPTURE_MODE;
    await syncNetworkCaptureControllerState();
  } catch (error) {
    disableNetworkCapture(
      'install',
      PRIMARY_NETWORK_CAPTURE_MODE,
      error,
      'rerun with --disable-network-capture to continue without network-assisted recovery',
    );
  }
}

function resolveWorkingSet(workingSet, stepIndex, options = {}) {
  if (!networkIntegration.enabled) {
    return workingSet;
  }

  return resolveWorkingSetEntries(networkIntegration, workingSet, stepIndex, options);
}

function stageResolvedPostsForReuse(workingSet, stepIndex) {
  if (!networkIntegration.enabled) return;

  for (const entry of workingSet) {
    if (!entry?.post || (!entry.post.postId && !entry.post.postUrl)) {
      continue;
    }

    registerResolvedPostForReuse(networkIntegration, entry.post, {
      candidate: entry.post,
      captureMode: 'dom_identity',
      stepIndex,
      capturePhase: 'dom-extract',
      entryKey: entry.post.postId || entry.post.postUrl || getCollectedPostKey(entry.post),
    });
  }
}

function summarizeWorkingSetIdentity(workingSet) {
  let withIdentity = 0;

  for (const entry of workingSet) {
    if (entry?.post?.postId || entry?.post?.postUrl) {
      withIdentity += 1;
    }
  }

  return {
    withIdentity,
    unresolved: Math.max(0, workingSet.length - withIdentity),
  };
}

function createDomCollectedPost(rawPost) {
  return createCollectedPost(rawPost, {
    platform: source.platform,
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt,
  });
}

function createWorkingSetForVisiblePosts(visiblePosts, stepIndex) {
  const workingSet = (Array.isArray(visiblePosts) ? visiblePosts : []).map((rawPost) => createWorkingSetEntry(
    rawPost,
    createDomCollectedPost(rawPost),
    stepIndex,
  ));
  const provisionalBeforeResolution = workingSet.filter(
    (entry) => !entry.post.postId && !entry.post.postUrl,
  ).length;

  return {
    workingSet,
    provisionalBeforeResolution,
  };
}

async function waitForNetworkCaptureIdle(delayMs = 100) {
  if (!networkCapture.controller) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
    }
    return {
      timedOut: false,
      pendingRequests: 0,
      inFlightBodyReads: 0,
      bufferedItems: 0,
      idleForMs: delayMs,
    };
  }

  return networkCapture.controller.waitForIdle({
    idleMs: Math.max(0, delayMs),
    timeoutMs: Math.max(1500, delayMs * 10),
  });
}

function isStartupNetworkPhase(phase) {
  return String(phase || '').startsWith('startup-after-navigate');
}

function drainInstalledNetworkCapture() {
  if (!networkCapture.controller) {
    return {
      items: [],
      remaining: 0,
      remainingBuffered: 0,
      pendingRequests: 0,
      inFlightBodyReads: 0,
      stats: null,
    };
  }

  return networkCapture.controller.drain({
    clear: true,
    maxItems: networkDrainMaxItems,
  });
}

function recordDrainedNetworkItems(stepIndex, phase, drainedItems) {
  const items = Array.isArray(drainedItems)
    ? drainedItems.map((item) => ({
      stepIndex,
      capturePhase: phase,
      ...item,
    }))
    : [];

  networkCapture.items.push(...items);
  if (isStartupNetworkPhase(phase) && items.length) {
    networkCapture.startupItems.push(...items);
  }

  while (networkCapture.items.length > maxPersistedNetworkEnvelopes) {
    networkCapture.items.shift();
    networkCapture.persistedDrops += 1;
  }

  return items;
}

async function drainNetworkCapture(stepIndex, phase) {
  if (!networkCapture.enabled) {
    return createNetworkDrainOperationResult({
      stepIndex,
      phase,
    });
  }

  try {
    const settled = await waitForNetworkCaptureIdle();
    const drained = drainInstalledNetworkCapture();
    const items = recordDrainedNetworkItems(stepIndex, phase, drained?.items);
    const normalizedCandidates = registerNetworkCandidates(networkIntegration, items, stepIndex);
    const drainResult = createNetworkDrainOperationResult({
      stepIndex,
      phase,
      settled,
      drained,
      capturedThisDrain: items.length,
      normalizedCandidates,
    });

    networkCapture.drains.push(drainResult);
    networkCapture.finalStats = drainResult.stats ?? networkCapture.finalStats;
    await syncNetworkCaptureControllerState();

    return drainResult;
  } catch (error) {
    networkCapture.error = {
      stage: 'drain',
      transport: networkCapture.transport || null,
      stepIndex,
      phase,
      message: error instanceof Error ? error.message : String(error),
    };
    networkCapture.enabled = false;
    networkIntegration.enabled = false;
    return createNetworkDrainOperationResult({
      stepIndex,
      phase,
    });
  }
}

async function drainNetworkCaptureToCompletion(stepIndex, initialPhase) {
  if (!networkCapture.enabled) {
    return createEmptyNetworkDrainResult();
  }

  let completion = createEmptyNetworkDrainResult();

  for (let pass = 0; pass < networkLateDrainSafetyCap; pass += 1) {
    const phase = pass === 0
      ? initialPhase
      : `${initialPhase}-continue-${pass}`;
    const drained = await drainNetworkCapture(stepIndex, phase);

    completion = accumulateNetworkDrainCompletionResult(completion, drained);
    if (!networkCapture.enabled || !drained.remaining) {
      break;
    }
  }

  return completion;
}

function findCollectedEntryKey(post) {
  for (const alias of getCollectedIdentityAliases(post)) {
    const existingKey = collectedIdentityAliases.get(alias);
    if (existingKey) {
      return existingKey;
    }
  }

  const fallbackKey = getCollectedPostKey(post);
  if (collected.has(fallbackKey)) {
    return fallbackKey;
  }

  return null;
}

function registerCollectedEntry(key, post) {
  const preferred = choosePreferredCollectedPost(collected.get(key), post);
  collected.set(key, preferred);

  for (const alias of getCollectedIdentityAliases(preferred)) {
    collectedIdentityAliases.set(alias, key);
  }

  return preferred;
}

function createPersistedWorkingSetEntries(workingSet) {
  const persistedEntries = [];

  for (const entry of workingSet) {
    const existingKey = findCollectedEntryKey(entry.post);
    if (existingKey) {
      registerCollectedEntry(existingKey, entry.post);
      continue;
    }

    const key = getCollectedPostKey(entry.post);
    const rawArtifact = writeRawArtifact(artifactLayers.rawDir, buildCollectedPostArtifactId(entry.post), entry.rawPost);
    entry.post.rawArtifactPath = rawArtifact.relativePath;
    registerCollectedEntry(key, entry.post);
    persistedEntries.push({
      entry,
      rawArtifact,
    });
  }

  return persistedEntries;
}

function recordStepObservations(stepIndex, persistedEntries) {
  if (!persistedEntries.length) {
    return [];
  }

  return storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    stepIndex,
    entries: persistedEntries.map(({ entry, rawArtifact }) => ({
      post: entry.post,
      rawArtifact: {
        ...rawArtifact,
        artifactKind: 'raw_post_payload',
        metadata: {
          captureIndex: entry.post.captureIndex,
        },
      },
    })),
  });
}

function persistWorkingSetStep(stepResult) {
  const persistedEntries = createPersistedWorkingSetEntries(stepResult.workingSet);
  const observationResults = recordStepObservations(stepResult.stepIndex, persistedEntries);
  let addedCount = 0;
  let freshCount = 0;
  let seenCount = 0;
  let unidentifiedCount = 0;
  let networkMergedThisStep = 0;
  let networkRecoveredThisStep = 0;

  for (let index = 0; index < persistedEntries.length; index += 1) {
    const { entry } = persistedEntries[index];
    const result = observationResults[index];
    if (!result) {
      continue;
    }

    addedCount += 1;

    if (entry.mergeResult) {
      recordAcceptedNetworkMerge(networkIntegration, entry.mergeResult);
      networkMergedThisStep += 1;
      if (entry.mergeResult.recoveredIdentity && (entry.post.postId || entry.post.postUrl)) {
        networkRecoveredThisStep += 1;
      }
    }

    counters[result.freshness] += 1;

    if (result.freshness === 'fresh') {
      freshCount += 1;
    } else if (result.freshness === 'seen') {
      seenCount += 1;
    } else {
      unidentifiedCount += 1;
    }

    if (entry.post.postId || entry.post.postUrl) {
      registerResolvedPostForReuse(networkIntegration, entry.post, {
        candidate: entry.post,
        captureId: entry.mergeResult?.matchSummary?.captureId || null,
        captureMode: entry.mergeResult?.matchSummary?.captureMode || 'persisted_post',
        retentionReason: entry.mergeResult?.matchSummary?.retentionReason || null,
        stepIndex: stepResult.stepIndex,
        capturePhase: entry.post.captureHints?.networkEnrichment?.matchedPhase || 'persisted',
        entryKey: entry.post.postId || entry.post.postUrl || getCollectedPostKey(entry.post),
      });
    }
  }

  return {
    ...stepResult,
    addedCount,
    freshCount,
    seenCount,
    unidentifiedCount,
    networkMergedThisStep,
    networkRecoveredThisStep,
    totals: {
      ...counters,
    },
  };
}

async function executeCrawlStep(stepIndex) {
  beginNetworkIntegrationStep(networkIntegration, stepIndex);

  const expandResult = pinnedBrowser.evaluate(DOM_EXPAND_VISIBLE_FN);
  pinnedBrowser.run(['wait', '--browser-profile', profile, '--time', '700']);
  const pageStateBefore = pinnedBrowser.evaluate(DOM_PAGE_STATE_FN);
  const visible = pinnedBrowser.evaluate(DOM_EXTRACTOR_FN);
  const { workingSet: initialWorkingSet, provisionalBeforeResolution } = createWorkingSetForVisiblePosts(visible, stepIndex);

  stageResolvedPostsForReuse(initialWorkingSet, stepIndex);

  const afterExpandDrain = await drainNetworkCapture(stepIndex, 'after-expand');
  const resolvedWorkingSet = resolveWorkingSet(initialWorkingSet, stepIndex);
  const advancePlan = createCrawlStepAdvancePlan({
    freshCollected: counters.fresh,
    target,
    stepIndex,
    maxScrolls,
  });
  let scrollResult = null;

  if (advancePlan.shouldScroll) {
    const scrollFn = buildEvaluateCall(DOM_SCROLL_PAGE_FN, 1200);
    scrollResult = pinnedBrowser.evaluate(scrollFn);
  }

  pinnedBrowser.run(['wait', '--browser-profile', profile, '--time', String(advancePlan.waitMs)]);
  const lateDrain = await drainNetworkCaptureToCompletion(stepIndex, advancePlan.lateDrainPhase);
  const stoppedReason = advancePlan.shouldScroll && scrollResult?.after <= scrollResult?.before
    ? 'scroll did not advance'
    : advancePlan.stoppedReason;
  const finalizedWorkingSet = resolveWorkingSet(resolvedWorkingSet, stepIndex, {
    onlyWithoutIdentity: true,
    skipMatched: true,
  });

  return {
    runId: run.id,
    sourceId: source.id,
    stepIndex,
    expandedCount: expandResult.clickedCount,
    visiblePosts: Array.isArray(visible) ? visible.length : 0,
    workingSet: finalizedWorkingSet,
    provisionalBeforeResolution,
    identitySummary: summarizeWorkingSetIdentity(finalizedWorkingSet),
    stoppedReason,
    page: {
      scrollY: scrollResult?.after ?? pageStateBefore.scrollY,
      bodyHeight: scrollResult?.bodyHeight ?? pageStateBefore.bodyHeight,
      pageHref: pageStateBefore.href,
      pageTitle: pageStateBefore.title,
    },
    networkDrains: {
      startup: stepIndex === 0 ? startupNetworkDrain : createEmptyNetworkDrainResult(),
      afterExpand: afterExpandDrain,
      late: lateDrain,
    },
  };
}

async function captureStartupNetworkWindow() {
  beginNetworkIntegrationStep(networkIntegration, 0);
  const startupDrain = await drainNetworkCaptureToCompletion(0, 'startup-after-navigate');
  const captureCompletedAt = new Date().toISOString();

  networkCapture.startup = {
    ...(networkCapture.startup || {}),
    captureCompletedAt,
  };
  await syncNetworkCaptureControllerState();
  networkCapture.startupGraphQlRequests = filterFacebookCdpRequestsByTimestampWindow(
    networkCapture.graphQlRequests,
    {
      startTimestamp: networkCapture.startup.navigationRequestedAt,
      endTimestamp: captureCompletedAt,
    },
  );

  return startupDrain;
}

async function navigateBeforeCrawlIfRequested() {
  const { startupNavigation } = networkCaptureBootstrap;
  if (!startupNavigation.requested) {
    return createEmptyNetworkDrainResult();
  }

  if (startupNavigation.requiresSourceUrl && !sourceUrl) {
    throw new Error('--navigate-before-crawl requires --source-url');
  }

  const navigationRequestedAt = new Date().toISOString();
  if (startupNavigation.armsCaptureBeforeNavigation && networkCapture.controller) {
    networkCapture.controller.noteNavigationStart({
      fromUrl: networkCapture.installed?.startup?.initialUrl || null,
      toUrl: sourceUrl,
    }, navigationRequestedAt);
  }

  pinnedBrowser.run(['navigate', '--browser-profile', profile, sourceUrl]);
  pinnedBrowser.run(['wait', '--browser-profile', profile, '--load', 'domcontentloaded']);
  pinnedBrowser.run(['wait', '--browser-profile', profile, '--time', '2500']);

  const navigationCompletedAt = new Date().toISOString();
  if (startupNavigation.armsCaptureBeforeNavigation && networkCapture.controller) {
    networkCapture.controller.noteNavigationComplete({
      url: sourceUrl,
    }, navigationCompletedAt);
    await syncNetworkCaptureControllerState();
    return captureStartupNetworkWindow();
  }

  return createEmptyNetworkDrainResult();
}

async function bootstrapCollectorSession() {
  await installNetworkCaptureTransport();
  return navigateBeforeCrawlIfRequested();
}

async function finalizeNetworkCaptureSession(startupDrain) {
  if (networkCapture.enabled) {
    networkCapture.finalArtifactDrain = await drainNetworkCaptureToCompletion(null, 'final-artifact-flush');
  }

  await syncNetworkCaptureControllerState({ waitForIdle: true });

  return buildNetworkCaptureFinalizationResult({
    runId: run.id,
    sourceKey: source.sourceKey,
    browserProfile: profile,
    navigateBeforeCrawl,
    networkCapture,
    startupDrain,
    networkIntegration,
  });
}

async function closeNetworkCaptureSession() {
  if (networkCapture.controller) {
    await networkCapture.controller.close();
  }
}

const startupNetworkDrain = await bootstrapCollectorSession();

for (let step = 0; step <= maxScrolls; step += 1) {
  const stepResult = persistWorkingSetStep(await executeCrawlStep(step));
  const stepReport = buildCrawlStepReport(stepResult);

  stepLog.push(stepReport.stepLogEntry);
  storage.appendRunStep(stepReport.runStep);

  if (stepResult.stoppedReason) {
    break;
  }
}

const results = Array.from(collected.values());
const collectedArtifact = writeRunArtifact(artifactLayers.collectedDir, 'crawl', run.id, results);
const networkCaptureFinalization = await finalizeNetworkCaptureSession(startupNetworkDrain);
const networkCaptureArtifact = writeRunArtifact(
  artifactLayers.rawDir,
  'network-capture',
  run.id,
  networkCaptureFinalization.artifact.payload,
);
const summary = {
  target,
  sourceKey: source.sourceKey,
  collected: results.length,
  freshCollected: counters.fresh,
  seenCollected: counters.seen,
  unidentifiedCollected: counters.unidentified,
  withIds: results.filter((post) => post.postId).length,
  withSeeMore: results.filter((post) => post.captureHints.hasSeeMore).length,
  networkCapture: networkCaptureFinalization.runSummary,
};

storage.finishRun({
  runId: run.id,
  status: 'completed',
  summary,
  exports: [
    {
      ...collectedArtifact,
      artifactKind: 'collected_export',
      metadata: { records: results.length },
    },
    {
      ...networkCaptureArtifact,
      artifactKind: 'network_capture_export',
      metadata: networkCaptureFinalization.artifact.metadata,
    },
  ],
});

const outputPayload = {
  runId: run.id,
  ...summary,
  rawArtifactDir: path.relative(process.cwd(), artifactLayers.rawDir),
  collectedArtifact: collectedArtifact.relativePath,
  networkCaptureArtifact: networkCaptureArtifact.relativePath,
  networkCapture: networkCaptureFinalization.outputSummary,
  stepLog,
  postIds: results.map((post) => post.postId).filter(Boolean),
};

await closeNetworkCaptureSession();

console.log(JSON.stringify(outputPayload, null, 2));

function printUsage(exitCode, message) {
  if (message) {
    console.error(message);
    console.error('');
  }

  console.error(`Usage:
  node src/cli/crawl-dom-latest.js --source-key <key> [options]

Options:
  --browser-profile <profile>               Defaults to chrome.
  --target <n>                              Defaults to 20.
  --max-scrolls <n>                         Defaults to 20.
  --disable-network-capture                 Disable GraphQL-assisted recovery entirely.
  --navigate-before-crawl                   Arm CDP before navigation; remains explicit and only changes CDP startup capture.
  --network-target-group-id <id>            Filter capture toward one Facebook group id.

Notes:
  crawl:dom uses CDP-only network capture when network assist is enabled.
  If CDP is unavailable, rerun with --disable-network-capture to continue without network-assisted recovery.`);

  process.exit(exitCode);
}

import path from 'node:path';
import { DOM_EXTRACTOR_FN } from '../browser/dom-extractor.js';
import { DOM_EXPAND_VISIBLE_FN, DOM_SCROLL_PAGE_FN, DOM_PAGE_STATE_FN } from '../browser/dom-helpers.js';
import {
  createFacebookNetworkCaptureDrainFn,
  createFacebookNetworkCaptureInstallFn,
  normalizeNetworkCaptureOptions,
  summarizeFacebookNetworkCapture,
} from '../browser/network-capture.js';
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
import { prepareArtifactLayers, writeRawArtifact, writeRunArtifact } from '../core/artifacts.js';
import {
  buildCollectedPostArtifactId,
  choosePreferredCollectedPost,
  createCollectedPost,
  getCollectedIdentityAliases,
  getCollectedPostKey,
} from '../core/collected-post.js';
import { extractListingsFromPost } from '../extractors/text-extractor.js';
import { createStorage } from '../storage/storage.js';
import { readSourceOptions } from '../storage/source-config.js';

const args = process.argv.slice(2);
const target = Number(readFlag(args, '--target', '20'));
const maxScrolls = Number(readFlag(args, '--max-scrolls', '20'));
const profile = readFlag(args, '--browser-profile', 'chrome');
const networkCaptureEnabled = !hasFlag(args, '--disable-network-capture');
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
const listings = [];
const stepLog = [];
const counters = {
  fresh: 0,
  seen: 0,
  unidentified: 0,
};
const capturedAt = new Date().toISOString();
const networkCapture = {
  enabled: networkCaptureEnabled,
  options: networkCaptureOptions,
  installed: null,
  error: null,
  drains: [],
  items: [],
  finalStats: null,
  persistedDrops: 0,
};
const networkIntegration = createNetworkIntegrationState(networkCaptureEnabled);

if (networkCapture.enabled) {
  try {
    networkCapture.installed = evaluateJson(createFacebookNetworkCaptureInstallFn(networkCapture.options), profile);
  } catch (error) {
    networkCapture.error = {
      stage: 'install',
      message: error instanceof Error ? error.message : String(error),
    };
    networkCapture.enabled = false;
    networkIntegration.enabled = false;
  }
}

function drainNetworkCapture(stepIndex, phase) {
  if (!networkCapture.enabled) {
    return { capturedThisDrain: 0, normalizedCandidates: 0, remaining: 0, stats: null };
  }

  try {
    const drained = evaluateJson(createFacebookNetworkCaptureDrainFn({
      clear: true,
      maxItems: networkDrainMaxItems,
    }), profile);
    const items = Array.isArray(drained?.items)
      ? drained.items.map((item) => ({
        stepIndex,
        capturePhase: phase,
        ...item,
      }))
      : [];

    networkCapture.drains.push({
      stepIndex,
      phase,
      capturedThisDrain: items.length,
      remaining: drained?.remaining ?? 0,
      stats: drained?.stats ?? null,
    });
    networkCapture.finalStats = drained?.stats ?? networkCapture.finalStats;
    networkCapture.items.push(...items);
    const normalizedCandidates = registerNetworkCandidates(networkIntegration, items, stepIndex);

    while (networkCapture.items.length > maxPersistedNetworkEnvelopes) {
      networkCapture.items.shift();
      networkCapture.persistedDrops += 1;
    }

    return {
      capturedThisDrain: items.length,
      normalizedCandidates,
      remaining: drained?.remaining ?? 0,
      stats: drained?.stats ?? null,
    };
  } catch (error) {
    networkCapture.error = {
      stage: 'drain',
      stepIndex,
      phase,
      message: error instanceof Error ? error.message : String(error),
    };
    networkCapture.enabled = false;
    networkIntegration.enabled = false;
    return { capturedThisDrain: 0, normalizedCandidates: 0, remaining: 0, stats: null };
  }
}

function drainNetworkCaptureToCompletion(stepIndex, initialPhase) {
  if (!networkCapture.enabled) {
    return {
      capturedThisDrain: 0,
      normalizedCandidates: 0,
      remaining: 0,
      stats: null,
      passes: 0,
    };
  }

  let capturedThisDrain = 0;
  let normalizedCandidates = 0;
  let remaining = 0;
  let stats = null;
  let passes = 0;

  for (let pass = 0; pass < networkLateDrainSafetyCap; pass += 1) {
    const phase = pass === 0
      ? initialPhase
      : `${initialPhase}-continue-${pass}`;
    const drained = drainNetworkCapture(stepIndex, phase);

    capturedThisDrain += drained.capturedThisDrain;
    normalizedCandidates += drained.normalizedCandidates;
    remaining = drained.remaining;
    stats = drained.stats ?? stats;
    passes += 1;

    if (!networkCapture.enabled || !remaining || drained.capturedThisDrain <= 0) {
      break;
    }
  }

  return {
    capturedThisDrain,
    normalizedCandidates,
    remaining,
    stats,
    passes,
  };
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

for (let step = 0; step <= maxScrolls; step += 1) {
  beginNetworkIntegrationStep(networkIntegration, step);
  const expandResult = evaluateJson(DOM_EXPAND_VISIBLE_FN, profile);
  runBrowser(['wait', '--browser-profile', profile, '--time', '700']);
  const pageStateBefore = evaluateJson(DOM_PAGE_STATE_FN, profile);
  const visible = evaluateJson(DOM_EXTRACTOR_FN, profile);
  let workingSet = visible.map((rawPost) => createWorkingSetEntry(
    rawPost,
    createCollectedPost(rawPost, {
      platform: source.platform,
      sourceKey: source.sourceKey,
      groupName: source.displayName,
      captureMethod: 'dom',
      captureRunId: run.id,
      capturedAt,
    }),
    step,
  ));
  const provisionalBeforeResolution = workingSet.filter(
    (entry) => !entry.post.postId && !entry.post.postUrl,
  ).length;

  stageResolvedPostsForReuse(workingSet, step);

  const networkDrain = drainNetworkCapture(step, 'after-expand');
  workingSet = resolveWorkingSet(workingSet, step);

  let scrollResult = null;
  let lateNetworkDrain = {
    capturedThisDrain: 0,
    normalizedCandidates: 0,
    remaining: 0,
    stats: null,
    passes: 0,
  };
  let stoppedReason = null;

  if (counters.fresh >= target) {
    runBrowser(['wait', '--browser-profile', profile, '--time', '1200']);
    lateNetworkDrain = drainNetworkCaptureToCompletion(step, 'before-target-stop');
    stoppedReason = 'target reached';
  } else if (step >= maxScrolls) {
    runBrowser(['wait', '--browser-profile', profile, '--time', '1200']);
    lateNetworkDrain = drainNetworkCaptureToCompletion(step, 'before-finalize');
    stoppedReason = 'max scrolls reached';
  } else {
    const scrollFn = buildEvaluateCall(DOM_SCROLL_PAGE_FN, 1200);
    scrollResult = evaluateJson(scrollFn, profile);
    runBrowser(['wait', '--browser-profile', profile, '--time', '1200']);
    lateNetworkDrain = drainNetworkCaptureToCompletion(step, 'after-scroll');

    if (scrollResult.after <= scrollResult.before) {
      stoppedReason = 'scroll did not advance';
    }
  }

  workingSet = resolveWorkingSet(workingSet, step, {
    onlyWithoutIdentity: true,
    skipMatched: true,
  });
  if (!stoppedReason && counters.fresh >= target) {
    stoppedReason = 'target reached';
  }

  const identitySummary = summarizeWorkingSetIdentity(workingSet);
  let addedThisRound = 0;
  let freshThisRound = 0;
  let seenThisRound = 0;
  let unidentifiedThisRound = 0;
  let networkMergedThisRound = 0;
  let networkRecoveredThisRound = 0;
  const listingRecords = [];
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

  const observationResults = persistedEntries.length
    ? storage.recordObservationBatch({
      runId: run.id,
      sourceId: source.id,
      stepIndex: step,
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
    })
    : [];

  for (let index = 0; index < persistedEntries.length; index += 1) {
    const { entry } = persistedEntries[index];
    const result = observationResults[index];
    if (!result) {
      continue;
    }

    addedThisRound += 1;

    if (entry.mergeResult) {
      recordAcceptedNetworkMerge(networkIntegration, entry.mergeResult);
      networkMergedThisRound += 1;
      if (entry.mergeResult.recoveredIdentity && (entry.post.postId || entry.post.postUrl)) {
        networkRecoveredThisRound += 1;
      }
    }

    counters[result.freshness] += 1;

    if (result.freshness === 'fresh') {
      freshThisRound += 1;
      const extracted = extractListingsFromPost(entry.post);
      listings.push(...extracted);
      listingRecords.push({
        observationId: result.observation.id,
        listings: extracted,
      });
    } else if (result.freshness === 'seen') {
      seenThisRound += 1;
    } else {
      unidentifiedThisRound += 1;
    }

    if (entry.post.postId || entry.post.postUrl) {
      registerResolvedPostForReuse(networkIntegration, entry.post, {
        candidate: entry.post,
        captureId: entry.mergeResult?.matchSummary?.captureId || null,
        captureMode: entry.mergeResult?.matchSummary?.captureMode || 'persisted_post',
        retentionReason: entry.mergeResult?.matchSummary?.retentionReason || null,
        stepIndex: step,
        capturePhase: entry.post.captureHints?.networkEnrichment?.matchedPhase || 'persisted',
        entryKey: entry.post.postId || entry.post.postUrl || getCollectedPostKey(entry.post),
      });
    }
  }

  stepLog.push({
    step,
    expanded: expandResult.clickedCount,
    visiblePosts: visible.length,
    addedThisRound,
    freshThisRound,
    seenThisRound,
    unidentifiedThisRound,
    networkCandidatesThisStep: networkDrain.normalizedCandidates + lateNetworkDrain.normalizedCandidates,
    networkMergedThisStep: networkMergedThisRound,
    networkRecoveredThisStep: networkRecoveredThisRound,
    provisionalBeforeResolution,
    withIdentityOnFinalize: identitySummary.withIdentity,
    unresolvedProvisionalOnFinalize: identitySummary.unresolved,
    lateDrainPasses: lateNetworkDrain.passes,
    freshCollected: counters.fresh,
    seenCollected: counters.seen,
    unidentifiedCollected: counters.unidentified,
    networkCapturedThisStep: networkDrain.capturedThisDrain + lateNetworkDrain.capturedThisDrain,
    networkCapturedAfterExpand: networkDrain.capturedThisDrain,
    networkCapturedAfterLateDrain: lateNetworkDrain.capturedThisDrain,
    remainingBufferedOnFinalize: lateNetworkDrain.remaining || 0,
    scrollY: scrollResult?.after ?? pageStateBefore.scrollY,
    bodyHeight: scrollResult?.bodyHeight ?? pageStateBefore.bodyHeight,
    pageHref: pageStateBefore.href,
    pageTitle: pageStateBefore.title,
    stoppedReason,
  });

  if (listingRecords.length) {
    storage.recordListingsBatch({
      runId: run.id,
      sourceId: source.id,
      records: listingRecords,
      extractorVersion: 'text-extractor-v1',
    });
  }

  storage.appendRunStep({
    runId: run.id,
    sourceId: source.id,
    stepIndex: step,
    expandedCount: expandResult.clickedCount,
    visiblePosts: visible.length,
    addedCount: addedThisRound,
    freshCount: freshThisRound,
    seenCount: seenThisRound,
    unidentifiedCount: unidentifiedThisRound,
    freshCollected: counters.fresh,
    seenCollected: counters.seen,
    unidentifiedCollected: counters.unidentified,
    scrollY: scrollResult?.after ?? pageStateBefore.scrollY,
    bodyHeight: scrollResult?.bodyHeight ?? pageStateBefore.bodyHeight,
    pageHref: pageStateBefore.href,
    pageTitle: pageStateBefore.title,
    stoppedReason,
    metadata: {
      networkCapture: {
        capturedThisStep: networkDrain.capturedThisDrain + lateNetworkDrain.capturedThisDrain,
        capturedAfterExpand: networkDrain.capturedThisDrain,
        capturedAfterLateDrain: lateNetworkDrain.capturedThisDrain,
        normalizedCandidatesThisStep: networkDrain.normalizedCandidates + lateNetworkDrain.normalizedCandidates,
        normalizedCandidatesAfterExpand: networkDrain.normalizedCandidates,
        normalizedCandidatesAfterLateDrain: lateNetworkDrain.normalizedCandidates,
        mergedThisStep: networkMergedThisRound,
        recoveredIdentityThisStep: networkRecoveredThisRound,
        provisionalBeforeResolution,
        withIdentityOnFinalize: identitySummary.withIdentity,
        unresolvedProvisionalOnFinalize: identitySummary.unresolved,
        lateDrainPasses: lateNetworkDrain.passes,
        remainingBuffered: lateNetworkDrain.remaining || 0,
      },
    },
  });

  if (stoppedReason) {
    break;
  }
}

const results = Array.from(collected.values());
const collectedArtifact = writeRunArtifact(artifactLayers.collectedDir, 'crawl', run.id, results);
const listingsArtifact = writeRunArtifact(artifactLayers.listingsDir, 'crawl', run.id, listings);
const networkCaptureSummary = summarizeFacebookNetworkCapture(networkCapture.items);
const networkIntegrationSummary = {
  enabled: networkIntegration.enabled && (networkCapture.enabled || Boolean(networkCapture.installed)),
  candidatesExtracted: networkIntegration.candidatesExtracted,
  pooledCandidates: networkIntegration.pooledCandidates,
  replacedCandidates: networkIntegration.replacedCandidates,
  parseErrors: networkIntegration.parseErrors.length,
  mergedPosts: networkIntegration.mergedPosts,
  recoveredIdentityCount: networkIntegration.recoveredIdentityCount,
  mergedWithExactIdentity: networkIntegration.mergedWithExactIdentity,
  fullTextMatches: networkIntegration.fullTextMatches,
  fragmentMatches: networkIntegration.fragmentMatches,
  recentMatches: networkIntegration.matches.slice(-20),
};
const networkCaptureArtifact = writeRunArtifact(artifactLayers.rawDir, 'network-capture', run.id, {
  runId: run.id,
  sourceKey: source.sourceKey,
  browserProfile: profile,
  enabled: networkCapture.enabled || Boolean(networkCapture.installed),
  options: networkCapture.options,
  installed: networkCapture.installed,
  error: networkCapture.error,
  drains: networkCapture.drains,
  persistedDrops: networkCapture.persistedDrops,
  finalDrain: networkCapture.drains.length ? networkCapture.drains[networkCapture.drains.length - 1] : null,
  finalStats: networkCapture.finalStats,
  summary: networkCaptureSummary,
  integration: {
    ...networkIntegrationSummary,
    parseErrors: networkIntegration.parseErrors,
  },
  items: networkCapture.items,
});
const summary = {
  target,
  sourceKey: source.sourceKey,
  collected: results.length,
  freshCollected: counters.fresh,
  seenCollected: counters.seen,
  unidentifiedCollected: counters.unidentified,
  extractedListings: listings.length,
  withIds: results.filter((post) => post.postId).length,
  withSeeMore: results.filter((post) => post.captureHints.hasSeeMore).length,
  networkCapture: {
    enabled: networkCapture.enabled || Boolean(networkCapture.installed),
    captured: networkCaptureSummary.capturedCount,
    withTargetGroupId: networkCaptureSummary.withTargetGroupId,
    withPostIds: networkCaptureSummary.withPostIds,
    withStoryIds: networkCaptureSummary.withStoryIds,
    withFeedbackIds: networkCaptureSummary.withFeedbackIds,
    persistedDrops: networkCapture.persistedDrops,
    topFriendlyNames: networkCaptureSummary.topFriendlyNames,
    error: networkCapture.error,
    finalStats: networkCapture.finalStats,
    integration: networkIntegrationSummary,
  },
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
      ...listingsArtifact,
      artifactKind: 'listing_export',
      metadata: { records: listings.length },
    },
    {
      ...networkCaptureArtifact,
      artifactKind: 'network_capture_export',
      metadata: {
        records: networkCaptureSummary.capturedCount,
        withPostIds: networkCaptureSummary.withPostIds,
        withStoryIds: networkCaptureSummary.withStoryIds,
        withFeedbackIds: networkCaptureSummary.withFeedbackIds,
        mergedPosts: networkIntegrationSummary.mergedPosts,
        recoveredIdentityCount: networkIntegrationSummary.recoveredIdentityCount,
      },
    },
  ],
});

console.log(JSON.stringify({
  runId: run.id,
  ...summary,
  rawArtifactDir: path.relative(process.cwd(), artifactLayers.rawDir),
  collectedArtifact: collectedArtifact.relativePath,
  listingsArtifact: listingsArtifact.relativePath,
  networkCaptureArtifact: networkCaptureArtifact.relativePath,
  networkCapture: {
    installed: networkCapture.installed,
    error: networkCapture.error,
    summary: networkCaptureSummary,
    persistedDrops: networkCapture.persistedDrops,
    finalStats: networkCapture.finalStats,
    integration: networkIntegrationSummary,
  },
  stepLog,
  postIds: results.map((post) => post.postId).filter(Boolean),
}, null, 2));

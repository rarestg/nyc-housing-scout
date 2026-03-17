import { appendBrowserTargetId } from '../core/browser-pipeline.js';
import { summarizeFacebookCdpGraphQlRequests } from '../browser/cdp-network-capture.js';
import {
  summarizeFacebookNetworkCapture,
} from '../browser/network-capture.js';

export function createNetworkCaptureSessionState({
  enabled,
  options = null,
} = {}) {
  return {
    enabled: Boolean(enabled),
    transport: null,
    targetId: null,
    options,
    controller: null,
    installed: null,
    error: null,
    drains: [],
    items: [],
    graphQlRequests: [],
    startupItems: [],
    startupGraphQlRequests: [],
    finalStats: null,
    finalArtifactDrain: null,
    persistedDrops: 0,
    startup: null,
  };
}

export function createNetworkCaptureBootstrapPlan({
  enabled,
  navigateBeforeCrawl,
} = {}) {
  const startupNavigationRequested = Boolean(navigateBeforeCrawl);

  return {
    shouldInstall: Boolean(enabled),
    startupNavigation: {
      requested: startupNavigationRequested,
      requiresSourceUrl: startupNavigationRequested,
      armsCaptureBeforeNavigation: startupNavigationRequested && Boolean(enabled),
    },
  };
}

export function createPinnedBrowserSession({
  browserProfile,
  getTargetId,
  runBrowserCommand,
  evaluateJsonCommand,
}) {
  const resolveTargetId = () => getTargetId?.() || null;

  return {
    getTargetId: resolveTargetId,
    run(browserArgs) {
      return runBrowserCommand(appendBrowserTargetId(browserArgs, resolveTargetId()));
    },
    evaluate(fn) {
      return evaluateJsonCommand(fn, browserProfile, resolveTargetId());
    },
  };
}

export function createEmptyNetworkDrainResult(overrides = {}) {
  return {
    capturedThisDrain: 0,
    normalizedCandidates: 0,
    remaining: 0,
    remainingBuffered: 0,
    pendingRequests: 0,
    inFlightBodyReads: 0,
    settleTimedOut: false,
    stats: null,
    passes: 0,
    ...overrides,
  };
}

export function createNetworkDrainOperationResult({
  stepIndex = null,
  phase = null,
  settled = null,
  drained = null,
  capturedThisDrain = Array.isArray(drained?.items) ? drained.items.length : 0,
  normalizedCandidates = 0,
} = {}) {
  return {
    stepIndex,
    phase,
    capturedThisDrain,
    normalizedCandidates,
    remaining: drained?.remaining ?? 0,
    remainingBuffered: drained?.remainingBuffered ?? 0,
    pendingRequests: drained?.pendingRequests ?? 0,
    inFlightBodyReads: drained?.inFlightBodyReads ?? 0,
    settleTimedOut: Boolean(settled?.timedOut),
    stats: drained?.stats ?? null,
  };
}

export function accumulateNetworkDrainCompletionResult(
  current = createEmptyNetworkDrainResult(),
  next = createEmptyNetworkDrainResult(),
) {
  const currentResult = createEmptyNetworkDrainResult(current);
  const nextResult = createEmptyNetworkDrainResult(next);

  return {
    capturedThisDrain: currentResult.capturedThisDrain + nextResult.capturedThisDrain,
    normalizedCandidates: currentResult.normalizedCandidates + nextResult.normalizedCandidates,
    remaining: nextResult.remaining,
    remainingBuffered: nextResult.remainingBuffered,
    pendingRequests: nextResult.pendingRequests,
    inFlightBodyReads: nextResult.inFlightBodyReads,
    settleTimedOut: currentResult.settleTimedOut || nextResult.settleTimedOut,
    stats: nextResult.stats ?? currentResult.stats,
    passes: currentResult.passes + 1,
  };
}

export function createCrawlStepAdvancePlan({ freshCollected, target, stepIndex, maxScrolls }) {
  if (freshCollected >= target) {
    return {
      shouldScroll: false,
      waitMs: 1200,
      lateDrainPhase: 'before-target-stop',
      stoppedReason: 'target reached',
    };
  }

  if (stepIndex >= maxScrolls) {
    return {
      shouldScroll: false,
      waitMs: 1200,
      lateDrainPhase: 'before-finalize',
      stoppedReason: 'max scrolls reached',
    };
  }

  return {
    shouldScroll: true,
    waitMs: 1200,
    lateDrainPhase: 'after-scroll',
    stoppedReason: null,
  };
}

export function buildCrawlStepReport(stepResult) {
  const startupDrain = stepResult?.networkDrains?.startup || createEmptyNetworkDrainResult();
  const afterExpandDrain = stepResult?.networkDrains?.afterExpand || createEmptyNetworkDrainResult();
  const lateDrain = stepResult?.networkDrains?.late || createEmptyNetworkDrainResult();
  const identitySummary = stepResult?.identitySummary || {
    withIdentity: 0,
    unresolved: 0,
  };
  const totals = stepResult?.totals || {
    fresh: 0,
    seen: 0,
    unidentified: 0,
  };
  const page = stepResult?.page || {};
  const networkCapture = {
    capturedThisStep: startupDrain.capturedThisDrain + afterExpandDrain.capturedThisDrain + lateDrain.capturedThisDrain,
    capturedBeforeExpand: startupDrain.capturedThisDrain,
    capturedAfterExpand: afterExpandDrain.capturedThisDrain,
    capturedAfterLateDrain: lateDrain.capturedThisDrain,
    normalizedCandidatesThisStep:
      startupDrain.normalizedCandidates + afterExpandDrain.normalizedCandidates + lateDrain.normalizedCandidates,
    normalizedCandidatesBeforeExpand: startupDrain.normalizedCandidates,
    normalizedCandidatesAfterExpand: afterExpandDrain.normalizedCandidates,
    normalizedCandidatesAfterLateDrain: lateDrain.normalizedCandidates,
    mergedThisStep: stepResult?.networkMergedThisStep || 0,
    recoveredIdentityThisStep: stepResult?.networkRecoveredThisStep || 0,
    provisionalBeforeResolution: stepResult?.provisionalBeforeResolution || 0,
    withIdentityOnFinalize: identitySummary.withIdentity || 0,
    unresolvedProvisionalOnFinalize: identitySummary.unresolved || 0,
    lateDrainPasses: lateDrain.passes || 0,
    remainingBuffered: lateDrain.remainingBuffered || 0,
    pendingRequests: lateDrain.pendingRequests || 0,
    inFlightBodyReads: lateDrain.inFlightBodyReads || 0,
    settleTimedOut: Boolean(lateDrain.settleTimedOut),
  };

  return {
    networkCapture,
    stepLogEntry: {
      step: stepResult.stepIndex,
      expanded: stepResult.expandedCount,
      visiblePosts: stepResult.visiblePosts,
      addedThisRound: stepResult.addedCount,
      freshThisRound: stepResult.freshCount,
      seenThisRound: stepResult.seenCount,
      unidentifiedThisRound: stepResult.unidentifiedCount,
      networkCandidatesThisStep: networkCapture.normalizedCandidatesThisStep,
      networkMergedThisStep: networkCapture.mergedThisStep,
      networkRecoveredThisStep: networkCapture.recoveredIdentityThisStep,
      provisionalBeforeResolution: networkCapture.provisionalBeforeResolution,
      withIdentityOnFinalize: networkCapture.withIdentityOnFinalize,
      unresolvedProvisionalOnFinalize: networkCapture.unresolvedProvisionalOnFinalize,
      lateDrainPasses: networkCapture.lateDrainPasses,
      freshCollected: totals.fresh,
      seenCollected: totals.seen,
      unidentifiedCollected: totals.unidentified,
      networkCapturedThisStep: networkCapture.capturedThisStep,
      networkCapturedBeforeExpand: networkCapture.capturedBeforeExpand,
      networkCapturedAfterExpand: networkCapture.capturedAfterExpand,
      networkCapturedAfterLateDrain: networkCapture.capturedAfterLateDrain,
      remainingBufferedOnFinalize: networkCapture.remainingBuffered,
      pendingNetworkRequestsOnFinalize: networkCapture.pendingRequests,
      inFlightNetworkBodyReadsOnFinalize: networkCapture.inFlightBodyReads,
      scrollY: page.scrollY ?? null,
      bodyHeight: page.bodyHeight ?? null,
      pageHref: page.pageHref ?? null,
      pageTitle: page.pageTitle ?? null,
      stoppedReason: stepResult.stoppedReason ?? null,
    },
    runStep: {
      runId: stepResult.runId,
      sourceId: stepResult.sourceId,
      stepIndex: stepResult.stepIndex,
      expandedCount: stepResult.expandedCount,
      visiblePosts: stepResult.visiblePosts,
      addedCount: stepResult.addedCount,
      freshCount: stepResult.freshCount,
      seenCount: stepResult.seenCount,
      unidentifiedCount: stepResult.unidentifiedCount,
      freshCollected: totals.fresh,
      seenCollected: totals.seen,
      unidentifiedCollected: totals.unidentified,
      scrollY: page.scrollY ?? null,
      bodyHeight: page.bodyHeight ?? null,
      pageHref: page.pageHref ?? null,
      pageTitle: page.pageTitle ?? null,
      stoppedReason: stepResult.stoppedReason ?? null,
      metadata: {
        networkCapture,
      },
    },
  };
}

function buildNetworkIntegrationSummary(networkIntegration, networkCaptureEnabled) {
  return {
    enabled: Boolean(networkIntegration?.enabled) && networkCaptureEnabled,
    candidatesExtracted: networkIntegration?.candidatesExtracted || 0,
    pooledCandidates: networkIntegration?.pooledCandidates || 0,
    replacedCandidates: networkIntegration?.replacedCandidates || 0,
    parseErrors: Array.isArray(networkIntegration?.parseErrors) ? networkIntegration.parseErrors.length : 0,
    mergedPosts: networkIntegration?.mergedPosts || 0,
    recoveredIdentityCount: networkIntegration?.recoveredIdentityCount || 0,
    mergedWithExactIdentity: networkIntegration?.mergedWithExactIdentity || 0,
    fullTextMatches: networkIntegration?.fullTextMatches || 0,
    fragmentMatches: networkIntegration?.fragmentMatches || 0,
    recentMatches: Array.isArray(networkIntegration?.matches)
      ? networkIntegration.matches.slice(-20)
      : [],
  };
}

function buildNetworkCaptureStartupWindow(networkCapture, startupDrain) {
  const startupSummary = summarizeFacebookNetworkCapture(networkCapture?.startupItems || []);
  const startupGraphQlSummary = summarizeFacebookCdpGraphQlRequests(networkCapture?.startupGraphQlRequests || []);

  return {
    ...(networkCapture?.startup || {}),
    capturedCount: startupSummary.capturedCount,
    normalizedCandidates: startupDrain.normalizedCandidates,
    drainPasses: startupDrain.passes,
    remainingBuffered: startupDrain.remainingBuffered,
    pendingRequests: startupDrain.pendingRequests,
    inFlightBodyReads: startupDrain.inFlightBodyReads,
    settleTimedOut: Boolean(startupDrain.settleTimedOut),
    graphQlRequestCount: startupGraphQlSummary.count,
    graphQlInspectableCount: startupGraphQlSummary.inspectableCount,
    graphQlSummary: startupGraphQlSummary,
    summary: startupSummary,
  };
}

export function buildNetworkCaptureFinalizationResult({
  runId,
  sourceKey,
  browserProfile,
  navigateBeforeCrawl,
  networkCapture,
  startupDrain = createEmptyNetworkDrainResult(),
  networkIntegration,
}) {
  const enabled = Boolean(networkCapture?.enabled || networkCapture?.installed);
  const summary = summarizeFacebookNetworkCapture(networkCapture?.items || []);
  const graphQlRequestSummary = summarizeFacebookCdpGraphQlRequests(networkCapture?.graphQlRequests || []);
  const startupWindow = buildNetworkCaptureStartupWindow(networkCapture, startupDrain);
  const integration = buildNetworkIntegrationSummary(networkIntegration, enabled);
  const finalDrain = Array.isArray(networkCapture?.drains) && networkCapture.drains.length
    ? networkCapture.drains[networkCapture.drains.length - 1]
    : null;

  return {
    enabled,
    summary,
    startupWindow,
    graphQlRequestSummary,
    startupGraphQlSummary: startupWindow.graphQlSummary,
    integration,
    artifact: {
      payload: {
        runId,
        sourceKey,
        browserProfile,
        enabled,
        transport: networkCapture?.transport || null,
        navigateBeforeCrawl: Boolean(navigateBeforeCrawl),
        options: networkCapture?.options || null,
        installed: networkCapture?.installed || null,
        error: networkCapture?.error || null,
        startup: startupWindow,
        drains: Array.isArray(networkCapture?.drains) ? networkCapture.drains : [],
        persistedDrops: networkCapture?.persistedDrops || 0,
        finalDrain,
        finalArtifactDrain: networkCapture?.finalArtifactDrain || null,
        finalStats: networkCapture?.finalStats || null,
        summary,
        graphQlRequestSummary,
        graphQlRequests: Array.isArray(networkCapture?.graphQlRequests) ? networkCapture.graphQlRequests : [],
        startupGraphQlRequests: Array.isArray(networkCapture?.startupGraphQlRequests)
          ? networkCapture.startupGraphQlRequests
          : [],
        integration: {
          ...integration,
          parseErrors: Array.isArray(networkIntegration?.parseErrors) ? networkIntegration.parseErrors : [],
        },
        items: Array.isArray(networkCapture?.items) ? networkCapture.items : [],
      },
      metadata: {
        records: summary.capturedCount,
        withPostIds: summary.withPostIds,
        withStoryIds: summary.withStoryIds,
        withFeedbackIds: summary.withFeedbackIds,
        mergedPosts: integration.mergedPosts,
        recoveredIdentityCount: integration.recoveredIdentityCount,
      },
    },
    runSummary: {
      enabled,
      transport: networkCapture?.transport || null,
      navigateBeforeCrawl: Boolean(navigateBeforeCrawl),
      captured: summary.capturedCount,
      withTargetGroupId: summary.withTargetGroupId,
      withPostIds: summary.withPostIds,
      withStoryIds: summary.withStoryIds,
      withFeedbackIds: summary.withFeedbackIds,
      persistedDrops: networkCapture?.persistedDrops || 0,
      topFriendlyNames: summary.topFriendlyNames,
      error: networkCapture?.error || null,
      finalStats: networkCapture?.finalStats || null,
      graphQlRequests: graphQlRequestSummary.count,
      graphQlInspectableRequests: graphQlRequestSummary.inspectableCount,
      topGraphQlFriendlyNames: graphQlRequestSummary.topFriendlyNames,
      topGraphQlDocIds: graphQlRequestSummary.topDocIds,
      startup: {
        ...(networkCapture?.startup || {}),
        captured: startupWindow.capturedCount,
        normalizedCandidates: startupWindow.normalizedCandidates,
        topFriendlyNames: startupWindow.summary.topFriendlyNames,
        topDocIds: startupWindow.summary.topDocIds,
        graphQlRequests: startupWindow.graphQlRequestCount,
        graphQlInspectableRequests: startupWindow.graphQlInspectableCount,
        topGraphQlFriendlyNames: startupWindow.graphQlSummary.topFriendlyNames,
        topGraphQlDocIds: startupWindow.graphQlSummary.topDocIds,
      },
      integration,
    },
    outputSummary: {
      transport: networkCapture?.transport || null,
      installed: networkCapture?.installed || null,
      error: networkCapture?.error || null,
      summary,
      persistedDrops: networkCapture?.persistedDrops || 0,
      finalStats: networkCapture?.finalStats || null,
      graphQlRequestSummary,
      startupGraphQlSummary: startupWindow.graphQlSummary,
      integration,
    },
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
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
} from '../src/cli/crawl-dom-latest.step-helpers.js';

test('network capture session state keeps CDP session lifecycle fields explicit', () => {
  const sessionState = createNetworkCaptureSessionState({
    enabled: true,
    options: {
      captureVersion: 'facebook-network-capture-v1',
    },
  });

  assert.equal(sessionState.enabled, true);
  assert.equal(sessionState.transport, null);
  assert.equal(sessionState.targetId, null);
  assert.deepEqual(sessionState.options, {
    captureVersion: 'facebook-network-capture-v1',
  });
  assert.equal(sessionState.controller, null);
  assert.equal(sessionState.installed, null);
  assert.equal(sessionState.error, null);
  assert.deepEqual(sessionState.drains, []);
  assert.deepEqual(sessionState.items, []);
  assert.deepEqual(sessionState.graphQlRequests, []);
  assert.deepEqual(sessionState.startupItems, []);
  assert.deepEqual(sessionState.startupGraphQlRequests, []);
  assert.equal(sessionState.finalStats, null);
  assert.equal(sessionState.finalArtifactDrain, null);
  assert.equal(sessionState.persistedDrops, 0);
  assert.equal(sessionState.startup, null);
});

test('network capture bootstrap plan keeps CDP install and startup-navigation semantics explicit', () => {
  assert.deepEqual(
    createNetworkCaptureBootstrapPlan({
      enabled: true,
      navigateBeforeCrawl: true,
    }),
    {
      shouldInstall: true,
      startupNavigation: {
        requested: true,
        requiresSourceUrl: true,
        armsCaptureBeforeNavigation: true,
      },
    },
  );

  assert.deepEqual(
    createNetworkCaptureBootstrapPlan({
      enabled: false,
      navigateBeforeCrawl: true,
    }),
    {
      shouldInstall: false,
      startupNavigation: {
        requested: true,
        requiresSourceUrl: true,
        armsCaptureBeforeNavigation: false,
      },
    },
  );

  assert.deepEqual(
    createNetworkCaptureBootstrapPlan({
      enabled: true,
      navigateBeforeCrawl: false,
    }),
    {
      shouldInstall: true,
      startupNavigation: {
        requested: false,
        requiresSourceUrl: false,
        armsCaptureBeforeNavigation: false,
      },
    },
  );
});

test('pinned browser session routes run and evaluate calls through the same resolved target id', () => {
  const runCalls = [];
  const evaluateCalls = [];
  const pinnedBrowser = createPinnedBrowserSession({
    browserProfile: 'chrome',
    getTargetId: () => 'target-42',
    runBrowserCommand(args) {
      runCalls.push(args);
      return { ok: true };
    },
    evaluateJsonCommand(fn, browserProfile, targetId) {
      evaluateCalls.push({ fn, browserProfile, targetId });
      return { ok: true };
    },
  });
  const evaluateFn = () => ({ ok: true });

  pinnedBrowser.run(['navigate', '--browser-profile', 'chrome', 'https://example.com']);
  pinnedBrowser.evaluate(evaluateFn);

  assert.deepEqual(runCalls, [
    ['navigate', '--target-id', 'target-42', '--browser-profile', 'chrome', 'https://example.com'],
  ]);
  assert.deepEqual(evaluateCalls, [
    {
      fn: evaluateFn,
      browserProfile: 'chrome',
      targetId: 'target-42',
    },
  ]);
});

test('crawl step advance plan keeps target-stop and finalize-stop phases explicit', () => {
  assert.deepEqual(
    createCrawlStepAdvancePlan({
      freshCollected: 20,
      target: 20,
      stepIndex: 3,
      maxScrolls: 20,
    }),
    {
      shouldScroll: false,
      waitMs: 1200,
      lateDrainPhase: 'before-target-stop',
      stoppedReason: 'target reached',
    },
  );

  assert.deepEqual(
    createCrawlStepAdvancePlan({
      freshCollected: 5,
      target: 20,
      stepIndex: 20,
      maxScrolls: 20,
    }),
    {
      shouldScroll: false,
      waitMs: 1200,
      lateDrainPhase: 'before-finalize',
      stoppedReason: 'max scrolls reached',
    },
  );

  assert.deepEqual(
    createCrawlStepAdvancePlan({
      freshCollected: 5,
      target: 20,
      stepIndex: 3,
      maxScrolls: 20,
    }),
    {
      shouldScroll: true,
      waitMs: 1200,
      lateDrainPhase: 'after-scroll',
      stoppedReason: null,
    },
  );
});

test('network drain operation result keeps one explicit live drain shape across idle and transport state', () => {
  assert.deepEqual(
    createNetworkDrainOperationResult({
      stepIndex: 3,
      phase: 'after-expand',
      settled: {
        timedOut: true,
      },
      drained: {
        items: [{ captureId: 'netcap_0001' }, { captureId: 'netcap_0002' }],
        remaining: 4,
        remainingBuffered: 2,
        pendingRequests: 1,
        inFlightBodyReads: 1,
        stats: {
          captured: 2,
        },
      },
      normalizedCandidates: 5,
    }),
    {
      stepIndex: 3,
      phase: 'after-expand',
      capturedThisDrain: 2,
      normalizedCandidates: 5,
      remaining: 4,
      remainingBuffered: 2,
      pendingRequests: 1,
      inFlightBodyReads: 1,
      settleTimedOut: true,
      stats: {
        captured: 2,
      },
    },
  );

  assert.deepEqual(
    createNetworkDrainOperationResult({
      stepIndex: 4,
      phase: 'after-scroll',
    }),
    {
      stepIndex: 4,
      phase: 'after-scroll',
      capturedThisDrain: 0,
      normalizedCandidates: 0,
      remaining: 0,
      remainingBuffered: 0,
      pendingRequests: 0,
      inFlightBodyReads: 0,
      settleTimedOut: false,
      stats: null,
    },
  );
});

test('network drain completion result accumulates repeated live drain passes and keeps final remaining state explicit', () => {
  const firstPass = createNetworkDrainOperationResult({
    stepIndex: 7,
    phase: 'after-scroll',
    drained: {
      items: [{ captureId: 'netcap_0001' }, { captureId: 'netcap_0002' }],
      remaining: 3,
      remainingBuffered: 1,
      pendingRequests: 1,
      inFlightBodyReads: 1,
      stats: {
        captured: 2,
      },
    },
    normalizedCandidates: 4,
  });
  const secondPass = createNetworkDrainOperationResult({
    stepIndex: 7,
    phase: 'after-scroll-continue-1',
    settled: {
      timedOut: true,
    },
    drained: {
      items: [{ captureId: 'netcap_0003' }],
      remaining: 0,
      remainingBuffered: 0,
      pendingRequests: 0,
      inFlightBodyReads: 0,
      stats: {
        captured: 3,
      },
    },
    normalizedCandidates: 2,
  });

  const completion = accumulateNetworkDrainCompletionResult(
    accumulateNetworkDrainCompletionResult(createEmptyNetworkDrainResult(), firstPass),
    secondPass,
  );

  assert.deepEqual(completion, {
    capturedThisDrain: 3,
    normalizedCandidates: 6,
    remaining: 0,
    remainingBuffered: 0,
    pendingRequests: 0,
    inFlightBodyReads: 0,
    settleTimedOut: true,
    stats: {
      captured: 3,
    },
    passes: 2,
  });
});

test('crawl step report shapes one shared network summary into step log and run-step metadata', () => {
  const report = buildCrawlStepReport({
    runId: 'run-1',
    sourceId: 'source-1',
    stepIndex: 4,
    expandedCount: 7,
    visiblePosts: 9,
    addedCount: 3,
    freshCount: 1,
    seenCount: 1,
    unidentifiedCount: 1,
    totals: {
      fresh: 10,
      seen: 6,
      unidentified: 2,
    },
    provisionalBeforeResolution: 2,
    identitySummary: {
      withIdentity: 8,
      unresolved: 1,
    },
    networkMergedThisStep: 2,
    networkRecoveredThisStep: 1,
    stoppedReason: 'scroll did not advance',
    page: {
      scrollY: 2400,
      bodyHeight: 9200,
      pageHref: 'https://www.facebook.com/groups/test',
      pageTitle: 'Test Group',
    },
    networkDrains: {
      startup: createEmptyNetworkDrainResult({
        capturedThisDrain: 1,
        normalizedCandidates: 2,
      }),
      afterExpand: createEmptyNetworkDrainResult({
        capturedThisDrain: 3,
        normalizedCandidates: 4,
      }),
      late: createEmptyNetworkDrainResult({
        capturedThisDrain: 2,
        normalizedCandidates: 5,
        passes: 2,
        remainingBuffered: 7,
        pendingRequests: 8,
        inFlightBodyReads: 9,
        settleTimedOut: true,
      }),
    },
  });

  assert.deepEqual(report.networkCapture, {
    capturedThisStep: 6,
    capturedBeforeExpand: 1,
    capturedAfterExpand: 3,
    capturedAfterLateDrain: 2,
    normalizedCandidatesThisStep: 11,
    normalizedCandidatesBeforeExpand: 2,
    normalizedCandidatesAfterExpand: 4,
    normalizedCandidatesAfterLateDrain: 5,
    mergedThisStep: 2,
    recoveredIdentityThisStep: 1,
    provisionalBeforeResolution: 2,
    withIdentityOnFinalize: 8,
    unresolvedProvisionalOnFinalize: 1,
    lateDrainPasses: 2,
    remainingBuffered: 7,
    pendingRequests: 8,
    inFlightBodyReads: 9,
    settleTimedOut: true,
  });

  assert.equal(report.stepLogEntry.networkCandidatesThisStep, report.networkCapture.normalizedCandidatesThisStep);
  assert.equal(report.stepLogEntry.networkCapturedThisStep, report.networkCapture.capturedThisStep);
  assert.equal(report.stepLogEntry.networkCapturedBeforeExpand, report.runStep.metadata.networkCapture.capturedBeforeExpand);
  assert.equal(report.stepLogEntry.networkCapturedAfterExpand, report.runStep.metadata.networkCapture.capturedAfterExpand);
  assert.equal(report.stepLogEntry.networkCapturedAfterLateDrain, report.runStep.metadata.networkCapture.capturedAfterLateDrain);
  assert.equal(report.stepLogEntry.lateDrainPasses, report.runStep.metadata.networkCapture.lateDrainPasses);
  assert.equal(report.stepLogEntry.withIdentityOnFinalize, report.runStep.metadata.networkCapture.withIdentityOnFinalize);
  assert.equal(
    report.stepLogEntry.unresolvedProvisionalOnFinalize,
    report.runStep.metadata.networkCapture.unresolvedProvisionalOnFinalize,
  );
  assert.equal(report.stepLogEntry.freshCollected, report.runStep.freshCollected);
  assert.equal(report.stepLogEntry.seenCollected, report.runStep.seenCollected);
  assert.equal(report.stepLogEntry.unidentifiedCollected, report.runStep.unidentifiedCollected);
  assert.equal(report.stepLogEntry.stoppedReason, report.runStep.stoppedReason);
  assert.equal(report.stepLogEntry.scrollY, report.runStep.scrollY);
  assert.equal(report.stepLogEntry.pageHref, report.runStep.pageHref);
});

test('network capture finalization shapes artifact, run summary, and stdout output from one shared result', () => {
  const finalization = buildNetworkCaptureFinalizationResult({
    runId: 'run-1',
    sourceKey: 'source-1',
    browserProfile: 'chrome',
    navigateBeforeCrawl: true,
    startupDrain: createEmptyNetworkDrainResult({
      normalizedCandidates: 3,
      passes: 2,
      remainingBuffered: 4,
      pendingRequests: 5,
      inFlightBodyReads: 6,
      settleTimedOut: true,
    }),
    networkCapture: {
      enabled: true,
      transport: 'cdp',
      options: {
        captureVersion: 'facebook-network-capture-v1',
      },
      installed: {
        installed: true,
        targetId: 'target-1',
      },
      error: null,
      drains: [
        { phase: 'after-expand', capturedThisDrain: 1 },
        { phase: 'final-artifact-flush', capturedThisDrain: 1 },
      ],
      items: [
        {
          sourceTransport: 'cdp',
          captureMode: 'full_text',
          retentionReason: 'high_signal_full_text',
          fbApiReqFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
          docId: 'doc-1',
          matchHints: {
            hasTargetGroupId: true,
            postIds: ['post-1'],
            storyIds: [],
            feedbackIds: [],
          },
        },
        {
          sourceTransport: 'cdp',
          captureMode: 'matched_fragments',
          retentionReason: 'matched_fragments',
          fbApiReqFriendlyName: 'GroupsCometFocusedStoryViewQuery',
          docId: 'doc-2',
          matchHints: {
            hasTargetGroupId: false,
            postIds: [],
            storyIds: ['story-1'],
            feedbackIds: ['feedback-1'],
          },
        },
      ],
      graphQlRequests: [
        {
          requestTimestamp: '2026-03-16T20:00:00.000Z',
          fbApiReqFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
          docId: 'doc-1',
          shouldInspectResponse: true,
        },
        {
          requestTimestamp: '2026-03-16T20:00:01.000Z',
          fbApiReqFriendlyName: 'CometNotificationsDropdownQuery',
          docId: 'doc-3',
          shouldInspectResponse: false,
        },
      ],
      startupItems: [
        {
          sourceTransport: 'cdp',
          captureMode: 'full_text',
          retentionReason: 'small_response_full_text',
          fbApiReqFriendlyName: 'useGroupsCometVisitMutation',
          docId: 'doc-startup',
          matchHints: {
            hasTargetGroupId: true,
            postIds: [],
            storyIds: [],
            feedbackIds: [],
          },
        },
      ],
      startupGraphQlRequests: [
        {
          requestTimestamp: '2026-03-16T19:59:59.000Z',
          fbApiReqFriendlyName: 'useGroupsCometVisitMutation',
          docId: 'doc-startup',
          shouldInspectResponse: true,
        },
      ],
      finalStats: {
        captured: 2,
      },
      finalArtifactDrain: {
        remainingBuffered: 0,
        pendingRequests: 0,
        inFlightBodyReads: 0,
      },
      persistedDrops: 1,
      startup: {
        navigationRequestedAt: '2026-03-16T19:59:58.000Z',
        captureCompletedAt: '2026-03-16T20:00:02.000Z',
      },
    },
    networkIntegration: {
      enabled: true,
      candidatesExtracted: 7,
      pooledCandidates: 3,
      replacedCandidates: 1,
      parseErrors: [{ message: 'parse failed' }],
      mergedPosts: 2,
      recoveredIdentityCount: 1,
      mergedWithExactIdentity: 1,
      fullTextMatches: 1,
      fragmentMatches: 1,
      matches: [{ type: 'exact_identity' }],
    },
  });

  assert.equal(finalization.summary.capturedCount, 2);
  assert.equal(finalization.startupWindow.capturedCount, 1);
  assert.equal(finalization.graphQlRequestSummary.count, 2);
  assert.equal(finalization.startupGraphQlSummary.count, 1);

  assert.equal(finalization.artifact.payload.startup.capturedCount, 1);
  assert.equal(finalization.artifact.payload.startup.graphQlRequestCount, 1);
  assert.equal(finalization.artifact.payload.integration.parseErrors.length, 1);
  assert.equal(finalization.artifact.payload.summary.capturedCount, finalization.outputSummary.summary.capturedCount);
  assert.deepEqual(finalization.artifact.metadata, {
    records: 2,
    withPostIds: 1,
    withStoryIds: 1,
    withFeedbackIds: 1,
    mergedPosts: 2,
    recoveredIdentityCount: 1,
  });

  assert.equal(finalization.runSummary.captured, 2);
  assert.equal(finalization.runSummary.graphQlRequests, 2);
  assert.equal(finalization.runSummary.graphQlInspectableRequests, 1);
  assert.equal(finalization.runSummary.startup.captured, 1);
  assert.equal(finalization.runSummary.startup.normalizedCandidates, 3);
  assert.equal(finalization.runSummary.integration.parseErrors, 1);
  assert.equal(finalization.runSummary.integration.mergedPosts, 2);
  assert.ok(!Object.hasOwn(finalization.runSummary.startup, 'capturedCount'));
  assert.ok(!Object.hasOwn(finalization.runSummary.startup, 'summary'));
  assert.ok(!Object.hasOwn(finalization.runSummary.startup, 'graphQlSummary'));

  assert.equal(finalization.outputSummary.graphQlRequestSummary.count, 2);
  assert.equal(finalization.outputSummary.startupGraphQlSummary.count, 1);
  assert.equal(finalization.outputSummary.integration.recoveredIdentityCount, 1);
});

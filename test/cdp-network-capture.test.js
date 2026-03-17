import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFacebookCdpCaptureState,
  deriveOpenClawRelayAuthToken,
  drainFacebookCdpCaptureState,
  filterFacebookCdpRequestsByTimestampWindow,
  handleFacebookCdpLoadingFinished,
  handleFacebookCdpRequestWillBeSent,
  handleFacebookCdpResponseReceived,
  recordFacebookCdpNavigationStart,
  summarizeFacebookCdpGraphQlRequests,
  waitForFacebookCdpCaptureIdle,
} from '../src/browser/cdp-network-capture.js';
import { appendBrowserTargetId } from '../src/core/browser-pipeline.js';

test('deriveOpenClawRelayAuthToken matches the relay HMAC format', () => {
  const token = deriveOpenClawRelayAuthToken('abc123', 18792);
  assert.equal(token, '7c8e89515c90b9d43c9605c0ab92640d0fac3744d3fc718e8a8df0660cd80d23');
});

test('CDP capture turns startup GraphQL request and response events into stored envelopes', async () => {
  const state = createFacebookCdpCaptureState({
    targetGroupIds: ['2664056243718928'],
    maxFullResponseChars: 1000,
    maxHighSignalFullResponseChars: 90000,
  }, '2026-03-16T14:20:00.000Z');

  recordFacebookCdpNavigationStart(state, {
    fromUrl: 'about:blank',
    toUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/?sorting_setting=CHRONOLOGICAL',
  }, '2026-03-16T14:20:01.000Z');

  const request = handleFacebookCdpRequestWillBeSent(state, {
    requestId: 'request-1',
    wallTime: Date.parse('2026-03-16T14:20:01.250Z') / 1000,
    request: {
      url: 'https://www.facebook.com/api/graphql/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      postData: [
        'fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery',
        'doc_id=26032294259753860',
        `variables=${encodeURIComponent(JSON.stringify({
          groupID: '2664056243718928',
          cursor: 'feed_unit:1',
        }))}`,
      ].join('&'),
    },
  }, 'session-1');

  assert.ok(request);
  assert.equal(state.capture.stats.cdpCandidates, 1);

  const response = handleFacebookCdpResponseReceived(state, {
    requestId: 'request-1',
    response: {
      status: 200,
      mimeType: 'application/json',
      responseTime: Date.parse('2026-03-16T14:20:01.900Z'),
      headers: {
        'content-type': 'application/json',
      },
    },
  }, 'session-1');

  assert.ok(response);

  const stored = await handleFacebookCdpLoadingFinished(state, {
    requestId: 'request-1',
  }, 'session-1', async () => ({
    body: [
      '{"data":{"node":{"feed_edges":[{"node":{"__typename":"Story",',
      '"groupID":"2664056243718928","story_id":"24405637689134137",',
      '"post_id":"24405637689134137","message":{"text":"Looking for a room"}}]}}}',
    ].join(''),
    base64Encoded: false,
  }));

  assert.ok(stored);
  assert.equal(stored.sourceTransport, 'cdp');
  assert.equal(stored.captureMode, 'full_text');
  assert.equal(stored.fbApiReqFriendlyName, 'GroupsCometFeedRegularStoriesPaginationQuery');
  assert.equal(stored.docId, '26032294259753860');
  assert.deepEqual(stored.matchHints.postIds, ['24405637689134137']);
  assert.equal(state.capture.stats.responsesInspected, 1);
  assert.equal(state.startup.firstRequestTimestamp, '2026-03-16T14:20:01.250Z');
  assert.equal(state.startup.firstResponseTimestamp, '2026-03-16T14:20:01.900Z');

  const drained = drainFacebookCdpCaptureState(state, {
    clear: true,
    maxItems: 10,
  });

  assert.equal(drained.items.length, 1);
  assert.equal(drained.remaining, 0);
});

test('CDP capture drops low-signal Facebook GraphQL requests before response body fetch', () => {
  const state = createFacebookCdpCaptureState();

  const request = handleFacebookCdpRequestWillBeSent(state, {
    requestId: 'request-2',
    wallTime: Date.parse('2026-03-16T14:22:01.000Z') / 1000,
    request: {
      url: 'https://www.facebook.com/api/graphql/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      postData: [
        'fb_api_req_friendly_name=PresenceStatusProviderSubscriptionQuery',
        'doc_id=99887766',
      ].join('&'),
    },
  }, 'session-1');

  assert.equal(request, null);
  assert.equal(state.capture.stats.skippedLowSignal, 1);
  assert.equal(state.graphqlRequests.length, 1);
  assert.equal(state.graphqlRequests[0].fbApiReqFriendlyName, 'PresenceStatusProviderSubscriptionQuery');
  assert.equal(state.graphqlRequests[0].shouldInspectResponse, false);
  assert.equal(drainFacebookCdpCaptureState(state).items.length, 0);
});

test('CDP GraphQL request summary includes header-derived friendly names for startup telemetry', () => {
  const state = createFacebookCdpCaptureState();

  handleFacebookCdpRequestWillBeSent(state, {
    requestId: 'request-3',
    wallTime: Date.parse('2026-03-16T14:23:01.000Z') / 1000,
    request: {
      url: 'https://www.facebook.com/api/graphql/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': 'CometNotificationsDropdownQuery',
      },
      postData: 'doc_id=11223344',
    },
  }, 'session-1');

  const summary = summarizeFacebookCdpGraphQlRequests(state.graphqlRequests);
  assert.equal(summary.count, 1);
  assert.equal(summary.inspectableCount, 0);
  assert.deepEqual(summary.topFriendlyNames, [
    { value: 'CometNotificationsDropdownQuery', count: 1 },
  ]);
  assert.deepEqual(summary.topDocIds, [
    { value: '11223344', count: 1 },
  ]);
});

test('CDP drain reports in-flight body reads until the async response body is stored', async () => {
  const state = createFacebookCdpCaptureState({
    targetGroupIds: ['2664056243718928'],
  });

  handleFacebookCdpRequestWillBeSent(state, {
    requestId: 'request-4',
    wallTime: Date.parse('2026-03-16T14:24:01.000Z') / 1000,
    request: {
      url: 'https://www.facebook.com/api/graphql/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      postData: [
        'fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery',
        'doc_id=26032294259753860',
      ].join('&'),
    },
  }, 'session-1');

  handleFacebookCdpResponseReceived(state, {
    requestId: 'request-4',
    response: {
      status: 200,
      mimeType: 'application/json',
      responseTime: Date.parse('2026-03-16T14:24:01.200Z'),
      headers: {
        'content-type': 'application/json',
      },
    },
  }, 'session-1');

  let releaseBodyRead = null;
  const loadingFinishedPromise = handleFacebookCdpLoadingFinished(state, {
    requestId: 'request-4',
  }, 'session-1', async () => {
    await new Promise((resolve) => {
      releaseBodyRead = resolve;
    });
    return {
      body: '{"data":{"node":{"post_id":"24405637689134137","groupID":"2664056243718928"}}}',
      base64Encoded: false,
    };
  });

  const duringRead = drainFacebookCdpCaptureState(state, {
    clear: true,
    maxItems: 10,
  });
  assert.equal(duringRead.items.length, 0);
  assert.equal(duringRead.inFlightBodyReads, 1);
  assert.equal(duringRead.pendingRequests, 0);
  assert.equal(duringRead.remaining, 1);

  releaseBodyRead();
  await loadingFinishedPromise;

  const afterRead = drainFacebookCdpCaptureState(state, {
    clear: true,
    maxItems: 10,
  });
  assert.equal(afterRead.items.length, 1);
  assert.equal(afterRead.inFlightBodyReads, 0);
  assert.equal(afterRead.remaining, 0);
});

test('CDP startup request filtering applies both start and end timestamps', () => {
  const requests = [
    { requestTimestamp: '2026-03-16T14:25:00.000Z', docId: 'before' },
    { requestTimestamp: '2026-03-16T14:25:02.000Z', docId: 'inside-1' },
    { requestTimestamp: '2026-03-16T14:25:03.000Z', docId: 'inside-2' },
    { requestTimestamp: '2026-03-16T14:25:05.000Z', docId: 'after' },
  ];

  const filtered = filterFacebookCdpRequestsByTimestampWindow(requests, {
    startTimestamp: '2026-03-16T14:25:01.000Z',
    endTimestamp: '2026-03-16T14:25:03.500Z',
  });

  assert.deepEqual(filtered.map((request) => request.docId), ['inside-1', 'inside-2']);
});

test('browser target pinning injects target id ahead of browser subcommand args', () => {
  assert.deepEqual(
    appendBrowserTargetId(['navigate', '--browser-profile', 'chrome', 'https://example.com'], 'cb-tab-9'),
    ['navigate', '--target-id', 'cb-tab-9', '--browser-profile', 'chrome', 'https://example.com'],
  );
});

test('CDP idle wait observes a fresh quiet window instead of returning immediately on stale activity', async () => {
  const state = createFacebookCdpCaptureState();
  state.lastActivityAtMs = Date.now() - 5_000;

  setTimeout(() => {
    handleFacebookCdpRequestWillBeSent(state, {
      requestId: 'request-5',
      wallTime: Date.parse('2026-03-16T14:26:01.000Z') / 1000,
      request: {
        url: 'https://www.facebook.com/api/graphql/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        postData: 'fb_api_req_friendly_name=PresenceStatusProviderSubscriptionQuery&doc_id=99887766',
      },
    }, 'session-1');
  }, 20);

  const settled = await waitForFacebookCdpCaptureIdle(state, {
    idleMs: 40,
    timeoutMs: 400,
    pollMs: 10,
  });

  assert.equal(settled.timedOut, false);
  assert.equal(state.graphqlRequests.length, 1);
});

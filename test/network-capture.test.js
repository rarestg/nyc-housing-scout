import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeFacebookGraphQlRequest,
  buildFacebookNetworkCaptureEnvelope,
  createInstalledNetworkCaptureState,
  resetInstalledNetworkCaptureRunState,
  storeNetworkCaptureEnvelope,
  summarizeFacebookNetworkCapture,
} from '../src/browser/network-capture.js';

test('network capture keeps compact Facebook GraphQL envelopes with canonical id hints', () => {
  const requestAnalysis = analyzeFacebookGraphQlRequest({
    url: 'https://www.facebook.com/api/graphql/',
    method: 'POST',
    requestContentType: 'application/x-www-form-urlencoded',
    requestBodyText: [
      'fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery',
      'doc_id=77889900112233',
      `variables=${encodeURIComponent(JSON.stringify({
        groupID: '2664056243718928',
        cursor: 'feed_unit:1',
      }))}`,
    ].join('&'),
  }, {
    targetGroupIds: ['2664056243718928'],
  });

  const largeResponseText = [
    '{"data":{"node":{"feed_edges":[{"node":{"__typename":"Story",',
    `"groupID":"2664056243718928","story_id":"24405637689134137","post_id":"24405637689134137",`,
    '"feedback":{"id":"feedback:24405637689134137"},"message":{"text":"Looking for a room"}}}]}}}',
    'x'.repeat(26000),
  ].join('');

  const envelope = buildFacebookNetworkCaptureEnvelope({
    sourceTransport: 'xhr',
    requestTimestamp: '2026-03-15T20:00:00.000Z',
    responseTimestamp: '2026-03-15T20:00:01.250Z',
    status: 200,
    ok: true,
    responseContentType: 'application/json',
    responseText: largeResponseText,
    requestAnalysis,
  }, {
    targetGroupIds: ['2664056243718928'],
    maxFullResponseChars: 1000,
    maxHighSignalFullResponseChars: 1000,
    maxMatchedFragments: 4,
    maxFragmentChars: 280,
  });

  assert.equal(requestAnalysis.shouldInspectResponse, true);
  assert.equal(requestAnalysis.fbApiReqFriendlyName, 'GroupsCometFeedRegularStoriesPaginationQuery');
  assert.deepEqual(requestAnalysis.requestHints.groupIds, ['2664056243718928']);

  assert.ok(envelope);
  assert.equal(envelope.captureMode, 'matched_fragments');
  assert.equal(envelope.retentionReason, 'matched_fragments');
  assert.equal(envelope.fbApiReqFriendlyName, 'GroupsCometFeedRegularStoriesPaginationQuery');
  assert.equal(envelope.docId, '77889900112233');
  assert.equal(envelope.matchHints.hasTargetGroupId, true);
  assert.deepEqual(envelope.matchHints.postIds, ['24405637689134137']);
  assert.deepEqual(envelope.matchHints.storyIds, ['24405637689134137']);
  assert.deepEqual(envelope.matchHints.feedbackIds, ['24405637689134137']);
  assert.match(envelope.capturedText, /24405637689134137/);
  assert.ok(envelope.matchedFragments.length >= 1);
});

test('network capture keeps fuller text for high-signal group feed responses within the bounded high-signal limit', () => {
  const requestAnalysis = analyzeFacebookGraphQlRequest({
    url: 'https://www.facebook.com/api/graphql/',
    method: 'POST',
    requestContentType: 'application/x-www-form-urlencoded',
    requestBodyText: [
      'fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery',
      'doc_id=26032294259753860',
      `variables=${encodeURIComponent(JSON.stringify({
        groupID: '2664056243718928',
        cursor: 'feed_unit:2',
      }))}`,
    ].join('&'),
  }, {
    targetGroupIds: ['2664056243718928'],
    maxFullResponseChars: 1000,
    maxHighSignalFullResponseChars: 90000,
  });

  const responseText = [
    '{"data":{"node":{"feed_edges":[{"node":{"__typename":"Story",',
    `"groupID":"2664056243718928","story_id":"24405637689134137","post_id":"24405637689134137",`,
    '"feedback":{"id":"feedback:24405637689134137"},"message":{"text":"Looking for a room"}}}]}}}',
    'x'.repeat(32000),
  ].join('');

  const envelope = buildFacebookNetworkCaptureEnvelope({
    sourceTransport: 'fetch',
    requestTimestamp: '2026-03-15T20:04:00.000Z',
    responseTimestamp: '2026-03-15T20:04:01.250Z',
    status: 200,
    ok: true,
    responseContentType: 'application/json',
    responseText,
    requestAnalysis,
  }, {
    targetGroupIds: ['2664056243718928'],
    maxFullResponseChars: 1000,
    maxHighSignalFullResponseChars: 90000,
  });

  assert.ok(envelope);
  assert.equal(envelope.captureMode, 'full_text');
  assert.equal(envelope.retentionReason, 'high_signal_full_text');
  assert.equal(envelope.responseTextTruncated, false);
  assert.equal(envelope.capturedText.length, responseText.length);
});

test('network capture drops low-signal GraphQL noise before response capture', () => {
  const analysis = analyzeFacebookGraphQlRequest({
    url: 'https://www.facebook.com/api/graphql/',
    method: 'POST',
    requestContentType: 'application/x-www-form-urlencoded',
    requestBodyText: [
      'fb_api_req_friendly_name=PresenceStatusProviderSubscriptionQuery',
      'doc_id=99887766',
      `variables=${encodeURIComponent(JSON.stringify({
        ids: ['10001'],
      }))}`,
    ].join('&'),
  });

  const envelope = buildFacebookNetworkCaptureEnvelope({
    sourceTransport: 'fetch',
    requestTimestamp: '2026-03-15T20:02:00.000Z',
    responseTimestamp: '2026-03-15T20:02:00.500Z',
    status: 200,
    ok: true,
    responseContentType: 'application/json',
    responseText: '{"data":{"viewer":{"id":"1"}}}',
    requestAnalysis: analysis,
  });

  assert.equal(analysis.shouldInspectResponse, false);
  assert.equal(analysis.skipReason, 'low_signal_request');
  assert.equal(envelope, null);
});

test('network capture summary counts request types and id-bearing envelopes', () => {
  const summary = summarizeFacebookNetworkCapture([
    {
      sourceTransport: 'xhr',
      captureMode: 'matched_fragments',
      retentionReason: 'matched_fragments',
      fbApiReqFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
      docId: '1',
      matchHints: {
        hasTargetGroupId: true,
        postIds: ['24405637689134137'],
        storyIds: [],
        feedbackIds: [],
      },
    },
    {
      sourceTransport: 'fetch',
      captureMode: 'full_text',
      retentionReason: 'high_signal_full_text',
      fbApiReqFriendlyName: 'CometFocusedStoryViewQuery',
      docId: '2',
      matchHints: {
        hasTargetGroupId: false,
        postIds: [],
        storyIds: ['24405637689134137'],
        feedbackIds: ['24405637689134137'],
      },
    },
  ]);

  assert.equal(summary.capturedCount, 2);
  assert.equal(summary.withTargetGroupId, 1);
  assert.equal(summary.withPostIds, 1);
  assert.equal(summary.withStoryIds, 1);
  assert.equal(summary.withFeedbackIds, 1);
  assert.deepEqual(summary.byTransport, {
    fetch: 1,
    xhr: 1,
  });
  assert.deepEqual(summary.byRetentionReason, {
    high_signal_full_text: 1,
    matched_fragments: 1,
  });
  assert.equal(summary.topFriendlyNames[0].value, 'CometFocusedStoryViewQuery');
});

test('network capture reinstall resets live run state in place for closed-over transport handlers', () => {
  const installed = createInstalledNetworkCaptureState({
    maxFullTextEnvelopes: 2,
  }, '2026-03-16T00:10:00.000Z');
  const closedOverState = installed;
  installed.stats.fetchPatched = true;
  installed.stats.xhrPatched = true;
  installed.stats.captured = 7;
  installed.stats.fetchCandidates = 5;
  installed.stats.responsesInspected = 4;
  installed.stats.fullTextCaptured = 2;
  installed.stats.fullTextBudgetExhausted = 1;
  installed.items.push({ captureId: 'netcap_0007', captureMode: 'matched_fragments' });
  installed.nextSequence = 8;

  const reset = resetInstalledNetworkCaptureRunState(installed, {
    maxFullTextEnvelopes: 1,
  }, '2026-03-16T00:12:00.000Z');

  assert.equal(reset, installed);
  assert.equal(closedOverState, installed);
  assert.equal(reset.installedAt, '2026-03-16T00:10:00.000Z');
  assert.equal(reset.options.maxFullTextEnvelopes, 1);
  assert.equal(reset.items.length, 0);
  assert.equal(reset.nextSequence, 1);
  assert.equal(reset.stats.installCalls, 2);
  assert.equal(reset.stats.fetchPatched, true);
  assert.equal(reset.stats.xhrPatched, true);
  assert.equal(reset.stats.captured, 0);
  assert.equal(reset.stats.fetchCandidates, 0);
  assert.equal(reset.stats.responsesInspected, 0);
  assert.equal(reset.stats.fullTextCaptured, 0);
  assert.equal(reset.stats.fullTextBudgetExhausted, 0);
  assert.equal(reset.stats.resetAt, '2026-03-16T00:12:00.000Z');

  const firstStored = storeNetworkCaptureEnvelope(closedOverState, {
    captureMode: 'full_text',
    retentionReason: 'high_signal_full_text',
    capturedText: '{"post_id":"24405637689134137"}',
    matchedFragments: [],
  });
  const secondStored = storeNetworkCaptureEnvelope(closedOverState, {
    captureMode: 'full_text',
    retentionReason: 'high_signal_full_text',
    capturedText: '{"post_id":"24405637689134138"}',
    matchedFragments: [{
      label: 'post_id',
      text: '24405637689134138',
    }],
  });

  assert.equal(firstStored.captureId, 'netcap_0001');
  assert.equal(secondStored.captureId, 'netcap_0002');
  assert.equal(closedOverState.stats.captured, 2);
  assert.equal(closedOverState.stats.fullTextCaptured, 1);
  assert.equal(closedOverState.stats.fullTextBudgetExhausted, 1);
  assert.equal(closedOverState.items[1].captureMode, 'matched_fragments');
  assert.equal(closedOverState.items[1].retentionReason, 'full_text_budget_exhausted');
});

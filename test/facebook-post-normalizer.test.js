import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseFacebookResponseText } from '../src/browser/facebook-response-parser.js';
import {
  extractFacebookPostCandidatesFromEnvelopeItem,
  extractFacebookPostCandidatesFromResponseText,
  findBestFacebookCandidateForCollectedPost,
} from '../src/browser/facebook-post-normalizer.js';
import { createCollectedPost, mergeCollectedPostWithNetworkData } from '../src/core/collected-post.js';

function readNetworkFixture(name) {
  return fs.readFileSync(path.resolve('test/fixtures/facebook-network', name), 'utf8');
}

function getAlisonCandidate(overrides = {}) {
  const text = readNetworkFixture('alison-multidoc.txt');
  return extractFacebookPostCandidatesFromResponseText(text, {
    targetPostId: '24405637689134137',
    ...overrides,
  }).candidates[0];
}

test('response parser splits multi-document payloads with prefixes and stray noise', () => {
  const parsed = parseFacebookResponseText([
    'for (;;);',
    '{"alpha": 1}',
    'non-json separator',
    '{"beta": 2}',
  ].join('\n'));

  assert.equal(parsed.documents.length, 2);
  assert.equal(parsed.documents[0].value.alpha, 1);
  assert.equal(parsed.documents[1].value.beta, 2);
  assert.ok(parsed.warnings.some((warning) => warning.includes('skipped non-JSON content')));
});

test('response parser keeps earlier valid docs when malformed trailing JSON appears', () => {
  const parsed = parseFacebookResponseText([
    '{"alpha": 1}',
    '{"broken":',
  ].join('\n'));

  assert.equal(parsed.documents.length, 1);
  assert.equal(parsed.documents[0].value.alpha, 1);
  assert.ok(parsed.warnings.some((warning) => warning.includes('could not parse JSON near')));
});

test('network normalizer recovers the Alison case from a reduced multi-document payload', () => {
  const text = readNetworkFixture('alison-multidoc.txt');
  const result = extractFacebookPostCandidatesFromResponseText(text, {
    targetPostId: '24405637689134137',
    includeViewerContext: true,
  });
  const [candidate] = result.candidates;

  assert.equal(result.documents.length, 2);
  assert.equal(result.warnings.length, 0);
  assert.equal(candidate.postId, '24405637689134137');
  assert.equal(candidate.postUrl, 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24405637689134137/');
  assert.equal(candidate.storyId, 'UzpfSTEzNjE1MjQ5NzY6Vks6MjQ0MDU2Mzc2ODkxMzQxMzc=');
  assert.equal(candidate.storyIdDecoded, 'S:_I1361524976:VK:24405637689134137');
  assert.equal(candidate.feedbackId, 'ZmVlZGJhY2s6MjQ0MDU2Mzc2ODkxMzQxMzc=');
  assert.equal(candidate.feedbackIdDecoded, 'feedback:24405637689134137');
  assert.equal(candidate.authorName, 'Alison Jolimet Fages');
  assert.equal(candidate.authorId, '1361524976');
  assert.equal(candidate.groupName, 'Williamsburg Greenpoint Housing');
  assert.equal(candidate.groupId, '2664056243718928');
  assert.equal(candidate.postedAtTimestamp, 1772484099);
  assert.equal(candidate.postedAtIso, '2026-03-02T20:41:39.000Z');
  assert.match(candidate.bodyText, /Looking for a \+2 bedrooms/);
  assert.deepEqual(candidate.attachmentSummary, {
    count: 0,
    types: [],
    titles: [],
    media: [],
  });
  assert.equal(candidate.source.selectedPath, 'doc[0].data.node_v2');
  assert.equal(candidate.source.matchCount, 5);
  assert.deepEqual(candidate.source.matchKinds, ['postId']);
  assert.equal(candidate.viewerContext.viewerActor.id, '665233712');
});

test('network normalizer can target the Alison case by storyId and feedbackId', () => {
  const text = readNetworkFixture('alison-multidoc.txt');
  const storyCandidate = extractFacebookPostCandidatesFromResponseText(text, {
    targetStoryId: 'UzpfSTEzNjE1MjQ5NzY6Vks6MjQ0MDU2Mzc2ODkxMzQxMzc=',
  }).candidates[0];
  const feedbackCandidate = extractFacebookPostCandidatesFromResponseText(text, {
    targetFeedbackId: 'ZmVlZGJhY2s6MjQ0MDU2Mzc2ODkxMzQxMzc=',
  }).candidates[0];

  assert.equal(storyCandidate.postId, '24405637689134137');
  assert.equal(feedbackCandidate.postId, '24405637689134137');
  assert.equal(storyCandidate.source.selectedPath, 'doc[0].data.node_v2');
  assert.equal(feedbackCandidate.source.selectedPath, 'doc[0].data.node_v2');
});

test('fragment normalizer recovers identity-grade fields from reduced matched fragments', () => {
  const envelopeItem = {
    captureMode: 'matched_fragments',
    capturedText: readNetworkFixture('jiadai-matched-fragments.txt'),
    sourceTransport: 'xhr',
    url: '/api/graphql/',
    method: 'POST',
    fbApiReqFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
    docId: '26032294259753860',
    actorId: '665233712',
    requestTimestamp: '2026-03-15T23:19:44.377Z',
    responseTimestamp: '2026-03-15T23:19:45.271Z',
    matchHints: {
      groupIds: ['2664056243718928'],
      postIds: ['24387553734275866', '24395726276791945'],
      storyIds: [],
      feedbackIds: [],
    },
  };
  const [candidate] = extractFacebookPostCandidatesFromEnvelopeItem(envelopeItem);

  assert.equal(candidate.postId, '24387553734275866');
  assert.equal(candidate.postUrl, 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24387553734275866/');
  assert.equal(candidate.storyId, 'UzpfSTEwMDAwNjI2NzA0MDk4MzpWSzoyNDM4NzU1MzczNDI3NTg2Ng==');
  assert.equal(candidate.feedbackId, 'ZmVlZGJhY2s6MjQzODc1NTM3MzQyNzU4NjY=');
  assert.equal(candidate.authorName, 'Jiadai He');
  assert.equal(candidate.authorId, '100006267040983');
  assert.equal(candidate.groupName, 'Williamsburg Greenpoint Housing');
  assert.equal(candidate.groupId, '2664056243718928');
  assert.equal(candidate.partial, true);
  assert.equal(candidate.postedAtTimestamp, null);
  assert.equal(candidate.bodyText, null);
  assert.equal(candidate.request.fbApiReqFriendlyName, 'GroupsCometFeedRegularStoriesPaginationQuery');
});

test('candidate matching plus merge helper enriches unidentified collected posts', () => {
  const candidate = getAlisonCandidate();
  const collected = createCollectedPost({
    author: 'Alison Jolimet Fages',
    postedAtText: 'March 2 at 3:41 PM',
    bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg (preferably close to Graham Av) - lease should start in May/June',
    hasSeeMore: true,
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });
  const bestMatch = findBestFacebookCandidateForCollectedPost(collected, [candidate], {
    minScore: 20,
  });
  const merged = mergeCollectedPostWithNetworkData(collected, bestMatch.candidate, {
    matchScore: bestMatch.score,
    matchReasons: bestMatch.reasons,
    domHadPostId: false,
    domHadPostUrl: false,
    identityRecovered: true,
    matchedCaptureId: 'netcap_0001',
    matchedCaptureMode: 'full_text',
    matchedRetentionReason: 'high_signal_full_text',
    matchedStepIndex: 4,
    matchedPhase: 'after-expand',
    mergedAtStepIndex: 4,
  });

  assert.ok(bestMatch);
  assert.ok(bestMatch.score >= 80);
  assert.deepEqual(bestMatch.reasons, ['author_exact', 'group_id', 'group_name', 'body_strong_overlap']);
  assert.equal(merged.postId, '24405637689134137');
  assert.equal(merged.postUrl, 'https://www.facebook.com/groups/2664056243718928/posts/24405637689134137/');
  assert.equal(merged.storyId, 'UzpfSTEzNjE1MjQ5NzY6Vks6MjQ0MDU2Mzc2ODkxMzQxMzc=');
  assert.equal(merged.feedbackId, 'ZmVlZGJhY2s6MjQ0MDU2Mzc2ODkxMzQxMzc=');
  assert.equal(merged.authorId, '1361524976');
  assert.equal(merged.groupId, '2664056243718928');
  assert.equal(merged.postedAtTimestamp, 1772484099);
  assert.equal(merged.postedAtIso, '2026-03-02T20:41:39.000Z');
  assert.match(merged.bodyText, /Thanks!/);
  assert.equal(merged.captureHints.networkEnrichment.matchScore, bestMatch.score);
  assert.deepEqual(merged.captureHints.networkEnrichment.matchReasons, bestMatch.reasons);
  assert.equal(merged.captureHints.networkEnrichment.identityRecovered, true);
  assert.equal(merged.captureHints.networkEnrichment.matchedCaptureMode, 'full_text');
  assert.equal(merged.captureHints.networkEnrichment.matchedRetentionReason, 'high_signal_full_text');
  assert.equal(merged.captureHints.networkEnrichment.matchedCaptureId, 'netcap_0001');
});

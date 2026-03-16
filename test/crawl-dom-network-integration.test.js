import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  choosePreferredCollectedPost,
  createCollectedPost,
  getCollectedIdentityAliases,
  getCollectedPostKey,
} from '../src/core/collected-post.js';
import {
  applyNetworkCandidateMatch,
  beginNetworkIntegrationStep,
  createNetworkIntegrationState,
  getNetworkCandidateKey,
  createWorkingSetEntry,
  matchNetworkCandidateForPost,
  registerNetworkCandidates,
  registerResolvedPostForReuse,
  resolveWorkingSetEntries,
  resolveWorkingSetEntry,
} from '../src/cli/crawl-dom-latest.network-integration.js';

function readNetworkFixture(name) {
  return fs.readFileSync(path.resolve('test/fixtures/facebook-network', name), 'utf8');
}

function buildAlisonEnvelopeItem() {
  return {
    captureId: 'netcap_0001',
    captureMode: 'full_text',
    retentionReason: 'high_signal_full_text',
    capturePhase: 'after-expand',
    stepIndex: 4,
    sourceTransport: 'fetch',
    url: 'https://www.facebook.com/api/graphql/',
    method: 'POST',
    fbApiReqFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
    docId: '26032294259753860',
    actorId: '665233712',
    requestTimestamp: '2026-03-15T23:19:44.377Z',
    responseTimestamp: '2026-03-15T23:19:45.271Z',
    capturedText: readNetworkFixture('alison-multidoc.txt'),
    matchHints: {
      groupIds: ['2664056243718928'],
      postIds: ['24405637689134137'],
      storyIds: ['24405637689134137'],
      feedbackIds: ['24405637689134137'],
    },
  };
}

function createAlisonDomPost(bodyText) {
  return createCollectedPost({
    author: 'Alison Jolimet Fages',
    postedAtText: 'March 2 at 3:41 PM',
    bodyText,
    hasSeeMore: true,
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });
}

function createPamelaDomPost(bodyText, options = {}) {
  return createCollectedPost({
    author: 'Pamela Rogel',
    postedAtText: options.postedAtText ?? null,
    bodyText,
    hasSeeMore: false,
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: options.includeGroupId === false ? null : '2664056243718928',
    captureMethod: 'dom',
  });
}

function upsertCollectedRegistry(registry, post) {
  for (const alias of getCollectedIdentityAliases(post)) {
    const existingKey = registry.identityAliases.get(alias);
    if (existingKey) {
      const preferred = choosePreferredCollectedPost(registry.posts.get(existingKey), post);
      registry.posts.set(existingKey, preferred);
      for (const nextAlias of getCollectedIdentityAliases(preferred)) {
        registry.identityAliases.set(nextAlias, existingKey);
      }
      return existingKey;
    }
  }

  const key = getCollectedPostKey(post);
  const preferred = choosePreferredCollectedPost(registry.posts.get(key), post);
  registry.posts.set(key, preferred);
  for (const alias of getCollectedIdentityAliases(preferred)) {
    registry.identityAliases.set(alias, key);
  }
  return key;
}

test('resolved duplicate reuse preserves Pamela-style overlap reuse without keeping fuzzy matches globally reusable', () => {
  const state = createNetworkIntegrationState(true);
  beginNetworkIntegrationStep(state, 4);
  registerNetworkCandidates(state, [buildAlisonEnvelopeItem()], 4);

  const firstEntry = resolveWorkingSetEntry(
    state,
    createWorkingSetEntry(
      {
        author: 'Alison Jolimet Fages',
        bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      },
      createAlisonDomPost(
        'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      ),
      4,
    ),
    4,
  );

  assert.equal(firstEntry.post.postId, '24405637689134137');
  assert.equal(firstEntry.mergeResult.matchSummary.matchStrategy, 'fuzzy_recovery');
  assert.equal(getCollectedPostKey(firstEntry.post), '24405637689134137');

  beginNetworkIntegrationStep(state, 5);

  const overlapEntry = resolveWorkingSetEntry(
    state,
    createWorkingSetEntry(
      {
        author: 'Alison Jolimet Fages',
        bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg. Preferably close to Graham Av.',
      },
      createAlisonDomPost(
        'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg. Preferably close to Graham Av.',
      ),
      5,
    ),
    5,
  );

  assert.equal(overlapEntry.post.postId, '24405637689134137');
  assert.equal(overlapEntry.mergeResult.matchSummary.matchStrategy, 'resolved_duplicate');
  assert.equal(getCollectedPostKey(overlapEntry.post), '24405637689134137');

  const unrelatedSameAuthor = createAlisonDomPost(
    'Offering my bright railroad one bedroom in Greenpoint for May 1. $3,200 and cats are okay.',
  );
  const unrelatedMatch = matchNetworkCandidateForPost(state, unrelatedSameAuthor);
  assert.equal(unrelatedMatch, null);
});

test('resolved duplicate reuse tolerates network group-id enrichment and DOM spacing drift', () => {
  const state = createNetworkIntegrationState(true);
  const enrichedPamela = createPamelaDomPost(
    '2 bedroom April 1 move in!\nFor info text me 7187221840\nThis is a large, legitimate 2-bedroom apartment with palpable old-world charm.',
    { includeGroupId: true },
  );

  enrichedPamela.postId = '24495759786788593';
  enrichedPamela.postUrl = 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24495759786788593/';

  registerResolvedPostForReuse(state, enrichedPamela, {
    candidate: enrichedPamela,
    captureMode: 'persisted_post',
    stepIndex: 15,
    entryKey: enrichedPamela.postId,
  });

  beginNetworkIntegrationStep(state, 16);

  const domOnlyPamela = createPamelaDomPost(
    '2 bedroom April 1 move in!For info text me 7187221840This is a large, legitimate 2-bedroom apartment with palpable old-world charm.',
    { includeGroupId: false, postedAtText: '3 days ago' },
  );
  const overlapMatch = matchNetworkCandidateForPost(state, domOnlyPamela);

  assert.ok(overlapMatch);
  assert.equal(overlapMatch.matchKind, 'resolved_duplicate');
  assert.equal(overlapMatch.entry.candidate.postId, '24495759786788593');
});

test('url-only recovered identities use canonical postUrl for collected keys and recovery metrics', () => {
  const domPost = createCollectedPost({
    author: 'Casey Example',
    postedAtText: null,
    bodyText: 'Offering a room in Williamsburg starting May 1.',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    captureMethod: 'dom',
  });

  const mergeResult = applyNetworkCandidateMatch(domPost, {
    entry: {
      captureId: 'netcap_url_0001',
      captureMode: 'matched_fragments',
      retentionReason: 'full_text_budget_exhausted',
      stepIndex: 8,
      capturePhase: 'after-scroll',
    },
    bestMatch: {
      candidate: {
        postId: null,
        postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/url-only-post/',
        authorName: 'Casey Example',
        bodyText: 'Offering a room in Williamsburg starting May 1.',
      },
      score: 180,
      reasons: ['author_exact', 'body_strong_overlap', 'post_url'],
    },
    matchKind: 'fuzzy_recovery',
  }, 8);

  assert.equal(mergeResult.recoveredIdentity, true);
  assert.equal(mergeResult.matchSummary.recoveredIdentity, true);
  assert.equal(
    getCollectedPostKey(mergeResult.post),
    'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/url-only-post/',
  );
});

test('collected registry aliases postUrl and postId to one canonical entry and keeps the richer version', () => {
  const registry = {
    posts: new Map(),
    identityAliases: new Map(),
  };

  const urlOnlyPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/url-only-post/',
    comments: ['First comment'],
    media: [{ type: 'photo', url: 'https://example.com/photo-1.jpg' }],
    attachmentSummary: {
      count: 1,
      types: ['photo'],
      titles: ['Listing photo'],
    },
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    captureMethod: 'dom',
    rawArtifactPath: 'raw/url-only.json',
  });

  const richerPost = {
    ...urlOnlyPost,
    postId: '24490000000000000',
    authorId: '100000000000001',
    comments: [],
    media: [],
    attachmentSummary: null,
    rawArtifactPath: null,
  };

  const laterUrlOnlyPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/url-only-post/',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    captureMethod: 'dom',
  });

  const firstKey = upsertCollectedRegistry(registry, urlOnlyPost);
  const secondKey = upsertCollectedRegistry(registry, richerPost);
  const thirdKey = upsertCollectedRegistry(registry, laterUrlOnlyPost);

  assert.equal(firstKey, secondKey);
  assert.equal(secondKey, thirdKey);
  assert.equal(registry.posts.size, 1);
  assert.equal(registry.posts.get(firstKey).postId, '24490000000000000');
  assert.deepEqual(registry.posts.get(firstKey).comments, ['First comment']);
  assert.deepEqual(registry.posts.get(firstKey).media, [{ type: 'photo', url: 'https://example.com/photo-1.jpg' }]);
  assert.deepEqual(registry.posts.get(firstKey).attachmentSummary, {
    count: 1,
    types: ['photo'],
    titles: ['Listing photo'],
    media: [],
  });
  assert.equal(registry.posts.get(firstKey).rawArtifactPath, 'raw/url-only.json');
});

test('equivalent Facebook postUrl forms normalize to one collected identity alias', () => {
  const registry = {
    posts: new Map(),
    identityAliases: new Map(),
  };

  const storyPhpPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://www.facebook.com/story.php?story_fbid=24490000000000000&id=2664056243718928&foo=1',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });

  const canonicalPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://m.facebook.com/groups/2664056243718928/posts/24490000000000000',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });

  const firstKey = upsertCollectedRegistry(registry, storyPhpPost);
  const secondKey = upsertCollectedRegistry(registry, canonicalPost);
  const slugPathPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24490000000000000/',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });
  const thirdKey = upsertCollectedRegistry(registry, slugPathPost);

  assert.equal(
    firstKey,
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );
  assert.equal(firstKey, secondKey);
  assert.equal(secondKey, thirdKey);
  assert.equal(registry.posts.size, 1);
});

test('exact identity matching canonicalizes slug and numeric group post urls', () => {
  const state = createNetworkIntegrationState(true);
  const candidate = {
    postId: null,
    postUrl: 'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
    authorName: 'Casey Example',
    groupId: '2664056243718928',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
  };
  const candidateKey = getNetworkCandidateKey(candidate, 'candidate-1');

  state.candidateEntries.set(candidateKey, {
    key: candidateKey,
    candidate,
    captureId: 'netcap_exact_0001',
    captureMode: 'full_text',
    retentionReason: 'high_signal_full_text',
    stepIndex: 6,
    capturePhase: 'after-expand',
    fuzzyConsumed: false,
  });
  state.exactIdentityIndex.set(
    'post_url:https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
    candidateKey,
  );

  const domPost = createCollectedPost({
    author: 'Casey Example',
    bodyText: 'Offering a room in Williamsburg starting May 1.',
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24490000000000000/',
  }, {
    sourceKey: 'williamsburggreenpointhousing',
    groupName: 'Williamsburg Greenpoint Housing',
    groupId: '2664056243718928',
    captureMethod: 'dom',
  });

  const match = matchNetworkCandidateForPost(state, domPost);

  assert.ok(match);
  assert.equal(match.matchKind, 'exact_identity');
  assert.equal(match.entry.key, candidateKey);
});

test('resolved duplicate reuse replaces an older url-only entry with a richer postId entry for the same post', () => {
  const state = createNetworkIntegrationState(true);
  const urlOnlyPamela = {
    ...createPamelaDomPost(
      '2 bedroom April 1 move in!\nFor info text me 7187221840\nThis is a large, legitimate 2-bedroom apartment with palpable old-world charm.',
      { includeGroupId: false },
    ),
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24495759786788593/',
  };

  registerResolvedPostForReuse(state, urlOnlyPamela, {
    candidate: urlOnlyPamela,
    captureMode: 'persisted_post',
    stepIndex: 15,
    entryKey: urlOnlyPamela.postUrl,
  });

  const richerPamela = {
    ...urlOnlyPamela,
    postId: '24495759786788593',
    groupId: '2664056243718928',
  };
  registerResolvedPostForReuse(state, richerPamela, {
    candidate: richerPamela,
    captureMode: 'persisted_post',
    stepIndex: 16,
    entryKey: richerPamela.postId,
  });

  beginNetworkIntegrationStep(state, 17);
  const overlapMatch = matchNetworkCandidateForPost(
    state,
    createPamelaDomPost(
      '2 bedroom April 1 move in!For info text me 7187221840This is a large, legitimate 2-bedroom apartment with palpable old-world charm.',
      { includeGroupId: false, postedAtText: '3 days ago' },
    ),
  );

  assert.ok(overlapMatch);
  assert.equal(overlapMatch.matchKind, 'resolved_duplicate');
  assert.equal(overlapMatch.entry.candidate.postId, '24495759786788593');
});

test('fuzzy recovery consumes identity aliases so richer re-registrations do not reopen the fuzzy pool', () => {
  const state = createNetworkIntegrationState(true);
  beginNetworkIntegrationStep(state, 4);

  const urlOnlyCandidate = {
    postId: null,
    postUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24405637689134137/',
    storyId: 'story:24405637689134137',
    feedbackId: 'feedback:24405637689134137',
    authorName: 'Alison Jolimet Fages',
    groupId: '2664056243718928',
    bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
    partial: true,
  };

  state.candidateEntries.set(urlOnlyCandidate.postUrl, {
    key: urlOnlyCandidate.postUrl,
    candidate: urlOnlyCandidate,
    captureId: 'netcap_urlonly_0001',
    captureMode: 'matched_fragments',
    retentionReason: 'matched_fragments',
    stepIndex: 4,
    capturePhase: 'after-expand',
    fuzzyConsumed: false,
  });
  state.fuzzyCandidateKeys.add(urlOnlyCandidate.postUrl);

  const resolvedEntry = resolveWorkingSetEntry(
    state,
    createWorkingSetEntry(
      {
        author: 'Alison Jolimet Fages',
        bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      },
      createAlisonDomPost(
        'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      ),
      4,
    ),
    4,
  );

  assert.equal(
    resolvedEntry.post.postUrl,
    'https://www.facebook.com/groups/2664056243718928/posts/24405637689134137/',
  );
  assert.equal(state.fuzzyCandidateKeys.has(urlOnlyCandidate.postUrl), false);
  assert.equal(
    state.consumedFuzzyIdentityKeys.has(
      'post_url:https://www.facebook.com/groups/2664056243718928/posts/24405637689134137/',
    ),
    true,
  );

  registerNetworkCandidates(state, [{
    ...buildAlisonEnvelopeItem(),
    captureId: 'netcap_0002',
    stepIndex: 5,
    capturePhase: 'after-scroll',
  }], 5);

  assert.equal(state.fuzzyCandidateKeys.has('24405637689134137'), false);
  assert.equal(
    state.consumedFuzzyIdentityKeys.has('post_id:24405637689134137'),
    true,
  );
});

test('same-step multi-batch drains can recover identity before finalize without a post-loop backpatch', () => {
  const state = createNetworkIntegrationState(true);
  beginNetworkIntegrationStep(state, 4);

  let workingSet = [
    createWorkingSetEntry(
      {
        author: 'Alison Jolimet Fages',
        bodyText: 'Hello! Looking for a +2 bedrooms.',
      },
      createAlisonDomPost('Hello! Looking for a +2 bedrooms.'),
      4,
    ),
  ];

  workingSet = resolveWorkingSetEntries(state, workingSet, 4);
  assert.equal(workingSet[0].post.postId, null);

  registerNetworkCandidates(state, [buildAlisonEnvelopeItem()], 4);
  workingSet = resolveWorkingSetEntries(state, workingSet, 4);

  assert.equal(workingSet[0].post.postId, '24405637689134137');
  assert.equal(workingSet[0].stepIndex, 4);
  assert.equal(workingSet[0].mergeResult.matchSummary.captureId, 'netcap_0001');
  assert.equal(workingSet[0].mergeResult.matchSummary.stepIndex, 4);
});

test('late-pass resolution skips already matched entries so original recovery provenance survives', () => {
  const state = createNetworkIntegrationState(true);
  beginNetworkIntegrationStep(state, 4);
  registerNetworkCandidates(state, [buildAlisonEnvelopeItem()], 4);

  const firstPass = resolveWorkingSetEntry(
    state,
    createWorkingSetEntry(
      {
        author: 'Alison Jolimet Fages',
        bodyText: 'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      },
      createAlisonDomPost(
        'Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.',
      ),
      4,
    ),
    4,
  );

  const secondPass = resolveWorkingSetEntries(state, [firstPass], 4, {
    onlyWithoutIdentity: true,
    skipMatched: true,
  })[0];

  assert.equal(secondPass.mergeResult.matchSummary.matchStrategy, 'fuzzy_recovery');
  assert.equal(secondPass.mergeResult.recoveredIdentity, true);
  assert.equal(secondPass.mergeResult.matchSummary.captureId, 'netcap_0001');
});

test('recent network candidates stay fuzzy-matchable across a bounded step window, but not indefinitely', () => {
  const state = createNetworkIntegrationState(true);
  beginNetworkIntegrationStep(state, 10);
  registerNetworkCandidates(state, [{
    ...buildAlisonEnvelopeItem(),
    captureId: 'netcap_0010',
    stepIndex: 10,
    capturePhase: 'after-scroll',
  }], 10);

  beginNetworkIntegrationStep(state, 13);
  const stillRecentMatch = matchNetworkCandidateForPost(
    state,
    createAlisonDomPost('Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.'),
  );

  assert.ok(stillRecentMatch);
  assert.equal(stillRecentMatch.matchKind, 'fuzzy_recovery');
  assert.equal(stillRecentMatch.entry.stepIndex, 10);

  beginNetworkIntegrationStep(state, 17);
  const staleMatch = matchNetworkCandidateForPost(
    state,
    createAlisonDomPost('Hello! Looking for a +2 bedrooms, big living room with a lot of light, max 6.5k in Williamsburg.'),
  );

  assert.equal(staleMatch, null);
});

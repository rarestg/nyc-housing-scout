import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createCollectedPost, classifyCollectedPostFreshness } from '../src/core/collected-post.js';
import { extractListingsFromPost } from '../src/extractors/text-extractor.js';

test('createCollectedPost produces the canonical DOM collected-post shape', () => {
  const collected = createCollectedPost({
    index: 4,
    postId: '24491142917250280',
    postUrl: 'https://www.facebook.com/groups/2664056243718928/posts/24491142917250280/',
    author: 'James Cashen',
    postedAtText: '6 h',
    bodyText: 'Large Renovated 1BR Railroad in Greenpoint - April 1 Lease Assignment\nRent: $2,700/month',
    mediaLinks: [
      'https://www.facebook.com/photo/?fbid=1',
      'https://www.facebook.com/100013125948408/videos/pcb.24491142917250280/3104111656447985',
    ],
    hasSeeMore: true,
    seeMoreText: 'See more',
  }, {
    sourceKey: 'facebook-default',
    groupName: 'NYC Housing',
    captureMethod: 'dom',
    captureRunId: 'run-1',
    capturedAt: '2026-03-12T20:00:00.000Z',
    rawArtifactPath: 'data/raw/facebook/facebook-default/run-1/24491142917250280-004.json',
  });

  assert.equal(collected.platform, 'facebook');
  assert.equal(collected.sourceKey, 'facebook-default');
  assert.equal(collected.groupName, 'NYC Housing');
  assert.equal(collected.authorName, 'James Cashen');
  assert.equal(collected.captureMethod, 'dom');
  assert.equal(collected.captureRunId, 'run-1');
  assert.equal(collected.rawArtifactPath, 'data/raw/facebook/facebook-default/run-1/24491142917250280-004.json');
  assert.deepEqual(collected.comments, []);
  assert.deepEqual(collected.media.map((item) => item.type), ['photo', 'video']);
  assert.equal(collected.captureHints.hasSeeMore, true);
  assert.equal(collected.derivedLocation.neighborhood, 'Greenpoint');
});

test('extractListingsFromPost propagates collected-post source metadata and parses comma amounts', () => {
  const post = createCollectedPost({
    postId: '24461028513595054',
    postUrl: 'https://www.facebook.com/groups/2664056243718928/posts/24461028513595054/',
    author: 'Alex Rivera',
    postedAtText: '2 h',
    bodyText: 'Roommate Wanted - Available April 1st\nRent: $1,600/month (utilities included)\nPrivate room in Williamsburg.',
  }, {
    sourceKey: 'facebook-default',
    groupName: 'NYC Housing',
    captureMethod: 'dom',
    captureRunId: 'run-2',
    capturedAt: '2026-03-12T20:05:00.000Z',
    rawArtifactPath: 'data/raw/facebook/facebook-default/run-2/24461028513595054-000.json',
  });

  const [listing] = extractListingsFromPost(post);

  assert.equal(listing.pricing.amount, 1600);
  assert.equal(listing.pricing.period, 'month');
  assert.equal(listing.postIntent, 'offering');
  assert.equal(listing.listingType, 'room_in_shared');
  assert.equal(listing.source.sourceKey, 'facebook-default');
  assert.equal(listing.source.groupName, 'NYC Housing');
  assert.equal(listing.source.postId, '24461028513595054');
  assert.equal(listing.source.postUrl, post.postUrl);
  assert.equal(listing.source.authorName, 'Alex Rivera');
  assert.equal(listing.source.postedAtText, '2 h');
  assert.equal(listing.source.capturedAt, '2026-03-12T20:05:00.000Z');
  assert.equal(listing.source.captureMethod, 'dom');
  assert.equal(listing.source.captureRunId, 'run-2');
  assert.equal(listing.source.rawArtifactPath, 'data/raw/facebook/facebook-default/run-2/24461028513595054-000.json');
});

test('mixed-rate text keeps amount and period aligned', () => {
  const bodyText = fs.readFileSync(path.resolve('examples/michaela-kerem-post.txt'), 'utf8');
  const post = createCollectedPost({
    postId: '24492404357124136',
    author: 'Michaela Kerem',
    postedAtText: 'Yesterday',
    bodyText,
  }, {
    sourceKey: 'facebook-default',
    captureMethod: 'dom',
    captureRunId: 'run-3',
    capturedAt: '2026-03-12T20:10:00.000Z',
    rawArtifactPath: 'data/raw/facebook/facebook-default/run-3/24492404357124136-000.json',
  });

  const [listing] = extractListingsFromPost(post);

  assert.equal(listing.pricing.amount, 1500);
  assert.equal(listing.pricing.period, 'month');
});

test('freshness classification distinguishes seen and unidentified posts', () => {
  const seenIds = new Set(['24491142917250280']);
  const seenPost = createCollectedPost({ postId: '24491142917250280', bodyText: 'Seen post', author: 'Seen Author' });
  const unidentifiedPost = createCollectedPost({ bodyText: 'Unknown post', author: 'Unknown Author' });

  assert.equal(classifyCollectedPostFreshness(seenPost, seenIds), 'seen');
  assert.equal(classifyCollectedPostFreshness(unidentifiedPost, seenIds), 'unidentified');
});

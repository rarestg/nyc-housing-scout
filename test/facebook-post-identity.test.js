import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFacebookFallbackPostUrl,
  extractFacebookPostIdFromUrl,
  normalizeFacebookPostUrl,
} from '../src/core/facebook-post-identity.js';

test('normalizeFacebookPostUrl canonicalizes supported Facebook post URL shapes', () => {
  assert.equal(
    normalizeFacebookPostUrl('https://www.facebook.com/story.php?story_fbid=24490000000000000&id=2664056243718928&foo=1'),
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );

  assert.equal(
    normalizeFacebookPostUrl('https://m.facebook.com/permalink.php?story_fbid=24490000000000000&id=2664056243718928'),
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );

  assert.equal(
    normalizeFacebookPostUrl('https://www.facebook.com/groups/williamsburggreenpointhousing/?multi_permalinks=24490000000000000'),
    'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24490000000000000/',
  );

  assert.equal(
    normalizeFacebookPostUrl(
      'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24490000000000000/',
      { groupId: '2664056243718928' },
    ),
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );
});

test('extractFacebookPostIdFromUrl recovers ids from canonical and query-driven Facebook urls', () => {
  assert.equal(
    extractFacebookPostIdFromUrl('https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/'),
    '24490000000000000',
  );

  assert.equal(
    extractFacebookPostIdFromUrl('https://www.facebook.com/story.php?story_fbid=24490000000000000&id=2664056243718928'),
    '24490000000000000',
  );

  assert.equal(
    extractFacebookPostIdFromUrl('https://www.facebook.com/groups/williamsburggreenpointhousing/?multi_permalinks=24490000000000000'),
    '24490000000000000',
  );
});

test('buildFacebookFallbackPostUrl constructs a canonical post url from postId plus group context', () => {
  assert.equal(
    buildFacebookFallbackPostUrl('24490000000000000', {
      groupId: '2664056243718928',
      groupUrl: 'https://m.facebook.com/groups/williamsburggreenpointhousing/',
    }),
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );

  assert.equal(
    buildFacebookFallbackPostUrl('24490000000000000', {
      groupId: '2664056243718928',
    }),
    'https://www.facebook.com/groups/2664056243718928/posts/24490000000000000/',
  );
});

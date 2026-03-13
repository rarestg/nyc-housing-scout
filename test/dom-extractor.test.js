import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DOM_EXTRACTOR_FN } from '../src/browser/dom-extractor.js';

function runDomHtml(html, url = 'https://www.facebook.com/groups/2664056243718928/') {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url,
  });

  try {
    return dom.window.eval(`(${DOM_EXTRACTOR_FN})()`);
  } finally {
    dom.window.close();
  }
}

function runDomFixture(name) {
  const fixturePath = path.resolve('test/fixtures/dom', name);
  const html = fs.readFileSync(fixturePath, 'utf8');
  return runDomHtml(html);
}

test('DOM extractor keeps metadata bound to the correct article across a multi-story feed container', () => {
  const posts = runDomFixture('paired-article-feed.html');

  assert.equal(posts.length, 2);
  assert.deepEqual(Array.from(posts, (post) => ({
    postId: post.postId,
    author: post.author,
    postUrl: post.postUrl,
    postedAtText: post.postedAtText,
  })), [
    {
      postId: '24491142917250280',
      author: 'James Cashen',
      postUrl: 'https://www.facebook.com/story.php?story_fbid=24491142917250280&id=2664056243718928',
      postedAtText: 'March 11 at 4:53 PM',
    },
    {
      postId: '24461028513595054',
      author: 'Alex Rivera',
      postUrl: 'https://www.facebook.com/groups/2664056243718928/posts/24461028513595054/',
      postedAtText: 'Yesterday',
    },
  ]);
});

test('DOM extractor climbs above shallow action-link wrappers to recover header metadata', () => {
  const [post] = runDomFixture('nested-body-shell-actions.html');

  assert.equal(post.postId, '24492404357124136');
  assert.equal(post.author, 'Michaela Kerem');
  assert.equal(post.postUrl, 'https://www.facebook.com/groups/2664056243718928/posts/24492404357124136/');
  assert.equal(post.postedAtText, 'Yesterday at 6:10 PM');
  assert.equal(post.hasSeeMore, true);
  assert.equal(post.seeMoreText, 'See more');
});

test('DOM extractor ignores media aria-label noise and reconstructs group permalinks from media post ids', () => {
  const [post] = runDomHtml(`
    <article role="article">
      <header>
        <a href="/jared.hsu">Jared Hsu</a>
        <a href="/photo/?fbid=10231825135186683&set=gm.24442286615469244">photo</a>
        <div aria-label="May be an image of indoors and bedroom, 8 remaining items"></div>
      </header>
      <div data-ad-rendering-role="story_message">
        Looking for roommate for this 2BR/2BA apartment in Williamsburg.
      </div>
    </article>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.author, 'Jared Hsu');
  assert.equal(post.postId, '24442286615469244');
  assert.equal(post.postUrl, 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24442286615469244/');
  assert.equal(post.postedAtText, null);
});

test('DOM extractor recovers aria-labelledby time labels without treating media descriptions as timestamps', () => {
  const [post] = runDomFixture('aria-labelledby-time-media-fallback.html');

  assert.equal(post.author, 'Fareed Khan');
  assert.equal(post.postId, '24491142917250280');
  assert.equal(post.postUrl, 'https://www.facebook.com/groups/2664056243718928/posts/24491142917250280/');
  assert.equal(post.postedAtText, '10 hours ago');
  assert.ok(post.debugMetadata.timeCandidates.some((candidate) => candidate.value === '10 hours ago' && candidate.from === 'labelledby'));
});

test('DOM extractor decodes encoded feedback ids from avatar edit links when no direct permalink is exposed', () => {
  const [post] = runDomFixture('encoded-post-id-fallback.html');

  assert.equal(post.author, 'Grace Ahn');
  assert.equal(post.postId, '24461028513595054');
  assert.equal(post.postUrl, 'https://www.facebook.com/groups/2664056243718928/posts/24461028513595054/');
  assert.equal(post.postedAtText, '3 days ago');
});

test('DOM extractor preserves broader href evidence and trimmed card context for missing-postUrl cards', () => {
  const [post] = runDomHtml(`
    <article role="article">
      <div>
        <div data-ad-rendering-role="profile_name">Grace Ahn</div>
        <a
          href="/groups/williamsburggreenpointhousing/?__tn__=%2CO%2CP-R#?bjb"
          aria-labelledby="time-label"
        >
          hidden time
        </a>
        <span id="time-label">3 days ago</span>
      </div>
      <div data-ad-rendering-role="story_message">
        ISO new lease or lease takeover for entire apartment.
      </div>
    </article>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.postUrl, null);
  assert.equal(post.postId, null);
  assert.equal(post.postedAtText, '3 days ago');
  assert.ok(post.debugMetadata.missingPostUrlContext);
  assert.equal(post.debugMetadata.missingPostUrlContext.selectedCard.scope, 'selected-card');
  assert.ok(post.debugMetadata.missingPostUrlContext.selectedCard.html.includes('story_message'));
  assert.ok(post.debugMetadata.missingPostUrlContext.cardAnchorEvidence.some((entry) =>
    entry.href.includes('/groups/williamsburggreenpointhousing/')
    && entry.timeHint === '3 days ago'
    && entry.normalizedPostUrl === null
  ));
});

test('DOM extractor captures ancestor href evidence when the chosen card misses an outer permalink', () => {
  const noiseAnchors = Array.from({ length: 45 }, (_, index) => (
    `<a href="/groups/williamsburggreenpointhousing/about/?noise=${index}">noise ${index}</a>`
  )).join('');
  const [post] = runDomHtml(`
    <div class="outer-shell">
      <div class="outer-header">
        <a href="/groups/williamsburggreenpointhousing/posts/24412345678901234/">Yesterday</a>
        ${noiseAnchors}
      </div>
      <article role="article">
        <div data-ad-rendering-role="profile_name">Boundary Miss</div>
        <div data-ad-rendering-role="story_message">
          Looking for a 2 bedroom sublet in Greenpoint.
        </div>
      </article>
    </div>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.postUrl, null);
  assert.ok(post.debugMetadata.missingPostUrlContext);
  assert.ok(post.debugMetadata.missingPostUrlContext.ancestorAnchorEvidence.some((entry) =>
    entry.scope === 'ancestor-1'
    && entry.normalizedPostUrl === 'https://www.facebook.com/groups/williamsburggreenpointhousing/posts/24412345678901234/'
    && entry.timeHint === 'Yesterday'
  ));
});


test('DOM extractor rejects listing copy as author text when a real author is present elsewhere in the card', () => {
  const [post] = runDomHtml(`
    <article role="article">
      <div>
        <strong>Furnished or Unfurnished</strong>
        <a href="/groups/williamsburggreenpointhousing/posts/24464251299939442/">2d</a>
      </div>
      <div>
        <h3><a href="/taylin.fernandez">Taylin Fernandez</a></h3>
      </div>
      <div data-ad-rendering-role="story_message">
        Greenpoint Luxury 1BR w/ Deck + Pool | Furnished or Unfurnished
      </div>
    </article>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.author, 'Taylin Fernandez');
  assert.equal(post.postId, '24464251299939442');
  assert.equal(post.postedAtText, '2d');
});

test('DOM extractor rejects external domain links as author candidates and keeps debug header snapshots', () => {
  const [post] = runDomHtml(`
    <article role="article">
      <div>
        <div data-ad-rendering-role="profile_name">Andrew Jacobs</div>
        <a href="https://andrewjacobs.us">andrewjacobs.us</a>
      </div>
      <div data-ad-rendering-role="story_message">
        Looking for up to 2 roommates to find a place in or close to Greenpoint.
      </div>
    </article>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.author, 'Andrew Jacobs');
  assert.equal(post.debugMetadata.authorCandidates[0].value, 'Andrew Jacobs');
  assert.ok(Array.isArray(post.debugMetadata.headerSnapshot));
  assert.ok(post.debugMetadata.headerSnapshot.length >= 1);
});

test('DOM extractor can recover time from a bounded top-of-card fallback when direct header roots are empty', () => {
  const [post] = runDomHtml(`
    <article role="article">
      <div>
        <div>
          <a href="/groups/williamsburggreenpointhousing/posts/24499999999999999/">3d</a>
        </div>
      </div>
      <section>
        <div>
          <div data-ad-rendering-role="story_message">
            Greenpoint room available now.
          </div>
        </div>
      </section>
    </article>
  `, 'https://www.facebook.com/groups/williamsburggreenpointhousing/');

  assert.equal(post.postId, '24499999999999999');
  assert.equal(post.postedAtText, '3d');
  assert.ok(post.debugMetadata.timeCandidates.some((c) => c.value === '3d'));
});

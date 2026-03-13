import path from 'node:path';
import { DOM_EXTRACTOR_FN } from '../browser/dom-extractor.js';
import { DOM_EXPAND_VISIBLE_FN, DOM_SCROLL_PAGE_FN, DOM_PAGE_STATE_FN } from '../browser/dom-helpers.js';
import { evaluateJson, readFlag, runBrowser } from '../core/browser-pipeline.js';
import { prepareArtifactLayers, writeRawArtifact, writeRunArtifact } from '../core/artifacts.js';
import { buildCollectedPostArtifactId, createCollectedPost, getCollectedPostKey } from '../core/collected-post.js';
import { extractListingsFromPost } from '../extractors/text-extractor.js';
import { createStorage } from '../storage/storage.js';
import { readSourceOptions } from '../storage/source-config.js';

const args = process.argv.slice(2);
const target = Number(readFlag(args, '--target', '20'));
const maxScrolls = Number(readFlag(args, '--max-scrolls', '20'));
const profile = readFlag(args, '--browser-profile', 'chrome');
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
const collected = new Map();
const listings = [];
const stepLog = [];
const counters = {
  fresh: 0,
  seen: 0,
  unidentified: 0,
};
const capturedAt = new Date().toISOString();

for (let step = 0; step <= maxScrolls; step += 1) {
  const expandResult = evaluateJson(DOM_EXPAND_VISIBLE_FN, profile);
  runBrowser(['wait', '--browser-profile', profile, '--time', '700']);
  const pageStateBefore = evaluateJson(DOM_PAGE_STATE_FN, profile);
  const visible = evaluateJson(DOM_EXTRACTOR_FN, profile);

  let addedThisRound = 0;
  let freshThisRound = 0;
  let seenThisRound = 0;
  let unidentifiedThisRound = 0;
  const listingRecords = [];

  for (const rawPost of visible) {
    const post = createCollectedPost(rawPost, {
      platform: source.platform,
      sourceKey: source.sourceKey,
      groupName: source.displayName,
      captureMethod: 'dom',
      captureRunId: run.id,
      capturedAt,
    });
    const key = getCollectedPostKey(post);
    if (collected.has(key)) continue;

    const rawArtifact = writeRawArtifact(artifactLayers.rawDir, buildCollectedPostArtifactId(post), rawPost);
    post.rawArtifactPath = rawArtifact.relativePath;
    collected.set(key, post);
    addedThisRound += 1;

    const [result] = storage.recordObservationBatch({
      runId: run.id,
      sourceId: source.id,
      stepIndex: step,
      entries: [{
        post,
        rawArtifact: {
          ...rawArtifact,
          artifactKind: 'raw_post_payload',
          metadata: {
            captureIndex: post.captureIndex,
          },
        },
      }],
    });
    counters[result.freshness] += 1;

    if (result.freshness === 'fresh') {
      freshThisRound += 1;
      const extracted = extractListingsFromPost(post);
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

    if (counters.fresh >= target) break;
  }

  stepLog.push({
    step,
    expanded: expandResult.clickedCount,
    visiblePosts: visible.length,
    addedThisRound,
    freshThisRound,
    seenThisRound,
    unidentifiedThisRound,
    freshCollected: counters.fresh,
    seenCollected: counters.seen,
    unidentifiedCollected: counters.unidentified,
    scrollY: pageStateBefore.scrollY,
    bodyHeight: pageStateBefore.bodyHeight,
    pageHref: pageStateBefore.href,
    pageTitle: pageStateBefore.title,
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
    scrollY: pageStateBefore.scrollY,
    bodyHeight: pageStateBefore.bodyHeight,
    pageHref: pageStateBefore.href,
    pageTitle: pageStateBefore.title,
  });

  if (counters.fresh >= target) break;

  const scrollFn = `() => (${DOM_SCROLL_PAGE_FN})(1200)`;
  const scrollResult = evaluateJson(scrollFn, profile);
  runBrowser(['wait', '--browser-profile', profile, '--time', '1200']);

  if (scrollResult.after <= scrollResult.before) {
    const stoppedReason = 'scroll did not advance';
    stepLog.push({ step, stopped: stoppedReason });
    storage.appendRunStep({
      runId: run.id,
      sourceId: source.id,
      stepIndex: step,
      scrollY: scrollResult.after,
      bodyHeight: scrollResult.bodyHeight,
      stoppedReason,
    });
    break;
  }
}

const results = Array.from(collected.values());
const collectedArtifact = writeRunArtifact(artifactLayers.collectedDir, 'crawl', run.id, results);
const listingsArtifact = writeRunArtifact(artifactLayers.listingsDir, 'crawl', run.id, listings);
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
  ],
});

console.log(JSON.stringify({
  runId: run.id,
  ...summary,
  rawArtifactDir: path.relative(process.cwd(), artifactLayers.rawDir),
  collectedArtifact: collectedArtifact.relativePath,
  listingsArtifact: listingsArtifact.relativePath,
  stepLog,
  postIds: results.map((post) => post.postId).filter(Boolean),
}, null, 2));

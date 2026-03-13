import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createCollectedPost } from '../src/core/collected-post.js';
import { extractListingsFromPost } from '../src/extractors/text-extractor.js';
import { createStorage } from '../src/storage/storage.js';

test('sqlite inspection helpers expose sources, runs, steps, observations, listings, artifacts, and validation', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-inspect-'));
  const fixture = seedStorageFixture(dataDir);
  const { storage, run, listings, source } = fixture;

  const sources = storage.listSources({ limit: 10 });
  const runs = storage.listRecentRuns({ sourceKey: source.sourceKey, limit: 5 });
  const steps = storage.listRunSteps({ runId: run.id });
  const observations = storage.listObservations({ runId: run.id, limit: 10 });
  const fullObservation = storage.listObservations({
    observationId: fixture.firstObservationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  });
  const listingRows = storage.listListings({ runId: run.id, includePayload: true });
  const artifacts = storage.listArtifactRefs({ runId: run.id, limit: 10 });
  const validation = storage.validateRun({ runId: run.id });

  storage.close();

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceKey, 'nyc-housing-group');
  assert.equal(sources[0].runCount, 1);
  assert.equal(sources[0].stablePostCount, 1);
  assert.equal(sources[0].observationCount, 3);
  assert.equal(sources[0].listingCount, listings.length);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].runKind, 'crawl');
  assert.equal(runs[0].sourceKey, 'nyc-housing-group');
  assert.equal(runs[0].observationCount, 3);
  assert.equal(runs[0].freshObservationCount, 1);
  assert.equal(runs[0].seenObservationCount, 1);
  assert.equal(runs[0].unidentifiedObservationCount, 1);
  assert.equal(runs[0].listingCount, listings.length);
  assert.equal(runs[0].artifactCount, 5);
  assert.equal(runs[0].runStepCount, 1);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].runId, run.id);
  assert.equal(steps[0].stepIndex, 0);
  assert.equal(steps[0].freshCollected, 1);
  assert.equal(steps[0].unidentifiedCollected, 1);

  assert.equal(observations.length, 3);
  assert.equal(observations[0].freshness, 'seen');
  assert.equal(observations[0].platformPostId, '24461028513595054');
  assert.equal('bodyText' in observations[0], false);
  assert.match(observations[0].bodyTextPreview, /Still available/);

  assert.equal(fullObservation.length, 1);
  assert.equal(fullObservation[0].platformPostId, '24461028513595054');
  assert.match(fullObservation[0].bodyText, /Roommate Wanted/);
  assert.equal(fullObservation[0].payload.postId, '24461028513595054');
  assert.equal(fullObservation[0].comments.length, 0);

  assert.equal(listingRows.length, listings.length);
  assert.equal(listingRows[0].sourceKey, 'nyc-housing-group');
  assert.equal(listingRows[0].observationFreshness, 'fresh');
  assert.equal(listingRows[0].payload.source.sourceKey, 'nyc-housing-group');

  assert.equal(artifacts.length, 5);
  assert.deepEqual(new Set(artifacts.map((artifact) => artifact.artifactKind)), new Set([
    'raw_post_payload',
    'collected_export',
    'listing_export',
  ]));

  assert.equal(validation.isHealthy, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.counts.observations, 3);
  assert.equal(validation.counts.listings, listings.length);
  assert.equal(validation.matches.collected, true);
  assert.equal(validation.matches.withIds, true);
});

test('inspect-storage CLI returns JSON for runs, observations, and validate-run', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-inspect-cli-'));
  const fixture = seedStorageFixture(dataDir);
  fixture.storage.close();

  const cliPath = path.resolve(process.cwd(), 'src/cli/inspect-storage.js');
  const runsResult = runCli(cliPath, ['runs', '--data-dir', dataDir, '--source-key', 'nyc-housing-group', '--limit', '1']);
  const observationsResult = runCli(cliPath, ['observations', '--data-dir', dataDir, '--run-id', fixture.run.id, '--limit', '1', '--full']);
  const validationResult = runCli(cliPath, ['validate-run', '--data-dir', dataDir, '--run-id', fixture.run.id]);

  assert.equal(runsResult.command, 'runs');
  assert.equal(runsResult.count, 1);
  assert.equal(runsResult.results[0].sourceKey, 'nyc-housing-group');

  assert.equal(observationsResult.command, 'observations');
  assert.equal(observationsResult.count, 1);
  assert.equal(observationsResult.results[0].runId, fixture.run.id);
  assert.match(observationsResult.results[0].bodyText, /Still available|Roommate Wanted/);
  assert.ok(observationsResult.results[0].payload);

  assert.equal(validationResult.command, 'validate-run');
  assert.equal(validationResult.result.runId, fixture.run.id);
  assert.equal(validationResult.result.isHealthy, true);
});

function seedStorageFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group',
    browserProfile: 'chrome',
  });
  const run = storage.beginRun({
    runId: '2026-03-12T22-30-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    targetFresh: 1,
    maxScrolls: 4,
    browserProfile: 'chrome',
    captureMethod: 'dom',
  });

  const freshPost = createCollectedPost({
    postId: '24461028513595054',
    postUrl: 'https://www.facebook.com/groups/test/posts/24461028513595054/',
    author: 'Alex Rivera',
    postedAtText: '2 h',
    bodyText: 'Roommate Wanted - Available April 1st\nRent: $1,600/month\nPrivate room in Williamsburg.',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:30:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-30-00-000Z/24461028513595054-000.json',
  });
  const unidentifiedPost = createCollectedPost({
    author: 'Unknown Author',
    bodyText: 'ISO room in Greenpoint',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:31:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-30-00-000Z/unknown-001.json',
  });
  const seenPost = createCollectedPost({
    postId: '24461028513595054',
    postUrl: 'https://www.facebook.com/groups/test/posts/24461028513595054/',
    author: 'Alex Rivera',
    postedAtText: '1 h',
    bodyText: 'Still available in Williamsburg at $1,600/month.',
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:32:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-30-00-000Z/24461028513595054-001.json',
  });

  const firstBatch = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    stepIndex: 0,
    entries: [
      {
        post: freshPost,
        rawArtifact: {
          artifactKind: 'raw_post_payload',
          relativePath: freshPost.rawArtifactPath,
          sha256: 'sha-fresh',
          byteSize: 101,
        },
      },
      {
        post: unidentifiedPost,
        rawArtifact: {
          artifactKind: 'raw_post_payload',
          relativePath: unidentifiedPost.rawArtifactPath,
          sha256: 'sha-unidentified',
          byteSize: 88,
        },
      },
    ],
  });
  storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    stepIndex: 1,
    entries: [
      {
        post: seenPost,
        rawArtifact: {
          artifactKind: 'raw_post_payload',
          relativePath: seenPost.rawArtifactPath,
          sha256: 'sha-seen',
          byteSize: 96,
        },
      },
    ],
  });

  const listings = extractListingsFromPost(freshPost);
  storage.recordListingsBatch({
    runId: run.id,
    sourceId: source.id,
    records: [{
      observationId: firstBatch[0].observation.id,
      listings,
    }],
    extractorVersion: 'test-v1',
  });

  storage.appendRunStep({
    runId: run.id,
    sourceId: source.id,
    stepIndex: 0,
    visiblePosts: 2,
    addedCount: 2,
    freshCount: 1,
    unidentifiedCount: 1,
    freshCollected: 1,
    unidentifiedCollected: 1,
    scrollY: 0,
    bodyHeight: 3200,
    pageHref: 'https://www.facebook.com/groups/test',
    pageTitle: 'Test Group',
  });

  storage.finishRun({
    runId: run.id,
    status: 'completed',
    summary: {
      sourceKey: source.sourceKey,
      collected: 3,
      freshCollected: 1,
      seenCollected: 1,
      unidentifiedCollected: 1,
      extractedListings: listings.length,
      withIds: 2,
    },
    exports: [
      {
        artifactKind: 'collected_export',
        relativePath: 'data/collected/facebook/nyc-housing-group/crawl-2026-03-12T22-30-00-000Z.json',
        sha256: 'sha-collected',
        byteSize: 240,
      },
      {
        artifactKind: 'listing_export',
        relativePath: 'data/listings/facebook/nyc-housing-group/crawl-2026-03-12T22-30-00-000Z.json',
        sha256: 'sha-listings',
        byteSize: 180,
      },
    ],
  });

  return {
    storage,
    source,
    run,
    listings,
    firstObservationId: firstBatch[0].observation.id,
  };
}

function runCli(cliPath, args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

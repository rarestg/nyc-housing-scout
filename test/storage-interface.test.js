import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createCollectedPost } from '../src/core/collected-post.js';
import { extractListingsFromPost } from '../src/extractors/text-extractor.js';
import { createStorage } from '../src/storage/storage.js';

test('sqlite storage tracks sources, run state, observations, listings, and artifact refs', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-storage-'));
  const storage = createStorage({ dataDir });
  const expectedMigrationCount = fs.readdirSync(path.resolve('src/storage/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .length;

  const createdSource = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group',
    browserProfile: 'chrome',
  });
  const updatedSource = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group Updated',
    browserProfile: 'chrome',
  });

  assert.equal(updatedSource.id, createdSource.id);
  assert.equal(updatedSource.displayName, 'NYC Housing Group Updated');

  const run = storage.beginRun({
    runId: '2026-03-12T22-00-00-000Z',
    sourceId: createdSource.id,
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
    sourceKey: 'nyc-housing-group',
    groupName: 'NYC Housing Group Updated',
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:00:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-00-00-000Z/24461028513595054-000.json',
  });
  const unidentifiedPost = createCollectedPost({
    author: 'Unknown Author',
    bodyText: 'ISO room in Greenpoint',
  }, {
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    groupName: 'NYC Housing Group Updated',
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:01:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-00-00-000Z/unknown-001.json',
  });
  const seenPost = createCollectedPost({
    postId: '24461028513595054',
    postUrl: 'https://www.facebook.com/groups/test/posts/24461028513595054/',
    author: 'Alex Rivera',
    postedAtText: '1 h',
    bodyText: 'Still available in Williamsburg at $1,600/month.',
  }, {
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    groupName: 'NYC Housing Group Updated',
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-12T22:02:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-12T22-00-00-000Z/24461028513595054-001.json',
  });

  const firstBatch = storage.recordObservationBatch({
    runId: run.id,
    sourceId: createdSource.id,
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
  const secondBatch = storage.recordObservationBatch({
    runId: run.id,
    sourceId: createdSource.id,
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

  assert.equal(firstBatch[0].freshness, 'fresh');
  assert.equal(firstBatch[1].freshness, 'unidentified');
  assert.equal(secondBatch[0].freshness, 'seen');

  const listings = extractListingsFromPost(freshPost);
  storage.recordListingsBatch({
    runId: run.id,
    sourceId: createdSource.id,
    records: [{
      observationId: firstBatch[0].observation.id,
      listings,
    }],
    extractorVersion: 'test-v1',
  });

  storage.appendRunStep({
    runId: run.id,
    sourceId: createdSource.id,
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
      freshCollected: 1,
      seenCollected: 1,
      unidentifiedCollected: 1,
    },
    exports: [
      {
        artifactKind: 'collected_export',
        relativePath: 'data/collected/facebook/nyc-housing-group/crawl-2026-03-12T22-00-00-000Z.json',
        sha256: 'sha-collected',
        byteSize: 240,
      },
      {
        artifactKind: 'listing_export',
        relativePath: 'data/listings/facebook/nyc-housing-group/crawl-2026-03-12T22-00-00-000Z.json',
        sha256: 'sha-listings',
        byteSize: 180,
      },
    ],
  });

  storage.close();

  const db = new DatabaseSync(path.join(dataDir, 'storage', 'nyc-housing-scout.sqlite'));
  const counts = {
    sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
    runs: db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get().count,
    runSteps: db.prepare('SELECT COUNT(*) AS count FROM crawl_run_steps').get().count,
    stablePosts: db.prepare('SELECT COUNT(*) AS count FROM stable_posts').get().count,
    observations: db.prepare('SELECT COUNT(*) AS count FROM post_observations').get().count,
    listings: db.prepare('SELECT COUNT(*) AS count FROM listing_records').get().count,
    artifactRefs: db.prepare('SELECT COUNT(*) AS count FROM artifact_refs').get().count,
    migrations: db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
  };
  const runRow = db.prepare(`
    SELECT collected_export_path, listings_export_path
    FROM crawl_runs
    WHERE id = ?
  `).get(run.id);
  const stablePostRow = db.prepare('SELECT times_seen FROM stable_posts').get();
  const listingRow = db.prepare('SELECT payload_json FROM listing_records LIMIT 1').get();

  db.close();

  assert.equal(counts.sources, 1);
  assert.equal(counts.runs, 1);
  assert.equal(counts.runSteps, 1);
  assert.equal(counts.stablePosts, 1);
  assert.equal(counts.observations, 3);
  assert.equal(counts.listings, listings.length);
  assert.equal(counts.artifactRefs, 5);
  assert.equal(counts.migrations, expectedMigrationCount);
  assert.equal(runRow.collected_export_path, 'data/collected/facebook/nyc-housing-group/crawl-2026-03-12T22-00-00-000Z.json');
  assert.equal(runRow.listings_export_path, 'data/listings/facebook/nyc-housing-group/crawl-2026-03-12T22-00-00-000Z.json');
  assert.equal(stablePostRow.times_seen, 2);
  assert.equal(JSON.parse(listingRow.payload_json).source.sourceKey, 'nyc-housing-group');
});

test('sqlite storage keeps seen-post state source scoped across reopen', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-storage-'));
  let storage = createStorage({ dataDir });

  const sourceA = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'group-a',
    sourceType: 'group',
  });
  const firstRun = storage.beginRun({
    runId: '2026-03-12T23-00-00-000Z',
    sourceId: sourceA.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });
  const firstPost = createCollectedPost({
    postId: 'shared-post-id',
    bodyText: 'Sunny room in Bushwick for $1,400/month',
  }, {
    platform: 'facebook',
    sourceKey: 'group-a',
    captureMethod: 'dom',
    captureRunId: firstRun.id,
    capturedAt: '2026-03-12T23:00:00.000Z',
  });

  const [firstSeen] = storage.recordObservationBatch({
    runId: firstRun.id,
    sourceId: sourceA.id,
    entries: [{ post: firstPost }],
  });

  assert.equal(firstSeen.freshness, 'fresh');
  storage.close();

  storage = createStorage({ dataDir });

  const reopenedSourceA = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'group-a',
    sourceType: 'group',
  });
  const secondRun = storage.beginRun({
    runId: '2026-03-12T23-10-00-000Z',
    sourceId: reopenedSourceA.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });
  const repeatPost = createCollectedPost({
    postId: 'shared-post-id',
    bodyText: 'Sunny room in Bushwick for $1,400/month',
  }, {
    platform: 'facebook',
    sourceKey: 'group-a',
    captureMethod: 'dom',
    captureRunId: secondRun.id,
    capturedAt: '2026-03-12T23:10:00.000Z',
  });
  const [sameSourceResult] = storage.recordObservationBatch({
    runId: secondRun.id,
    sourceId: reopenedSourceA.id,
    entries: [{ post: repeatPost }],
  });

  const sourceB = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'group-b',
    sourceType: 'group',
  });
  const thirdRun = storage.beginRun({
    runId: '2026-03-12T23-20-00-000Z',
    sourceId: sourceB.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });
  const crossSourcePost = createCollectedPost({
    postId: 'shared-post-id',
    bodyText: 'Sunny room in Bushwick for $1,400/month',
  }, {
    platform: 'facebook',
    sourceKey: 'group-b',
    captureMethod: 'dom',
    captureRunId: thirdRun.id,
    capturedAt: '2026-03-12T23:20:00.000Z',
  });
  const [otherSourceResult] = storage.recordObservationBatch({
    runId: thirdRun.id,
    sourceId: sourceB.id,
    entries: [{ post: crossSourcePost }],
  });

  storage.close();

  const db = new DatabaseSync(path.join(dataDir, 'storage', 'nyc-housing-scout.sqlite'));
  const stablePostCount = db.prepare('SELECT COUNT(*) AS count FROM stable_posts').get().count;
  db.close();

  assert.equal(sameSourceResult.freshness, 'seen');
  assert.equal(otherSourceResult.freshness, 'fresh');
  assert.equal(stablePostCount, 2);
});

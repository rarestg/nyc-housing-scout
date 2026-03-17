import path from 'node:path';
import { DOM_EXTRACTOR_FN } from '../browser/dom-extractor.js';
import { evaluateJson, readFlag } from '../core/browser-pipeline.js';
import { prepareArtifactLayers, writeRawArtifact, writeRunArtifact } from '../core/artifacts.js';
import { buildCollectedPostArtifactId, createCollectedPost, getCollectedPostKey } from '../core/collected-post.js';
import { createStorage } from '../storage/storage.js';
import { readSourceOptions } from '../storage/source-config.js';

const args = process.argv.slice(2);
const limit = Number(readFlag(args, '--limit', '20'));
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
  runKind: 'capture',
  captureLimit: limit,
  browserProfile: profile,
  captureMethod: 'dom',
  metadata: {
    cli: 'capture-dom-feed',
  },
});
const artifactLayers = prepareArtifactLayers({
  outDir,
  platform: source.platform,
  sourceKey: source.sourceKey,
  runId: run.id,
});
const evaluated = evaluateJson(DOM_EXTRACTOR_FN, profile);
const collected = [];
const counters = {
  fresh: 0,
  seen: 0,
  unidentified: 0,
};
const uniqueKeys = new Set();
const capturedAt = new Date().toISOString();
const observationInputs = [];

for (const rawPost of evaluated) {
  if (collected.length >= limit) break;

  const post = createCollectedPost(rawPost, {
    platform: source.platform,
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt,
  });
  const key = getCollectedPostKey(post);
  if (uniqueKeys.has(key)) continue;
  uniqueKeys.add(key);

  const rawArtifact = writeRawArtifact(artifactLayers.rawDir, buildCollectedPostArtifactId(post), rawPost);
  post.rawArtifactPath = rawArtifact.relativePath;
  collected.push(post);
  observationInputs.push({
    post,
    rawArtifact: {
      ...rawArtifact,
      artifactKind: 'raw_post_payload',
      metadata: {
        captureIndex: post.captureIndex,
      },
    },
  });
}

const observationResults = storage.recordObservationBatch({
  runId: run.id,
  sourceId: source.id,
  entries: observationInputs,
});

observationResults.forEach((result) => {
  counters[result.freshness] += 1;
});

const collectedArtifact = writeRunArtifact(artifactLayers.collectedDir, 'capture', run.id, collected);
const summary = {
  requested: limit,
  sourceKey: source.sourceKey,
  collected: collected.length,
  freshCollected: counters.fresh,
  seenCollected: counters.seen,
  unidentifiedCollected: counters.unidentified,
  withIds: collected.filter((post) => post.postId).length,
  withSeeMore: collected.filter((post) => post.captureHints.hasSeeMore).length,
};

storage.finishRun({
  runId: run.id,
  status: 'completed',
  summary,
  exports: [
    {
      ...collectedArtifact,
      artifactKind: 'collected_export',
      metadata: { records: collected.length },
    },
  ],
});

console.log(JSON.stringify({
  ...summary,
  authors: collected.map((post) => post.authorName).filter(Boolean),
  postIds: collected.map((post) => post.postId).filter(Boolean),
  rawArtifactDir: path.relative(process.cwd(), artifactLayers.rawDir),
  collectedArtifact: collectedArtifact.relativePath,
}, null, 2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  buildObservationEvidenceFragments,
  EVIDENCE_ENRICHMENT_PRODUCER_KIND,
  EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
} from '../src/core/evidence-fragments.js';
import { createCollectedPost } from '../src/core/collected-post.js';
import { runEvidenceEnrichment } from '../src/processing/run-evidence-enrichment.js';
import { createStorage } from '../src/storage/storage.js';

test('buildObservationEvidenceFragments covers body, comments, media, capture metadata, and network enrichment inputs', () => {
  const observation = createObservationShape({
    postId: '24470000000000001',
    postUrl: 'https://www.facebook.com/groups/test/posts/24470000000000001/',
    bodyText: 'Private room in Williamsburg at 123 Bedford Ave for $1,850/month available April 1. Email room@example.com or IG @wburg_room.',
    comments: [
      'Brooklyn listing near Nassau Ave. Text 917-555-1212 or https://instagram.com/wburg_room',
    ],
    media: [{
      type: 'photo',
      url: 'https://example.com/room-photo.jpg',
      title: 'Sunny room',
    }],
    attachmentSummary: {
      count: 1,
      types: ['photo'],
      titles: ['Sunny room'],
      media: [],
    },
    storyId: 'story_abc',
    feedbackId: 'feedback_abc',
    authorId: '100000000000001',
    authorUrl: 'https://www.facebook.com/taylor.example',
    captureHints: {
      networkEnrichment: {
        partial: false,
        selectedPath: 'doc[0].data.node',
        selectedScore: 122,
        requestFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
        requestDocId: '26843032281964993',
        matchScore: 262,
        matchReasons: ['author_exact', 'post_id'],
        matchedCaptureId: 'netcap_0002',
        matchedCaptureMode: 'full_text',
        matchedRetentionReason: 'high_signal_full_text',
      },
    },
  });

  const fragments = buildObservationEvidenceFragments(observation);

  assert.ok(findFragment(fragments, {
    sourceSurface: 'body_text',
    fieldPath: 'location.address',
    fragmentKind: 'address_candidate',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'body_text',
    fieldPath: 'pricing.amount',
    fragmentKind: 'price_candidate',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'body_text',
    fieldPath: 'contact.references',
    fragmentKind: 'email_contact',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'comments',
    fieldPath: 'contact.references',
    fragmentKind: 'phone_contact',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'comments',
    fieldPath: 'contact.references',
    fragmentKind: 'external_url_reference',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'media',
    fieldPath: 'media.attachments',
    fragmentKind: 'media_attachment',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'capture_metadata',
    fieldPath: 'provenance.capture',
    fragmentKind: 'capture_metadata',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'capture_metadata',
    fieldPath: 'location.neighborhood',
    fragmentKind: 'capture_derived_neighborhood',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'network_enrichment',
    fieldPath: 'provenance.networkEnrichment',
    fragmentKind: 'network_enrichment_metadata',
  }));
  assert.ok(findFragment(fragments, {
    sourceSurface: 'network_enrichment',
    fieldPath: 'provenance.facebookIdentity',
    fragmentKind: 'facebook_identity',
  }));
  assert.equal(fragments.every((fragment) => fragment.producerKind === EVIDENCE_ENRICHMENT_PRODUCER_KIND), true);
  assert.equal(fragments.every((fragment) => fragment.producerVersion === EVIDENCE_ENRICHMENT_PRODUCER_VERSION), true);
});

test('runEvidenceEnrichment persists observation-scoped fragments without rewriting observations and skips repeat runs', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-evidence-stage-'));
  const fixture = seedEvidenceEnrichmentFixture(dataDir);
  const { storage, run, observationId } = fixture;

  const beforeObservation = storage.listObservations({
    observationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  })[0];

  const firstPass = runEvidenceEnrichment(storage, {
    runId: run.id,
    limit: 1,
  });

  const storedFragments = storage.listEvidenceFragments({
    observationId,
    producerKind: EVIDENCE_ENRICHMENT_PRODUCER_KIND,
    producerVersion: EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
    limit: 100,
  });
  const firstAuditRows = storage.listAuditEvents({
    targetKind: 'post_observation',
    targetId: observationId,
    eventKind: 'evidence_enrichment_recorded',
    limit: 10,
  });

  assert.equal(firstPass.enrichedCount, 1);
  assert.equal(firstPass.fragmentCount, storedFragments.length);
  assert.ok(storedFragments.length >= 8);
  assert.equal(firstAuditRows.length, 1);
  assert.equal(firstAuditRows[0].actorKind, 'system');
  assert.equal(firstAuditRows[0].payload.fragmentCount, storedFragments.length);
  assert.equal(firstAuditRows[0].payload.producerVersion, EVIDENCE_ENRICHMENT_PRODUCER_VERSION);

  const secondPass = runEvidenceEnrichment(storage, {
    runId: run.id,
    limit: 1,
  });
  const secondAuditRows = storage.listAuditEvents({
    targetKind: 'post_observation',
    targetId: observationId,
    eventKind: 'evidence_enrichment_recorded',
    limit: 10,
  });

  assert.equal(secondPass.enrichedCount, 0);
  assert.equal(secondPass.skippedExistingCount, 1);
  assert.equal(secondAuditRows.length, 1);

  const afterObservation = storage.listObservations({
    observationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  })[0];

  assert.equal(afterObservation.bodyText, beforeObservation.bodyText);
  assert.deepEqual(afterObservation.comments, beforeObservation.comments);
  assert.deepEqual(afterObservation.payload, beforeObservation.payload);

  storage.close();
});

test('recordEvidenceFragmentsWithAudit skips stale duplicate producer writes inside the transaction', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-evidence-race-'));
  const fixture = seedEvidenceEnrichmentFixture(dataDir);
  const { storage, observationId } = fixture;
  const observation = storage.listObservations({
    observationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  })[0];
  const fragments = buildObservationEvidenceFragments(observation, {
    producerKind: EVIDENCE_ENRICHMENT_PRODUCER_KIND,
    producerVersion: EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
  });

  const firstWrite = storage.recordEvidenceFragmentsWithAudit({
    actorId: `${EVIDENCE_ENRICHMENT_PRODUCER_KIND}:${EVIDENCE_ENRICHMENT_PRODUCER_VERSION}`,
    actorKind: 'system',
    createdAt: '2026-03-17T16:10:00.000Z',
    eventKind: 'evidence_enrichment_recorded',
    observationId,
    fragments,
    payload: {
      fragmentCount: fragments.length,
      producerKind: EVIDENCE_ENRICHMENT_PRODUCER_KIND,
      producerVersion: EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
    },
  });
  const staleDuplicateWrite = storage.recordEvidenceFragmentsWithAudit({
    actorId: `${EVIDENCE_ENRICHMENT_PRODUCER_KIND}:${EVIDENCE_ENRICHMENT_PRODUCER_VERSION}`,
    actorKind: 'system',
    createdAt: '2026-03-17T16:10:01.000Z',
    eventKind: 'evidence_enrichment_recorded',
    observationId,
    fragments,
    payload: {
      fragmentCount: fragments.length,
      producerKind: EVIDENCE_ENRICHMENT_PRODUCER_KIND,
      producerVersion: EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
    },
  });

  const storedFragments = storage.listEvidenceFragments({
    observationId,
    producerKind: EVIDENCE_ENRICHMENT_PRODUCER_KIND,
    producerVersion: EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
    limit: 100,
  });
  const auditRows = storage.listAuditEvents({
    targetKind: 'post_observation',
    targetId: observationId,
    eventKind: 'evidence_enrichment_recorded',
    limit: 10,
  });

  assert.equal(firstWrite.created.length, fragments.length);
  assert.equal(staleDuplicateWrite.created.length, 0);
  assert.equal(staleDuplicateWrite.auditEvent, null);
  assert.equal(storedFragments.length, fragments.length);
  assert.equal(auditRows.length, 1);

  storage.close();
});

test('enrich-evidence CLI writes fragments and inspect-storage evidence returns them', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-evidence-cli-'));
  const fixture = seedEvidenceEnrichmentFixture(dataDir);
  fixture.storage.close();

  const enrichResult = runCli('src/cli/enrich-evidence.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--limit',
    '1',
  ]);
  const inspectResult = runCli('src/cli/inspect-storage.js', [
    'evidence',
    '--data-dir',
    dataDir,
    '--observation-id',
    fixture.observationId,
    '--producer-kind',
    EVIDENCE_ENRICHMENT_PRODUCER_KIND,
    '--producer-version',
    EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
    '--limit',
    '100',
  ]);
  const auditResult = runCli('src/cli/inspect-storage.js', [
    'audit',
    '--data-dir',
    dataDir,
    '--target-kind',
    'post_observation',
    '--target-id',
    fixture.observationId,
    '--event-kind',
    'evidence_enrichment_recorded',
    '--limit',
    '10',
  ]);

  assert.equal(enrichResult.command, 'enrich:evidence');
  assert.equal(enrichResult.result.enrichedCount, 1);
  assert.ok(enrichResult.result.fragmentCount >= 8);

  assert.equal(inspectResult.command, 'evidence');
  assert.ok(inspectResult.count >= 8);
  assert.equal(inspectResult.results.every((row) => row.observationId === fixture.observationId), true);
  assert.equal(auditResult.command, 'audit');
  assert.equal(auditResult.count, 1);
  assert.equal(auditResult.results[0].eventKind, 'evidence_enrichment_recorded');
  assert.equal(auditResult.results[0].targetId, fixture.observationId);
});

function seedEvidenceEnrichmentFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group',
  });
  const run = storage.beginRun({
    runId: '2026-03-16T21-30-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });
  const post = createCollectedPost({
    postId: '24470000000000001',
    postUrl: 'https://www.facebook.com/groups/test/posts/24470000000000001/',
    author: 'Taylor Example',
    authorId: '100000000000001',
    authorUrl: 'https://www.facebook.com/taylor.example',
    storyId: 'story_abc',
    feedbackId: 'feedback_abc',
    bodyText: 'Private room in Williamsburg at 123 Bedford Ave for $1,850/month available April 1. Email room@example.com or IG @wburg_room.',
    comments: [
      'Brooklyn listing near Nassau Ave. Text 917-555-1212 or https://instagram.com/wburg_room',
    ],
    media: [{
      type: 'photo',
      url: 'https://example.com/room-photo.jpg',
      title: 'Sunny room',
    }],
    attachmentSummary: {
      count: 1,
      types: ['photo'],
      titles: ['Sunny room'],
      media: [],
    },
    captureHints: {
      networkEnrichment: {
        partial: false,
        selectedPath: 'doc[0].data.node',
        selectedScore: 122,
        requestFriendlyName: 'GroupsCometFeedRegularStoriesPaginationQuery',
        requestDocId: '26843032281964993',
        matchScore: 262,
        matchReasons: ['author_exact', 'post_id'],
        matchedCaptureId: 'netcap_0002',
        matchedCaptureMode: 'full_text',
        matchedRetentionReason: 'high_signal_full_text',
      },
    },
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-16T21:30:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/2026-03-16T21-30-00-000Z/post-001.json',
  });

  const [recorded] = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    entries: [{ post }],
  });

  return {
    storage,
    run,
    observationId: recorded.observation.id,
  };
}

function createObservationShape(overrides = {}) {
  const post = createCollectedPost({
    author: 'Taylor Example',
    ...overrides,
  }, {
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    groupName: 'NYC Housing Group',
    captureMethod: 'dom',
    captureRunId: 'run-1',
    capturedAt: '2026-03-16T21:00:00.000Z',
    rawArtifactPath: 'data/raw/facebook/nyc-housing-group/post-001.json',
  });

  return {
    id: 'obs_fixture',
    captureMethod: post.captureMethod,
    captureRunId: post.captureRunId,
    capturedAt: post.capturedAt,
    rawArtifactPath: post.rawArtifactPath,
    bodyText: post.bodyText,
    comments: post.comments,
    media: post.media,
    derivedLocation: post.derivedLocation,
    captureHints: post.captureHints,
    payload: post,
  };
}

function findFragment(fragments, expected) {
  return fragments.find((fragment) => Object.entries(expected).every(([key, value]) => fragment[key] === value));
}

function runCli(relativePath, args) {
  const cliPath = path.resolve(process.cwd(), relativePath);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

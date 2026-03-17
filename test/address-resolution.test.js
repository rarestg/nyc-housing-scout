import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  ADDRESS_RESOLUTION_KIND,
  ADDRESS_RESOLVED_FIELD_PATHS,
  ADDRESS_RESOLVER_VERSION,
  buildListingAddressResolutions,
} from '../src/core/address-resolution.js';
import { buildObservationEvidenceFragments } from '../src/core/evidence-fragments.js';
import { createCollectedPost } from '../src/core/collected-post.js';
import { runEvidenceEnrichment } from '../src/processing/run-evidence-enrichment.js';
import { runAddressResolution } from '../src/processing/run-address-resolution.js';
import { createStorage } from '../src/storage/storage.js';

test('buildListingAddressResolutions accepts strong NYC address evidence and keeps per-field provenance', () => {
  const observation = createObservationShape({
    postId: '24479999999999991',
    postUrl: 'https://www.facebook.com/groups/test/posts/24479999999999991/',
    bodyText: 'Private room at 123 Bedford Ave in Williamsburg, Brooklyn.',
  });
  const fragments = buildObservationEvidenceFragments(observation).map((fragment, index) => ({
    id: `efg_fixture_${index + 1}`,
    ...fragment,
  }));
  const listing = createListingSummary({
    id: 'lst_fixture_accepted',
    observationId: 'obs_fixture_accepted',
    payload: {
      location: {
        rawText: 'Williamsburg',
        address: null,
        neighborhood: null,
        borough: null,
        city: null,
        state: null,
      },
    },
  });

  const resolved = buildListingAddressResolutions(listing, fragments);
  const byField = new Map(resolved.map((field) => [field.fieldPath, field]));

  assert.deepEqual(resolved.map((field) => field.fieldPath), ADDRESS_RESOLVED_FIELD_PATHS);
  assert.equal(byField.get('location.address').status, 'accepted');
  assert.equal(byField.get('location.address').value, '123 Bedford Ave, Williamsburg, Brooklyn');
  assert.equal(byField.get('location.address').resolutionKind, ADDRESS_RESOLUTION_KIND);
  assert.equal(byField.get('location.address').resolverVersion, ADDRESS_RESOLVER_VERSION);
  assert.ok(byField.get('location.address').supportingFragmentIds.length >= 2);
  assert.equal(byField.get('location.neighborhood').status, 'accepted');
  assert.equal(byField.get('location.neighborhood').value, 'Williamsburg');
  assert.equal(byField.get('location.borough').status, 'accepted');
  assert.equal(byField.get('location.borough').value, 'Brooklyn');
  assert.equal(byField.get('location.city').status, 'accepted');
  assert.equal(byField.get('location.city').value, 'New York');
  assert.equal(byField.get('location.state').status, 'accepted');
  assert.equal(byField.get('location.state').value, 'NY');
});

test('runAddressResolution writes accepted, ambiguous, and unresolved resolved-field rows without mutating raw listings', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-address-resolution-'));
  const fixture = seedAddressResolutionFixture(dataDir);
  const { storage, run, acceptedObservationId, acceptedListingId, ambiguousObservationId, ambiguousListingId } = fixture;

  runEvidenceEnrichment(storage, {
    runId: run.id,
    limit: 10,
  });
  recordAmbiguousNeighborhoodEvidence(storage, ambiguousObservationId);

  const beforeAcceptedListing = storage.listListings({
    observationId: acceptedObservationId,
    includePayload: true,
  })[0];

  const firstPass = runAddressResolution(storage, {
    runId: run.id,
    limit: 10,
  });

  assert.equal(firstPass.resolvedCount, 2);
  assert.equal(firstPass.writtenCount, 10);
  assert.equal(firstPass.unchangedCount, 0);

  const acceptedRows = storage.listResolvedFields({
    targetKind: 'listing_record',
    targetId: acceptedListingId,
    resolutionKind: ADDRESS_RESOLUTION_KIND,
    resolverVersion: ADDRESS_RESOLVER_VERSION,
    limit: 10,
  });
  const ambiguousRows = storage.listResolvedFields({
    targetKind: 'listing_record',
    targetId: ambiguousListingId,
    resolutionKind: ADDRESS_RESOLUTION_KIND,
    resolverVersion: ADDRESS_RESOLVER_VERSION,
    limit: 10,
  });

  assert.equal(acceptedRows.length, 5);
  assert.equal(ambiguousRows.length, 5);

  const acceptedByField = new Map(acceptedRows.map((row) => [row.fieldPath, row]));
  const ambiguousByField = new Map(ambiguousRows.map((row) => [row.fieldPath, row]));

  assert.equal(acceptedByField.get('location.address').status, 'accepted');
  assert.equal(acceptedByField.get('location.address').value, '123 Bedford Ave, Williamsburg, Brooklyn');
  assert.equal(acceptedByField.get('location.neighborhood').status, 'accepted');
  assert.equal(acceptedByField.get('location.neighborhood').value, 'Williamsburg');
  assert.equal(acceptedByField.get('location.borough').status, 'accepted');
  assert.equal(acceptedByField.get('location.borough').value, 'Brooklyn');
  assert.equal(acceptedByField.get('location.city').value, 'New York');
  assert.equal(acceptedByField.get('location.state').value, 'NY');

  assert.equal(ambiguousByField.get('location.address').status, 'unresolved');
  assert.equal(ambiguousByField.get('location.address').metadata.reason, 'no_address_candidates');
  assert.equal(ambiguousByField.get('location.neighborhood').status, 'ambiguous');
  assert.equal(ambiguousByField.get('location.neighborhood').value, null);
  assert.equal(ambiguousByField.get('location.neighborhood').ambiguity.candidates.length, 2);
  assert.equal(ambiguousByField.get('location.borough').status, 'accepted');
  assert.equal(ambiguousByField.get('location.borough').value, 'Brooklyn');
  assert.equal(ambiguousByField.get('location.city').status, 'accepted');
  assert.equal(ambiguousByField.get('location.state').status, 'accepted');

  const secondPass = runAddressResolution(storage, {
    runId: run.id,
    limit: 10,
  });

  assert.equal(secondPass.resolvedCount, 2);
  assert.equal(secondPass.writtenCount, 0);
  assert.equal(secondPass.unchangedCount, 10);

  const afterAcceptedListing = storage.listListings({
    observationId: acceptedObservationId,
    includePayload: true,
  })[0];

  assert.equal(afterAcceptedListing.payload.location.address, beforeAcceptedListing.payload.location.address);
  assert.equal(afterAcceptedListing.payload.location.neighborhood, beforeAcceptedListing.payload.location.neighborhood);
  assert.deepEqual(afterAcceptedListing.payload, beforeAcceptedListing.payload);

  storage.close();
});

test('resolve-addresses CLI writes resolved rows and inspect-storage resolved returns them', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-address-cli-'));
  const fixture = seedAddressResolutionFixture(dataDir);
  runEvidenceEnrichment(fixture.storage, {
    runId: fixture.run.id,
    limit: 10,
  });
  fixture.storage.close();

  const resolveResult = runCli('src/cli/resolve-addresses.js', [
    '--data-dir',
    dataDir,
    '--run-id',
    fixture.run.id,
    '--limit',
    '10',
  ]);
  const inspectResult = runCli('src/cli/inspect-storage.js', [
    'resolved',
    '--data-dir',
    dataDir,
    '--target-kind',
    'listing_record',
    '--target-id',
    fixture.acceptedListingId,
    '--resolver-version',
    ADDRESS_RESOLVER_VERSION,
    '--resolution-kind',
    ADDRESS_RESOLUTION_KIND,
    '--limit',
    '10',
  ]);

  assert.equal(resolveResult.command, 'resolve:addresses');
  assert.equal(resolveResult.result.resolvedCount, 2);
  assert.equal(resolveResult.result.writtenCount, 10);

  assert.equal(inspectResult.command, 'resolved');
  assert.equal(inspectResult.count, 5);
  assert.equal(inspectResult.results.every((row) => row.targetId === fixture.acceptedListingId), true);
  assert.equal(inspectResult.results.some((row) => row.fieldPath === 'location.address' && row.status === 'accepted'), true);
});

function seedAddressResolutionFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group',
  });
  const run = storage.beginRun({
    runId: '2026-03-16T23-45-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });

  const acceptedPost = createCollectedPost({
    postId: '24479999999999991',
    postUrl: 'https://www.facebook.com/groups/test/posts/24479999999999991/',
    author: 'Taylor Address',
    bodyText: 'Sunny room at 123 Bedford Ave in Williamsburg, Brooklyn. Flexible start date.',
  }, buildCollectedPostOptions(source, run.id, 'accepted.json', '2026-03-16T23:45:00.000Z'));
  const ambiguousPost = createCollectedPost({
    postId: '24479999999999992',
    postUrl: 'https://www.facebook.com/groups/test/posts/24479999999999992/',
    author: 'Morgan Ambiguity',
    bodyText: 'Looking for a two bedroom in Greenpoint or Williamsburg with an April move in.',
  }, buildCollectedPostOptions(source, run.id, 'ambiguous.json', '2026-03-16T23:46:00.000Z'));

  const [acceptedEntry] = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    entries: [{ post: acceptedPost }],
  });
  const [ambiguousEntry] = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    entries: [{ post: ambiguousPost }],
  });

  const [acceptedListing] = storage.recordListingsBatch({
    runId: run.id,
    sourceId: source.id,
    extractorVersion: 'test-address-v1',
    records: [{
      observationId: acceptedEntry.observation.id,
      listings: [buildListingPayload(source, acceptedPost, {
        rawText: 'Williamsburg',
        priceAmount: 1800,
      })],
    }],
  });
  const [ambiguousListing] = storage.recordListingsBatch({
    runId: run.id,
    sourceId: source.id,
    extractorVersion: 'test-address-v1',
    records: [{
      observationId: ambiguousEntry.observation.id,
      listings: [buildListingPayload(source, ambiguousPost, {
        rawText: 'Greenpoint or Williamsburg',
        priceAmount: 2200,
      })],
    }],
  });

  return {
    storage,
    run,
    acceptedObservationId: acceptedEntry.observation.id,
    ambiguousObservationId: ambiguousEntry.observation.id,
    acceptedListingId: acceptedListing.id,
    ambiguousListingId: ambiguousListing.id,
  };
}

function buildListingPayload(source, post, input = {}) {
  return {
    source: {
      sourceKey: source.sourceKey,
      postUrl: post.postUrl,
      postId: post.postId,
      authorName: post.authorName,
      capturedAt: post.capturedAt,
      postedAtText: post.postedAtText,
      captureMethod: post.captureMethod,
      captureRunId: post.captureRunId,
      rawArtifactPath: post.rawArtifactPath,
    },
    listingType: 'room_in_shared',
    postIntent: 'offering',
    location: {
      rawText: input.rawText || null,
      address: null,
      neighborhood: null,
      borough: null,
      city: null,
      state: null,
      lat: null,
      lng: null,
      geocodeConfidence: null,
    },
    pricing: {
      amount: input.priceAmount || 1800,
      currency: 'USD',
      period: 'month',
      deposit: null,
      brokerFee: null,
      utilitiesIncluded: null,
    },
    rooms: {
      roomsAvailable: 1,
      totalBedrooms: 2,
      bathrooms: 1,
      occupancyNotes: null,
    },
    dates: {
      availableFrom: null,
      availableTo: null,
      leaseTermText: null,
    },
    features: {},
    contact: {},
    notes: {
      summary: post.bodyText,
      rawSignals: [],
      ambiguities: [],
    },
    confidence: {
      overall: 0.55,
      fields: {},
    },
  };
}

function buildCollectedPostOptions(source, runId, fileName, capturedAt) {
  return {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: runId,
    capturedAt,
    rawArtifactPath: `data/raw/facebook/${source.sourceKey}/${runId}/${fileName}`,
  };
}

function recordAmbiguousNeighborhoodEvidence(storage, observationId) {
  storage.recordEvidenceFragments({
    entries: [{
      observationId,
      fragments: [
        {
          fragmentKind: 'neighborhood_candidate',
          fieldPath: 'location.neighborhood',
          sourceSurface: 'body_text',
          sourceRef: '/bodyText',
          producerKind: 'test-fixture',
          producerVersion: 'address-resolution-v1',
          rawText: 'Greenpoint',
          normalized: {
            neighborhood: 'Greenpoint',
            borough: 'Brooklyn',
          },
          confidence: 0.95,
          metadata: {
            reason: 'force_ambiguity',
          },
        },
        {
          fragmentKind: 'neighborhood_candidate',
          fieldPath: 'location.neighborhood',
          sourceSurface: 'comments',
          sourceRef: '/comments/0',
          producerKind: 'test-fixture',
          producerVersion: 'address-resolution-v1',
          rawText: 'Williamsburg',
          normalized: {
            neighborhood: 'Williamsburg',
            borough: 'Brooklyn',
          },
          confidence: 0.95,
          metadata: {
            reason: 'force_ambiguity',
          },
        },
      ],
    }],
  });
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

function createListingSummary(overrides = {}) {
  return {
    id: 'lst_fixture',
    observationId: 'obs_fixture',
    payload: {
      location: {},
    },
    ...overrides,
  };
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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCollectedPost } from '../src/core/collected-post.js';
import { createStorage } from '../src/storage/storage.js';

test('sqlite storage layers evidence, resolved fields, manual overrides, audit events, and effective-value precedence without mutating raw rows', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-evidence-'));
  const fixture = seedEvidenceFixture(dataDir);
  const {
    storage,
    source,
    observationId,
    listingId,
  } = fixture;

  const beforeListing = storage.listListings({ observationId, includePayload: true })[0];
  const beforeObservation = storage.listObservations({
    observationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  })[0];

  const fragments = storage.recordEvidenceFragments({
    entries: [{
      observationId,
      fragments: [
        {
          fragmentKind: 'address_candidate',
          fieldPath: 'location.address',
          sourceSurface: 'body_text',
          sourceRef: '/bodyText',
          producerKind: 'heuristic',
          producerVersion: 'evidence-v1',
          rawText: '123 Bedford Ave',
          normalized: { address: '123 Bedford Ave' },
          confidence: 0.61,
          metadata: { line: 1 },
        },
        {
          fragmentKind: 'borough_candidate',
          fieldPath: 'location.borough',
          sourceSurface: 'comments',
          sourceRef: '/comments/0',
          producerKind: 'heuristic',
          producerVersion: 'evidence-v1',
          rawText: 'Brooklyn',
          normalized: { borough: 'Brooklyn' },
          confidence: 0.93,
          metadata: { commentAuthor: 'Morgan' },
        },
      ],
    }],
  });

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].sourceId, source.id);
  assert.equal(fragments[0].observationId, observationId);
  assert.equal(fragments[0].runId, fixture.runId);
  assert.equal(fragments[0].stablePostId, fixture.stablePostId);

  const resolvedField = storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    status: 'accepted',
    resolutionKind: 'address_resolution',
    resolverVersion: 'address-resolver-v1',
    value: '123 Bedford Ave, Brooklyn, NY',
    confidence: 0.78,
    ambiguity: {
      candidates: ['123 Bedford Ave, Brooklyn, NY', '123 Bedford Avenue, Brooklyn, NY'],
    },
    supportingFragmentIds: fragments.map((fragment) => fragment.id),
    metadata: {
      locality: 'nyc',
    },
  });

  const auditResolved = storage.appendAuditEvent({
    targetKind: 'listing_record',
    targetId: listingId,
    eventKind: 'resolved_field_upserted',
    actorKind: 'system',
    payload: {
      fieldPath: 'location.address',
      status: 'accepted',
      resolvedFieldId: resolvedField.id,
    },
  });

  const createdOverrideAction = storage.applyManualOverrideAction({
    action: 'set',
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    value: '125 Bedford Ave Apt 2, Brooklyn, NY',
    reason: 'Operator confirmed unit number from follow-up context.',
    operatorId: 'claudius',
    reviewId: `ambiguous:${listingId}`,
  });

  assert.equal(createdOverrideAction.action, 'created');
  assert.equal(createdOverrideAction.manualOverride.status, 'active');
  assert.equal(createdOverrideAction.auditEvent.eventKind, 'manual_override_set');
  assert.equal(createdOverrideAction.auditEvent.payload.previous, null);
  assert.equal(createdOverrideAction.auditEvent.payload.next.value, '125 Bedford Ave Apt 2, Brooklyn, NY');

  const updatedOverrideAction = storage.applyManualOverrideAction({
    action: 'set',
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    value: '125 Bedford Ave Apt 2R, Brooklyn, NY',
    reason: 'Adjusted unit number after operator cross-check.',
    operatorId: 'claudius',
    reviewId: `ambiguous:${listingId}`,
  });

  assert.equal(updatedOverrideAction.action, 'updated');
  assert.equal(updatedOverrideAction.manualOverride.id, createdOverrideAction.manualOverride.id);
  assert.equal(updatedOverrideAction.manualOverride.value, '125 Bedford Ave Apt 2R, Brooklyn, NY');
  assert.equal(updatedOverrideAction.auditEvent.eventKind, 'manual_override_updated');
  assert.equal(updatedOverrideAction.auditEvent.payload.previous.value, '125 Bedford Ave Apt 2, Brooklyn, NY');
  assert.equal(updatedOverrideAction.auditEvent.payload.next.value, '125 Bedford Ave Apt 2R, Brooklyn, NY');

  const effectiveManual = storage.getEffectiveFieldValue({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    rawExtractedValue: 'Williamsburg',
    rawObservationValue: 'North Brooklyn',
  });

  assert.equal(effectiveManual.effectiveLayer, 'manual_override');
  assert.equal(effectiveManual.effectiveValue, '125 Bedford Ave Apt 2R, Brooklyn, NY');
  assert.equal(effectiveManual.selected.precedenceRank, 1);
  assert.equal(effectiveManual.layers.manualOverride.id, updatedOverrideAction.manualOverride.id);
  assert.equal(effectiveManual.layers.resolvedField.id, resolvedField.id);

  const clearedOverrideAction = storage.applyManualOverrideAction({
    action: 'clear',
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    operatorId: 'claudius',
    reason: 'Clear manual layer to trust the accepted resolved value.',
  });

  assert.equal(clearedOverrideAction.action, 'cleared');
  assert.equal(clearedOverrideAction.manualOverride.status, 'cleared');
  assert.ok(clearedOverrideAction.manualOverride.clearedAt);
  assert.equal(clearedOverrideAction.auditEvent.eventKind, 'manual_override_cleared');
  assert.equal(clearedOverrideAction.auditEvent.payload.previous.value, '125 Bedford Ave Apt 2R, Brooklyn, NY');
  assert.equal(clearedOverrideAction.auditEvent.payload.next.status, 'cleared');

  const effectiveResolved = storage.getEffectiveFieldValue({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    rawExtractedValue: 'Williamsburg',
    rawObservationValue: 'North Brooklyn',
  });

  assert.equal(effectiveResolved.effectiveLayer, 'resolved_field');
  assert.equal(effectiveResolved.effectiveValue, '123 Bedford Ave, Brooklyn, NY');
  assert.equal(effectiveResolved.selected.precedenceRank, 2);

  const updatedResolvedField = storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    status: 'candidate',
    resolutionKind: 'address_resolution',
    resolverVersion: 'address-resolver-v1',
    value: '123 Bedford Ave candidate',
    confidence: 0.52,
    supportingFragmentIds: [fragments[0].id],
    metadata: {
      locality: 'nyc',
      candidateOnly: true,
    },
  });

  assert.equal(updatedResolvedField.id, resolvedField.id);
  assert.equal(updatedResolvedField.status, 'candidate');

  const effectiveRawExtracted = storage.getEffectiveFieldValue({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    rawExtractedValue: 'Williamsburg',
    rawObservationValue: 'North Brooklyn',
  });

  assert.equal(effectiveRawExtracted.effectiveLayer, 'raw_extracted');
  assert.equal(effectiveRawExtracted.effectiveValue, 'Williamsburg');
  assert.equal(effectiveRawExtracted.selected.precedenceRank, 3);
  assert.equal(effectiveRawExtracted.layers.resolvedField.status, 'candidate');
  assert.equal(effectiveRawExtracted.layers.manualOverride.status, 'cleared');

  const effectiveObservationFallback = storage.getEffectiveFieldValue({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    rawExtractedValue: null,
    rawObservationValue: 'North Brooklyn',
  });

  assert.equal(effectiveObservationFallback.effectiveLayer, 'raw_observation');
  assert.equal(effectiveObservationFallback.effectiveValue, 'North Brooklyn');
  assert.equal(effectiveObservationFallback.selected.precedenceRank, 4);

  const effectiveMissing = storage.getEffectiveFieldValue({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
    rawExtractedValue: null,
    rawObservationValue: null,
  });

  assert.equal(effectiveMissing.effectiveLayer, 'missing');
  assert.equal(effectiveMissing.effectiveValue, null);

  const evidenceRows = storage.listEvidenceFragments({ observationId });
  const resolvedRows = storage.listResolvedFields({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
  });
  const overrideRows = storage.listManualOverrides({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.address',
  });
  const auditRows = storage.listAuditEvents({
    targetKind: 'listing_record',
    targetId: listingId,
  });

  assert.equal(evidenceRows.length, 2);
  assert.equal(resolvedRows.length, 1);
  assert.equal(resolvedRows[0].supportingFragmentIds.length, 1);
  assert.equal(resolvedRows[0].status, 'candidate');
  assert.equal(overrideRows.length, 1);
  assert.equal(overrideRows[0].status, 'cleared');
  assert.deepEqual(
    auditRows.map((row) => row.eventKind),
    [
      'manual_override_cleared',
      'manual_override_updated',
      'manual_override_set',
      'resolved_field_upserted',
    ],
  );

  const afterListing = storage.listListings({ observationId, includePayload: true })[0];
  const afterObservation = storage.listObservations({
    observationId,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
  })[0];

  assert.equal(afterListing.id, beforeListing.id);
  assert.equal(afterListing.payload.location.address, null);
  assert.equal(afterListing.payload.location.neighborhood, beforeListing.payload.location.neighborhood);
  assert.equal(afterObservation.bodyText, beforeObservation.bodyText);
  assert.deepEqual(afterObservation.payload, beforeObservation.payload);

  storage.close();
});

function seedEvidenceFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'nyc-housing-group',
    sourceType: 'group',
    displayName: 'NYC Housing Group',
  });
  const run = storage.beginRun({
    runId: '2026-03-16T21-00-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    captureMethod: 'dom',
  });

  const post = createCollectedPost({
    postId: '24461028513595054',
    postUrl: 'https://www.facebook.com/groups/test/posts/24461028513595054/',
    author: 'Alex Rivera',
    postedAtText: '2 h',
    bodyText: 'Private room in Williamsburg. Address clue: near Bedford Ave. Price $1,600.',
    comments: ['Brooklyn side street near Bedford'],
  }, {
    platform: 'facebook',
    sourceKey: source.sourceKey,
    groupName: source.displayName,
    captureMethod: 'dom',
    captureRunId: run.id,
    capturedAt: '2026-03-16T21:00:00.000Z',
  });

  const [observationEntry] = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    entries: [{ post }],
  });

  const [listingRecord] = storage.recordListingsBatch({
    runId: run.id,
    sourceId: source.id,
    extractorVersion: 'test-v1',
    records: [{
      observationId: observationEntry.observation.id,
      listings: [{
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
        location: {
          rawText: 'Williamsburg',
          address: null,
          neighborhood: 'Williamsburg',
          borough: null,
          city: 'New York',
          state: 'NY',
          lat: null,
          lng: null,
          geocodeConfidence: null,
        },
        pricing: {
          amount: 1600,
          currency: 'USD',
          period: 'month',
        },
        rooms: {
          roomsAvailable: 1,
          totalBedrooms: 3,
          bathrooms: 1,
        },
        dates: {
          availableFrom: null,
          availableTo: null,
          leaseTermText: null,
        },
        features: {},
        contact: {},
        notes: {
          summary: 'Private room in Williamsburg.',
          rawSignals: [],
          ambiguities: [],
        },
        confidence: {
          overall: 0.66,
          fields: {},
        },
      }],
    }],
  });

  return {
    storage,
    source,
    runId: run.id,
    stablePostId: observationEntry.stablePost.id,
    observationId: observationEntry.observation.id,
    listingId: listingRecord.id,
  };
}

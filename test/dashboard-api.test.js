import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ADDRESS_RESOLVED_FIELD_PATHS } from '../src/core/address-resolution.js';
import { createCollectedPost } from '../src/core/collected-post.js';
import { createStorage } from '../src/storage/storage.js';
import { startInspectionServer } from '../src/ui/inspection-server.js';

const DASHBOARD_PROVENANCE = Object.freeze({
  processorVersion: 'dashboard-processor-v1',
  schemaVersion: 'dashboard-schema-v1',
  modelName: 'dashboard-model-v1',
});

test('dashboard storage helpers group listing variants and expose review link targets', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-dashboard-storage-'));
  const fixture = seedDashboardFixture(dataDir);
  const { storage } = fixture;

  const listings = storage.listDashboardListings({
    pageSize: 10,
    now: '2026-03-16T00:00:00.000Z',
  });
  const ambiguousListings = storage.listDashboardListings({
    hasAmbiguities: 'true',
    pageSize: 10,
    now: '2026-03-16T00:00:00.000Z',
  });
  const recentListings = storage.listDashboardListings({
    postedWithinHours: '8',
    pageSize: 10,
    now: '2026-03-16T00:00:00.000Z',
  });
  const pendingPosts = storage.listDashboardPosts({
    processingStatus: 'pending',
    pageSize: 10,
    now: '2026-03-16T00:00:00.000Z',
  });
  const review = storage.listDashboardReviewItems({
    pageSize: 20,
    now: '2026-03-16T00:00:00.000Z',
  });
  const failedReview = storage.listDashboardReviewItems({
    queue: 'failed',
    pageSize: 10,
    now: '2026-03-16T00:00:00.000Z',
  });
  const failedReviewDetail = storage.getDashboardReviewItem({
    reviewId: `${failedReview.items[0].reviewType}:${failedReview.items[0].primaryId}`,
    queue: 'failed',
    now: '2026-03-16T00:00:00.000Z',
  });
  const ambiguousReviewDetail = storage.getDashboardReviewItem({
    reviewId: `ambiguous:${fixture.ambiguousListingId}`,
    queue: 'ambiguous',
    now: '2026-03-16T00:00:00.000Z',
  });
  const ambiguousListing = listings.items.find(
    (item) => item.observationId === fixture.ambiguousObservationId,
  );
  assert.ok(ambiguousListing);
  const processedAddressState = listings.items[0].locationFieldStates.find(
    (fieldState) => fieldState.fieldPath === 'location.address',
  );
  const ambiguousNeighborhoodState = ambiguousListing.locationFieldStates.find(
    (fieldState) => fieldState.fieldPath === 'location.neighborhood',
  );
  const ambiguousBoroughState = ambiguousListing.locationFieldStates.find(
    (fieldState) => fieldState.fieldPath === 'location.borough',
  );
  const listingDetail = storage.getDashboardListingDetail({
    listingId: listings.items[0].listingId,
  });
  const ambiguousListingDetail = storage.getDashboardListingDetail({
    listingId: ambiguousListing.listingId,
  });
  const processedPostDetail = storage.getDashboardPostDetail({
    observationId: fixture.processedObservationId,
  });
  const ambiguousPostDetail = storage.getDashboardPostDetail({
    observationId: fixture.ambiguousObservationId,
  });
  const pendingPostDetail = storage.getDashboardPostDetail({
    observationId: fixture.pendingObservationId,
  });
  const debugRuns = storage.listDashboardDebugRuns({ pageSize: 10 });
  const debugRun = storage.getDashboardDebugRun({ runId: fixture.runA.id });

  storage.close();

  assert.equal(listings.pagination.totalItems, 2);
  assert.equal(listings.items[0].variantCount, 2);
  assert.equal(listings.items[0].observationId, fixture.processedObservationId);
  assert.match(listings.items[0].extractorVersion, /dashboard-processor-v1/);
  assert.equal(listings.items[0].address, '123 Bedford Ave, Brooklyn, NY');
  assert.equal(listings.items[0].priceAmount, 2400);
  assert.equal(listings.items[0].beds, 2);
  assert.equal(processedAddressState.effectiveLayer, 'resolved_field');
  assert.equal(processedAddressState.layers.resolvedField.status, 'accepted');
  assert.equal(listings.items[0].reviewLinkTarget, null);
  assert.equal(ambiguousNeighborhoodState.layers.resolvedField.status, 'ambiguous');
  assert.equal(ambiguousNeighborhoodState.effectiveLayer, 'missing');
  assert.equal(ambiguousBoroughState.layers.resolvedField.status, 'candidate');
  assert.deepEqual(ambiguousListing.reviewLinkTarget, {
    queue: 'ambiguous',
    reviewId: `ambiguous:${ambiguousListing.listingId}`,
  });

  assert.equal(ambiguousListings.pagination.totalItems, 1);
  assert.equal(ambiguousListings.items[0].observationId, fixture.ambiguousObservationId);
  assert.equal(recentListings.pagination.totalItems, 1);
  assert.equal(recentListings.items[0].observationId, fixture.processedObservationId);

  assert.equal(pendingPosts.pagination.totalItems, 1);
  assert.equal(pendingPosts.items[0].observationId, fixture.pendingObservationId);
  assert.equal(pendingPosts.items[0].processingStatus, 'pending');

  const ambiguousReviewItem = review.items.find(
    (item) => item.observationId === fixture.ambiguousObservationId && item.reviewType === 'ambiguous',
  );
  const incompleteReviewItem = review.items.find(
    (item) => item.observationId === fixture.ambiguousObservationId && item.reviewType === 'incomplete',
  );
  assert.ok(ambiguousReviewItem);
  assert.ok(incompleteReviewItem);
  assert.deepEqual(review.queueCounts, {
    ambiguous: 1,
    'low-confidence': 1,
    incomplete: 1,
    pending: 1,
    failed: 1,
  });
  assert.equal(failedReview.count, 1);
  assert.equal(failedReview.items[0].observationId, fixture.failedObservationId);
  assert.equal(failedReview.items[0].processingStatus, 'failed');
  assert.equal(failedReviewDetail.item.observationId, fixture.failedObservationId);
  assert.equal(failedReviewDetail.thresholds.lowConfidence, 0.75);
  assert.equal(failedReviewDetail.actions.manualOverride.supported, false);
  assert.equal(ambiguousReviewDetail.actions.manualOverride.supported, true);
  assert.deepEqual(
    ambiguousReviewDetail.actions.manualOverride.fieldPaths,
    ADDRESS_RESOLVED_FIELD_PATHS,
  );
  assert.match(ambiguousReviewItem.reasons.join(' '), /Neighborhood resolution is ambiguous/i);
  assert.match(incompleteReviewItem.reasons.join(' '), /Borough has a candidate value/i);

  assert.equal(listingDetail.listing.variantCount, 2);
  assert.equal(listingDetail.selectedVariantId, listings.items[0].listingId);
  assert.equal(listingDetail.variants.length, 2);
  assert.equal(listingDetail.observation.observationId, fixture.processedObservationId);
  assert.equal(listingDetail.jobs.some((job) => job.processingStatus === 'processed'), true);
  assert.equal(listingDetail.listing.locationResolutionSummary.acceptedCount, 5);
  assert.equal(listingDetail.listing.locationFieldStates.length, 5);
  assert.equal(listingDetail.listing.reviewLinkTarget, null);

  assert.ok(ambiguousListingDetail);
  assert.equal(ambiguousListingDetail.listing.locationResolutionSummary.ambiguousCount, 1);
  assert.equal(ambiguousListingDetail.listing.locationResolutionSummary.candidateCount, 1);
  assert.deepEqual(ambiguousListingDetail.listing.reviewLinkTarget, {
    queue: 'ambiguous',
    reviewId: `ambiguous:${ambiguousListing.listingId}`,
  });

  assert.equal(processedPostDetail.post.observationId, fixture.processedObservationId);
  assert.equal(processedPostDetail.linkedListings.length, 1);
  assert.equal(processedPostDetail.linkedListings[0].locationFieldStates.length, 5);
  assert.equal(processedPostDetail.linkedListings[0].reviewLinkTarget, null);

  assert.equal(ambiguousPostDetail.post.observationId, fixture.ambiguousObservationId);
  assert.equal(ambiguousPostDetail.linkedListings.length, 1);
  assert.equal(ambiguousPostDetail.linkedListings[0].locationResolutionSummary.ambiguousCount, 1);
  assert.deepEqual(ambiguousPostDetail.linkedListings[0].reviewLinkTarget, {
    queue: 'ambiguous',
    reviewId: `ambiguous:${ambiguousPostDetail.linkedListings[0].listingId}`,
  });

  assert.equal(pendingPostDetail.post.observationId, fixture.pendingObservationId);
  assert.equal(pendingPostDetail.jobs[0].processingStatus, 'pending');
  assert.equal(pendingPostDetail.linkedListings.length, 0);

  assert.equal(debugRuns.pagination.totalItems, 2);
  assert.equal(debugRun.validation.isHealthy, true);
});

test('dashboard review queues stop treating resolved-location issues as actionable when active manual overrides exist', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-dashboard-review-override-'));
  const storage = createStorage({ dataDir });
  const source = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'review-override-fixture',
    sourceType: 'group',
    displayName: 'Review Override Fixture',
  });
  const run = storage.beginRun({
    runId: '2026-03-16T18-00-00-000Z',
    sourceId: source.id,
    runKind: 'crawl',
    captureMethod: 'dom',
    browserProfile: 'chrome',
  });
  const [recorded] = storage.recordObservationBatch({
    runId: run.id,
    sourceId: source.id,
    stepIndex: 0,
    entries: [{
      post: createFixturePost({
        source,
        run,
        postId: 'post-review-override-001',
        author: 'Taylor Review',
        postedAtText: '3 h',
        capturedAt: '2026-03-16T18:00:00.000Z',
        bodyText: 'Apartment somewhere in Brooklyn, exact neighborhood unclear.',
        suffix: '001',
      }),
      rawArtifact: createFixtureArtifact({
        sourceKey: source.sourceKey,
        runId: run.id,
        postId: 'post-review-override-001',
        suffix: '001',
      }),
    }],
  });
  storage.recordListingsBatch({
    runId: run.id,
    sourceId: source.id,
    extractorVersion: 'review-override-test-v1',
    records: [{
      observationId: recorded.observation.id,
      listings: [
        createListing({
          sourceKey: source.sourceKey,
          groupName: source.displayName,
          postUrl: recorded.observation.postUrl,
          postId: recorded.observation.platformPostId,
          authorName: recorded.observation.authorName,
          capturedAt: recorded.observation.capturedAt,
          postedAtText: recorded.observation.postedAtText,
          summary: 'Sparse location listing for review override coverage',
          listingType: 'apartment',
          postIntent: 'offering',
          neighborhood: null,
          borough: null,
          priceAmount: 2800,
          pricePeriod: 'month',
          totalBedrooms: 2,
          bathrooms: 1,
          availableFrom: '2026-04-01',
          confidenceOverall: 0.91,
          ambiguities: [],
        }),
      ],
    }],
  });

  const listingId = storage.listListings({
    observationId: recorded.observation.id,
    limit: 1,
  })[0].id;

  storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.neighborhood',
    status: 'ambiguous',
    resolutionKind: 'address_resolution',
    resolverVersion: 'nyc-address-resolver-v1',
    value: null,
    confidence: 0.44,
    ambiguity: {
      reason: 'multiple_neighborhood_candidates',
      candidates: [{ value: 'Williamsburg' }, { value: 'Greenpoint' }],
    },
    supportingFragmentIds: [],
    metadata: {
      reason: 'multiple_neighborhood_candidates',
    },
  });
  storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.borough',
    status: 'candidate',
    resolutionKind: 'address_resolution',
    resolverVersion: 'nyc-address-resolver-v1',
    value: 'Brooklyn',
    confidence: 0.58,
    supportingFragmentIds: [],
    metadata: {
      reason: 'borough_below_acceptance_threshold',
    },
  });

  const beforeReview = storage.listDashboardReviewItems({
    pageSize: 20,
    now: '2026-03-16T23:00:00.000Z',
  });

  storage.applyManualOverrideAction({
    action: 'set',
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.neighborhood',
    value: 'Williamsburg',
    operatorId: 'claudius',
    reason: 'Operator chose the neighborhood manually.',
    reviewId: `ambiguous:${listingId}`,
  });
  storage.applyManualOverrideAction({
    action: 'set',
    targetKind: 'listing_record',
    targetId: listingId,
    fieldPath: 'location.borough',
    value: 'Brooklyn',
    operatorId: 'claudius',
    reason: 'Operator confirmed borough manually.',
    reviewId: `incomplete:${listingId}`,
  });

  const afterReview = storage.listDashboardReviewItems({
    pageSize: 20,
    now: '2026-03-16T23:00:00.000Z',
  });

  storage.close();

  assert.equal(
    beforeReview.items.some((item) => item.reviewType === 'ambiguous' && item.primaryId === listingId),
    true,
  );
  assert.equal(
    beforeReview.items.some((item) => item.reviewType === 'incomplete' && item.primaryId === listingId),
    true,
  );
  assert.equal(
    afterReview.items.some((item) => item.primaryId === listingId),
    false,
  );
});

test('dashboard API routes expose paginated data while preserving inspector endpoints', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-housing-scout-dashboard-server-'));
  const fixture = seedDashboardFixture(dataDir);
  fixture.storage.close();

  const server = await startInspectionServer({
    dataDir,
    port: 0,
  });

  try {
    const listings = await fetchJson(`${server.url}/api/dashboard/listings?pageSize=1`);
    assert.equal(listings.pagination.totalItems, 2);
    assert.equal(listings.count, 1);
    assert.equal(listings.items[0].variantCount, 2);
    assert.equal(listings.items[0].address, '123 Bedford Ave, Brooklyn, NY');
    assert.equal(listings.items[0].locationFieldStates.length, 5);
    assert.equal(listings.items[0].reviewLinkTarget, null);

    const ambiguousListings = await fetchJson(
      `${server.url}/api/dashboard/listings?hasAmbiguities=true&pageSize=5`,
    );
    assert.equal(ambiguousListings.count, 1);
    assert.equal(ambiguousListings.items[0].locationResolutionSummary.ambiguousCount, 1);
    assert.deepEqual(ambiguousListings.items[0].reviewLinkTarget, {
      queue: 'ambiguous',
      reviewId: `ambiguous:${ambiguousListings.items[0].listingId}`,
    });

    const listingDetail = await fetchJson(
      `${server.url}/api/dashboard/listings/${encodeURIComponent(listings.items[0].listingId)}`,
    );
    assert.equal(listingDetail.variants.length, 2);
    assert.equal(listingDetail.listing.observationId, fixture.processedObservationId);
    assert.equal(listingDetail.listing.locationFieldStates.length, 5);
    assert.equal(listingDetail.listing.reviewLinkTarget, null);

    const ambiguousListingDetail = await fetchJson(
      `${server.url}/api/dashboard/listings/${encodeURIComponent(ambiguousListings.items[0].listingId)}`,
    );
    assert.deepEqual(
      ambiguousListingDetail.listing.reviewLinkTarget,
      ambiguousListings.items[0].reviewLinkTarget,
    );

    const posts = await fetchJson(`${server.url}/api/dashboard/posts?processingStatus=pending`);
    assert.equal(posts.pagination.totalItems, 1);
    assert.equal(posts.items[0].observationId, fixture.pendingObservationId);

    const postDetail = await fetchJson(
      `${server.url}/api/dashboard/posts/${encodeURIComponent(fixture.failedObservationId)}`,
    );
    assert.equal(postDetail.jobs[0].processingStatus, 'failed');

    const ambiguousPostDetail = await fetchJson(
      `${server.url}/api/dashboard/posts/${encodeURIComponent(fixture.ambiguousObservationId)}`,
    );
    assert.equal(ambiguousPostDetail.linkedListings.length, 1);
    assert.equal(ambiguousPostDetail.linkedListings[0].locationResolutionSummary.ambiguousCount, 1);
    assert.deepEqual(
      ambiguousPostDetail.linkedListings[0].reviewLinkTarget,
      ambiguousListings.items[0].reviewLinkTarget,
    );

    const review = await fetchJson(`${server.url}/api/dashboard/review?queue=failed`);
    assert.equal(review.count, 1);
    assert.equal(review.queueCounts.failed, 1);

    const reviewDetail = await fetchJson(
      `${server.url}/api/dashboard/review/${encodeURIComponent(`${review.items[0].reviewType}:${review.items[0].primaryId}`)}?queue=failed`,
    );
    assert.equal(reviewDetail.item.observationId, fixture.failedObservationId);
    assert.equal(reviewDetail.thresholds.lowConfidence, 0.75);

    const reviewDetailWithoutFilters = await fetchJson(
      `${server.url}/api/dashboard/review/${encodeURIComponent(`${review.items[0].reviewType}:${review.items[0].primaryId}`)}`,
    );
    assert.equal(reviewDetailWithoutFilters.item.observationId, fixture.failedObservationId);
    assert.equal(reviewDetailWithoutFilters.thresholds.lowConfidence, 0.75);
    assert.equal(reviewDetailWithoutFilters.actions.manualOverride.supported, false);

    const ambiguousReviewDetail = await fetchJson(
      `${server.url}/api/dashboard/review/${encodeURIComponent(`ambiguous:${fixture.ambiguousListingId}`)}?queue=ambiguous`,
    );
    assert.equal(ambiguousReviewDetail.item.listingId, fixture.ambiguousListingId);
    assert.equal(ambiguousReviewDetail.actions.manualOverride.supported, true);
    assert.equal(ambiguousReviewDetail.actions.manualOverride.targetId, fixture.ambiguousListingId);
    assert.deepEqual(
      ambiguousReviewDetail.actions.manualOverride.fieldPaths,
      ADDRESS_RESOLVED_FIELD_PATHS,
    );

    const unsupportedOverrideResponse = await fetch(`${server.url}/api/dashboard/review/manual-overrides`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reviewId: `ambiguous:${fixture.processedListingId}`,
        listingId: fixture.processedListingId,
        fieldPath: 'location.neighborhood',
        value: 'Williamsburg',
        operatorId: 'claudius',
        reason: 'This listing should not accept Review edits.',
      }),
    });
    const unsupportedOverrideBody = await unsupportedOverrideResponse.json();
    assert.equal(unsupportedOverrideResponse.status, 409);
    assert.match(unsupportedOverrideBody.error, /Review manual override is not supported/i);

    const supportedCityOverride = await fetchJson(
      `${server.url}/api/dashboard/review/manual-overrides`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reviewId: `ambiguous:${fixture.ambiguousListingId}`,
          listingId: fixture.ambiguousListingId,
          fieldPath: 'location.city',
          value: 'New York',
          operatorId: 'claudius',
          reason: 'Lock the listing-level Review location-field contract.',
        }),
      },
    );
    assert.equal(supportedCityOverride.action, 'created');
    assert.equal(supportedCityOverride.manualOverride.status, 'active');
    assert.equal(supportedCityOverride.fieldState.fieldPath, 'location.city');
    assert.equal(supportedCityOverride.fieldState.effectiveLayer, 'manual_override');
    assert.equal(supportedCityOverride.listing.city, 'New York');

    const createdOverride = await fetchJson(
      `${server.url}/api/dashboard/review/manual-overrides`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reviewId: `ambiguous:${fixture.ambiguousListingId}`,
          listingId: fixture.ambiguousListingId,
          fieldPath: 'location.neighborhood',
          value: 'Williamsburg',
          operatorId: 'claudius',
          reason: 'Operator confirmed neighborhood from follow-up.',
        }),
      },
    );
    assert.equal(createdOverride.action, 'created');
    assert.equal(createdOverride.manualOverride.status, 'active');
    assert.equal(createdOverride.auditEvent.eventKind, 'manual_override_set');
    assert.equal(createdOverride.listing.neighborhood, 'Williamsburg');
    assert.equal(createdOverride.fieldState.effectiveLayer, 'manual_override');
    assert.equal(createdOverride.review.item.listingId, fixture.ambiguousListingId);

    const updatedOverride = await fetchJson(
      `${server.url}/api/dashboard/review/manual-overrides`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reviewId: `ambiguous:${fixture.ambiguousListingId}`,
          listingId: fixture.ambiguousListingId,
          fieldPath: 'location.neighborhood',
          value: 'Bushwick',
          operatorId: 'claudius',
          reason: 'Operator corrected the first neighborhood choice.',
        }),
      },
    );
    assert.equal(updatedOverride.action, 'updated');
    assert.equal(updatedOverride.auditEvent.eventKind, 'manual_override_updated');
    assert.equal(updatedOverride.listing.neighborhood, 'Bushwick');
    assert.equal(updatedOverride.fieldState.layers.manualOverride.value, 'Bushwick');

    const clearedOverride = await fetchJson(
      `${server.url}/api/dashboard/review/manual-overrides/clear`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reviewId: `ambiguous:${fixture.ambiguousListingId}`,
          listingId: fixture.ambiguousListingId,
          fieldPath: 'location.neighborhood',
          operatorId: 'claudius',
          reason: 'Operator cleared the manual layer.',
        }),
      },
    );
    assert.equal(clearedOverride.action, 'cleared');
    assert.equal(clearedOverride.manualOverride.status, 'cleared');
    assert.equal(clearedOverride.auditEvent.eventKind, 'manual_override_cleared');
    assert.equal(clearedOverride.listing.neighborhood, null);
    assert.equal(clearedOverride.fieldState.effectiveLayer, 'missing');

    const debugRuns = await fetchJson(`${server.url}/api/dashboard/debug/runs?pageSize=5`);
    assert.equal(debugRuns.pagination.totalItems, 2);

    const debugRun = await fetchJson(
      `${server.url}/api/dashboard/debug/runs/${encodeURIComponent(fixture.runA.id)}`,
    );
    assert.equal(debugRun.run.id, fixture.runA.id);
    assert.equal(debugRun.validation.isHealthy, true);

    const legacyRuns = await fetchJson(`${server.url}/api/runs?limit=5`);
    assert.equal(Array.isArray(legacyRuns.items), true);
    assert.equal(legacyRuns.count >= 2, true);

    const legacyListings = await fetchJson(`${server.url}/api/listings?limit=5`);
    assert.equal(Array.isArray(legacyListings.items), true);
    assert.equal(legacyListings.count >= 3, true);
  } finally {
    await server.close();
  }
});

function seedDashboardFixture(dataDir) {
  const storage = createStorage({ dataDir });
  const sourceA = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'williamsburggreenpointhousing',
    sourceType: 'group',
    displayName: 'Williamsburg Greenpoint Housing',
    externalUrl: 'https://www.facebook.com/groups/williamsburggreenpointhousing/',
    browserProfile: 'chrome',
  });
  const sourceB = storage.getOrCreateSource({
    platform: 'facebook',
    sourceKey: 'brooklynhousingboard',
    sourceType: 'group',
    displayName: 'Brooklyn Housing Board',
    externalUrl: 'https://www.facebook.com/groups/brooklynhousingboard/',
    browserProfile: 'chrome',
  });

  const runA = storage.beginRun({
    runId: '2026-03-15T20-00-00-000Z',
    sourceId: sourceA.id,
    runKind: 'crawl',
    captureMethod: 'dom',
    browserProfile: 'chrome',
  });
  const runB = storage.beginRun({
    runId: '2026-03-15T21-00-00-000Z',
    sourceId: sourceB.id,
    runKind: 'crawl',
    captureMethod: 'dom',
    browserProfile: 'chrome',
  });

  const batchA = storage.recordObservationBatch({
    runId: runA.id,
    sourceId: sourceA.id,
    stepIndex: 0,
    entries: [
      {
        post: createFixturePost({
          source: sourceA,
          run: runA,
          postId: 'post-processed-001',
          author: 'Alex Rivera',
          postedAtText: '2 h',
          capturedAt: '2026-03-15T20:00:00.000Z',
          bodyText: 'Sunny Greenpoint two-bedroom sublet for $2400/month starting April 1. One bathroom. DM for details.',
          suffix: '001',
        }),
        rawArtifact: createFixtureArtifact({
          sourceKey: sourceA.sourceKey,
          runId: runA.id,
          postId: 'post-processed-001',
          suffix: '001',
        }),
      },
      {
        post: createFixturePost({
          source: sourceA,
          run: runA,
          postId: 'post-ambiguous-002',
          author: 'Jamie Quinn',
          postedAtText: '2 d',
          capturedAt: '2026-03-15T19:00:00.000Z',
          bodyText: 'Looking for someone in Brooklyn. Price flexible. Message me if interested.',
          suffix: '002',
        }),
        rawArtifact: createFixtureArtifact({
          sourceKey: sourceA.sourceKey,
          runId: runA.id,
          postId: 'post-ambiguous-002',
          suffix: '002',
        }),
      },
    ],
  });

  const batchB = storage.recordObservationBatch({
    runId: runB.id,
    sourceId: sourceB.id,
    stepIndex: 0,
    entries: [
      {
        post: createFixturePost({
          source: sourceB,
          run: runB,
          postId: 'post-pending-003',
          author: 'Casey Monroe',
          postedAtText: '1 h',
          capturedAt: '2026-03-15T21:00:00.000Z',
          bodyText: 'Need a one-bedroom in Bed-Stuy by April. Budget is around $1800.',
          suffix: '003',
        }),
        rawArtifact: createFixtureArtifact({
          sourceKey: sourceB.sourceKey,
          runId: runB.id,
          postId: 'post-pending-003',
          suffix: '003',
        }),
      },
      {
        post: createFixturePost({
          source: sourceB,
          run: runB,
          postId: 'post-failed-004',
          author: 'Morgan Lee',
          postedAtText: '10 h',
          capturedAt: '2026-03-15T21:30:00.000Z',
          bodyText: 'Spacious room in Bushwick, reach out for price and move-in.',
          suffix: '004',
        }),
        rawArtifact: createFixtureArtifact({
          sourceKey: sourceB.sourceKey,
          runId: runB.id,
          postId: 'post-failed-004',
          suffix: '004',
        }),
      },
    ],
  });

  storage.recordListingsBatch({
    runId: runA.id,
    sourceId: sourceA.id,
    extractorVersion: 'text-extractor-v1',
    records: [
      {
        observationId: batchA[0].observation.id,
        listings: [
          createListing({
            sourceKey: sourceA.sourceKey,
            groupName: sourceA.displayName,
            postUrl: batchA[0].observation.postUrl,
            postId: batchA[0].observation.platformPostId,
            authorName: batchA[0].observation.authorName,
            capturedAt: batchA[0].observation.capturedAt,
            postedAtText: batchA[0].observation.postedAtText,
            summary: 'Greenpoint sublet with fuzzy pricing',
            listingType: 'sublet',
            postIntent: 'offering',
            neighborhood: 'Greenpoint',
            borough: 'Brooklyn',
            priceAmount: null,
            pricePeriod: 'month',
            totalBedrooms: 2,
            bathrooms: 1,
            availableFrom: 'April 1',
            confidenceOverall: 0.58,
            ambiguities: ['Price was not confidently detected'],
          }),
        ],
      },
      {
        observationId: batchA[1].observation.id,
        listings: [
          createListing({
            sourceKey: sourceA.sourceKey,
            groupName: sourceA.displayName,
            postUrl: batchA[1].observation.postUrl,
            postId: batchA[1].observation.platformPostId,
            authorName: batchA[1].observation.authorName,
            capturedAt: batchA[1].observation.capturedAt,
            postedAtText: batchA[1].observation.postedAtText,
            summary: 'Flexible Brooklyn housing post with sparse details',
            listingType: 'unknown',
            postIntent: 'offering',
            neighborhood: null,
            borough: null,
            priceAmount: null,
            pricePeriod: 'unknown',
            totalBedrooms: null,
            bathrooms: null,
            availableFrom: null,
            confidenceOverall: 0.42,
            ambiguities: [
              'Location not confidently detected',
              'Price not confidently detected',
            ],
          }),
        ],
      },
    ],
  });

  storage.enqueueProcessingJobs({
    observationId: batchA[0].observation.id,
    ...DASHBOARD_PROVENANCE,
  });
  const [processedJob] = storage.claimProcessingJobs({
    observationId: batchA[0].observation.id,
    claimedBy: 'dashboard-test-worker',
    limit: 1,
    ...DASHBOARD_PROVENANCE,
  });
  storage.completeProcessingJob({
    jobId: processedJob.id,
    claimedBy: 'dashboard-test-worker',
    payload: createProcessedPayload({
      postUrl: batchA[0].observation.postUrl,
      listings: [
        createListing({
          sourceKey: sourceA.sourceKey,
          groupName: sourceA.displayName,
          postUrl: batchA[0].observation.postUrl,
          postId: batchA[0].observation.platformPostId,
          authorName: batchA[0].observation.authorName,
          capturedAt: batchA[0].observation.capturedAt,
          postedAtText: batchA[0].observation.postedAtText,
          summary: 'Greenpoint two-bedroom sublet for $2400',
          listingType: 'sublet',
          postIntent: 'offering',
          neighborhood: 'Greenpoint',
          borough: 'Brooklyn',
          priceAmount: 2400,
          pricePeriod: 'month',
          totalBedrooms: 2,
          bathrooms: 1,
          availableFrom: '2026-04-01',
          confidenceOverall: 0.91,
          ambiguities: [],
        }),
      ],
    }),
  });

  const processedListingId = storage.listListings({
    observationId: batchA[0].observation.id,
    includePayload: true,
    limit: 10,
  })[0].id;
  const ambiguousListingId = storage.listListings({
    observationId: batchA[1].observation.id,
    includePayload: true,
    limit: 10,
  })[0].id;

  for (const [fieldPath, value] of [
    ['location.address', '123 Bedford Ave, Brooklyn, NY'],
    ['location.neighborhood', 'Greenpoint'],
    ['location.borough', 'Brooklyn'],
    ['location.city', 'New York'],
    ['location.state', 'NY'],
  ]) {
    storage.upsertResolvedField({
      targetKind: 'listing_record',
      targetId: processedListingId,
      fieldPath,
      status: 'accepted',
      resolutionKind: 'address_resolution',
      resolverVersion: 'nyc-address-resolver-v1',
      value,
      confidence: 0.92,
      supportingFragmentIds: [],
      metadata: {
        reason: 'nyc_location_fragments_present',
      },
    });
  }

  storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: ambiguousListingId,
    fieldPath: 'location.neighborhood',
    status: 'ambiguous',
    resolutionKind: 'address_resolution',
    resolverVersion: 'nyc-address-resolver-v1',
    value: null,
    confidence: 0.48,
    ambiguity: {
      reason: 'multiple_neighborhood_candidates',
      candidates: [
        { value: 'Williamsburg' },
        { value: 'Bushwick' },
      ],
    },
    supportingFragmentIds: [],
    metadata: {
      reason: 'multiple_neighborhood_candidates',
    },
  });
  storage.upsertResolvedField({
    targetKind: 'listing_record',
    targetId: ambiguousListingId,
    fieldPath: 'location.borough',
    status: 'candidate',
    resolutionKind: 'address_resolution',
    resolverVersion: 'nyc-address-resolver-v1',
    value: 'Brooklyn',
    confidence: 0.54,
    supportingFragmentIds: [],
    metadata: {
      reason: 'borough_below_acceptance_threshold',
    },
  });

  storage.enqueueProcessingJobs({
    observationId: batchB[0].observation.id,
    ...DASHBOARD_PROVENANCE,
  });

  storage.enqueueProcessingJobs({
    observationId: batchB[1].observation.id,
    ...DASHBOARD_PROVENANCE,
  });
  const [failedJob] = storage.claimProcessingJobs({
    observationId: batchB[1].observation.id,
    claimedBy: 'dashboard-test-worker',
    limit: 1,
    ...DASHBOARD_PROVENANCE,
  });
  storage.failProcessingJob({
    jobId: failedJob.id,
    claimedBy: 'dashboard-test-worker',
    errorMessage: 'simulated dashboard failure',
    retryable: false,
  });

  storage.finishRun({
    runId: runA.id,
    status: 'completed',
    summary: {
      sourceKey: sourceA.sourceKey,
      collected: 2,
      freshCollected: 2,
      seenCollected: 0,
      unidentifiedCollected: 0,
      extractedListings: 3,
      withIds: 2,
    },
    exports: createRunExports(sourceA.sourceKey, runA.id),
  });
  storage.finishRun({
    runId: runB.id,
    status: 'completed',
    summary: {
      sourceKey: sourceB.sourceKey,
      collected: 2,
      freshCollected: 2,
      seenCollected: 0,
      unidentifiedCollected: 0,
      extractedListings: 0,
      withIds: 2,
    },
    exports: createRunExports(sourceB.sourceKey, runB.id),
  });

  return {
    storage,
    runA,
    runB,
    processedListingId,
    ambiguousListingId,
    processedObservationId: batchA[0].observation.id,
    ambiguousObservationId: batchA[1].observation.id,
    pendingObservationId: batchB[0].observation.id,
    failedObservationId: batchB[1].observation.id,
  };
}

function createFixturePost(input) {
  return createCollectedPost({
    postId: input.postId,
    postUrl: `https://www.facebook.com/groups/${input.source.sourceKey}/posts/${input.postId}/`,
    author: input.author,
    postedAtText: input.postedAtText,
    bodyText: input.bodyText,
  }, {
    platform: 'facebook',
    sourceKey: input.source.sourceKey,
    groupName: input.source.displayName,
    captureMethod: 'dom',
    captureRunId: input.run.id,
    capturedAt: input.capturedAt,
    rawArtifactPath: `data/raw/facebook/${input.source.sourceKey}/${input.run.id}/${input.postId}-${input.suffix}.json`,
  });
}

function createFixtureArtifact(input) {
  return {
    artifactKind: 'raw_post_payload',
    relativePath: `data/raw/facebook/${input.sourceKey}/${input.runId}/${input.postId}-${input.suffix}.json`,
    sha256: `sha-${input.postId}`,
    byteSize: 128,
  };
}

function createRunExports(sourceKey, runId) {
  return [
    {
      artifactKind: 'collected_export',
      relativePath: `data/collected/facebook/${sourceKey}/crawl-${runId}.json`,
      sha256: `sha-collected-${runId}`,
      byteSize: 256,
    },
    {
      artifactKind: 'listing_export',
      relativePath: `data/listings/facebook/${sourceKey}/crawl-${runId}.json`,
      sha256: `sha-listings-${runId}`,
      byteSize: 128,
    },
  ];
}

function createProcessedPayload(input) {
  return {
    observation: {
      postUrl: input.postUrl,
    },
    extracted: {
      listingCount: input.listings.length,
      listings: input.listings,
    },
  };
}

function createListing(input) {
  return {
    source: {
      platform: 'facebook',
      sourceKey: input.sourceKey,
      groupName: input.groupName,
      postUrl: input.postUrl,
      postId: input.postId,
      authorName: input.authorName,
      capturedAt: input.capturedAt,
      postedAtText: input.postedAtText,
      captureMethod: 'dom',
      captureRunId: null,
      rawArtifactPath: null,
    },
    postIntent: input.postIntent,
    listingType: input.listingType,
    location: {
      rawText: input.neighborhood || input.borough || null,
      address: null,
      neighborhood: input.neighborhood,
      borough: input.borough,
      city: 'New York',
      state: 'NY',
      lat: null,
      lng: null,
      geocodeConfidence: null,
    },
    pricing: {
      amount: input.priceAmount,
      currency: 'USD',
      period: input.pricePeriod,
      deposit: null,
      brokerFee: null,
      utilitiesIncluded: null,
    },
    rooms: {
      roomsAvailable: input.roomsAvailable ?? null,
      totalBedrooms: input.totalBedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      occupancyNotes: null,
    },
    dates: {
      availableFrom: input.availableFrom,
      availableTo: null,
      leaseTermText: null,
    },
    features: {
      petsAllowed: null,
      laundry: null,
      furnished: null,
      privateBath: null,
      outdoorSpace: null,
      doorman: null,
      elevator: null,
    },
    contact: {
      contactMethod: null,
      contactValue: null,
    },
    notes: {
      summary: input.summary,
      rawSignals: [],
      ambiguities: input.ambiguities,
    },
    confidence: {
      overall: input.confidenceOverall,
      fields: {
        postIntent: input.confidenceOverall,
        listingType: input.confidenceOverall,
        location: input.confidenceOverall,
        borough: input.borough ? 1 : 0.2,
        price: input.priceAmount === null || input.priceAmount === undefined ? 0.1 : 0.95,
        rooms: input.totalBedrooms || input.roomsAvailable || input.bathrooms ? 0.8 : 0.2,
        dates: input.availableFrom ? 0.75 : 0.2,
      },
    },
  };
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${url} -> ${response.status}`);
  return response.json();
}

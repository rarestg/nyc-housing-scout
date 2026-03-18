import {
  ADDRESS_RESOLUTION_KIND,
  ADDRESS_RESOLVED_FIELD_PATHS,
  ADDRESS_RESOLVER_VERSION,
  buildListingAddressResolutions,
} from '../core/address-resolution.js';
import { resolvedFieldRecordMatches } from '../core/resolved-field-storage.js';

export function runAddressResolution(storage, input = {}) {
  const resolutionKind = normalizeString(input.resolutionKind) || ADDRESS_RESOLUTION_KIND;
  const resolverVersion = normalizeString(input.resolverVersion) || ADDRESS_RESOLVER_VERSION;
  const requestedLimit = normalizeLimit(input.limit, 20);
  const scanLimit = normalizeLimit(input.scanLimit, Math.max(requestedLimit * 5, requestedLimit, 100));
  const listingLimit = input.observationId ? scanLimit : Math.max(requestedLimit, scanLimit);
  const listings = storage.listListings({
    runId: input.runId,
    sourceKey: input.sourceKey,
    observationId: input.observationId,
    includePayload: true,
    limit: listingLimit,
  });
  const createdAt = input.createdAt || new Date().toISOString();
  const results = [];
  const evidenceCache = new Map();
  let resolvedCount = 0;
  let writtenCount = 0;
  let unchangedCount = 0;

  for (const listing of listings) {
    if (!input.observationId && resolvedCount >= requestedLimit) {
      break;
    }

    const fragments = getObservationEvidenceFragments(storage, evidenceCache, listing.observationId);
    const nextFields = buildListingAddressResolutions(listing, fragments, {
      resolutionKind,
      resolverVersion,
    });
    const existingByField = new Map(
      storage.listResolvedFields({
        targetKind: 'listing_record',
        targetId: listing.id,
        limit: ADDRESS_RESOLVED_FIELD_PATHS.length + 10,
      }).map((row) => [row.fieldPath, row]),
    );
    const resolvedFieldScope = {
      targetKind: 'listing_record',
      targetId: listing.id,
      sourceId: listing.sourceId,
      observationId: listing.observationId,
    };

    const changedFields = [];
    let listingUnchangedCount = 0;

    for (const nextField of nextFields) {
      const existing = existingByField.get(nextField.fieldPath) || null;

      if (resolvedFieldRecordMatches(existing, nextField, resolvedFieldScope)) {
        listingUnchangedCount += 1;
        unchangedCount += 1;
        continue;
      }

      changedFields.push(nextField);
    }

    let listingWrittenCount = 0;

    if (changedFields.length) {
      const writeResult = storage.upsertResolvedFieldsWithAudit({
        actorId: `${resolutionKind}:${resolverVersion}`,
        actorKind: 'system',
        createdAt,
        eventKind: 'address_resolution_recorded',
        fields: changedFields.map((field) => ({
          ambiguity: field.ambiguity,
          confidence: field.confidence,
          createdAt,
          fieldPath: field.fieldPath,
          metadata: field.metadata,
          resolutionKind,
          resolverVersion,
          status: field.status,
          supportingFragmentIds: field.supportingFragmentIds,
          updatedAt: createdAt,
          value: field.value,
        })),
        payload: {
          fieldCount: changedFields.length,
          fields: changedFields.map((field) => ({
            confidence: field.confidence,
            fieldPath: field.fieldPath,
            status: field.status,
            value: field.value,
          })),
          resolutionKind,
          resolverVersion,
        },
        targetId: listing.id,
        targetKind: 'listing_record',
      });

      listingWrittenCount = writeResult.fields.length;
      const skippedFieldCount = Array.isArray(writeResult.skippedFieldPaths)
        ? writeResult.skippedFieldPaths.length
        : 0;

      if (skippedFieldCount) {
        listingUnchangedCount += skippedFieldCount;
        unchangedCount += skippedFieldCount;
      }

      writtenCount += listingWrittenCount;
    }

    resolvedCount += 1;
    results.push({
      listingId: listing.id,
      observationId: listing.observationId,
      evidenceFragmentCount: fragments.length,
      writtenCount: listingWrittenCount,
      unchangedCount: listingUnchangedCount,
      fields: nextFields.map((field) => ({
        fieldPath: field.fieldPath,
        status: field.status,
        value: field.value,
        confidence: field.confidence,
      })),
    });
  }

  return {
    resolver: {
      resolutionKind,
      resolverVersion,
    },
    filters: compactObject({
      runId: input.runId,
      sourceKey: input.sourceKey,
      observationId: input.observationId,
      limit: requestedLimit,
      scanLimit: listingLimit,
    }),
    scannedCount: listings.length,
    resolvedCount,
    writtenCount,
    unchangedCount,
    results,
  };
}

function getObservationEvidenceFragments(storage, cache, observationId) {
  if (cache.has(observationId)) {
    return cache.get(observationId);
  }

  const fragments = storage.listEvidenceFragments({
    observationId,
    limit: 500,
  });
  cache.set(observationId, fragments);
  return fragments;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== false),
  );
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function normalizeString(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return normalized || null;
}

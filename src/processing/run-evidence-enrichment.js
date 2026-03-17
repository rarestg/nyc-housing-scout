import {
  buildObservationEvidenceFragments,
  EVIDENCE_ENRICHMENT_PRODUCER_KIND,
  EVIDENCE_ENRICHMENT_PRODUCER_VERSION,
} from '../core/evidence-fragments.js';

export function runEvidenceEnrichment(storage, input = {}) {
  const producerKind = normalizeString(input.producerKind) || EVIDENCE_ENRICHMENT_PRODUCER_KIND;
  const producerVersion = normalizeString(input.producerVersion) || EVIDENCE_ENRICHMENT_PRODUCER_VERSION;
  const requestedLimit = normalizeLimit(input.limit, 20);
  const scanLimit = normalizeLimit(input.scanLimit, Math.max(requestedLimit * 5, requestedLimit, 100));
  const createdAt = input.createdAt || new Date().toISOString();
  const observationLimit = input.observationId ? 1 : Math.max(scanLimit, requestedLimit);
  const observations = storage.listObservations({
    runId: input.runId,
    sourceKey: input.sourceKey,
    observationId: input.observationId,
    freshness: input.freshness,
    includeFullText: true,
    includeCollections: true,
    includePayload: true,
    limit: observationLimit,
  });

  const results = [];
  let enrichedCount = 0;
  let fragmentCount = 0;
  let skippedExistingCount = 0;
  let noFragmentCount = 0;

  for (const observation of observations) {
    if (!input.observationId && enrichedCount >= requestedLimit) {
      break;
    }

    const existing = storage.listEvidenceFragments({
      observationId: observation.id,
      producerKind,
      producerVersion,
      limit: 1,
    });

    if (existing.length) {
      skippedExistingCount += 1;
      results.push({
        observationId: observation.id,
        status: 'skipped_existing',
        createdCount: 0,
      });
      continue;
    }

    const fragments = buildObservationEvidenceFragments(observation, {
      producerKind,
      producerVersion,
    });

    if (!fragments.length) {
      noFragmentCount += 1;
      results.push({
        observationId: observation.id,
        status: 'no_fragments',
        createdCount: 0,
      });
      continue;
    }

    const writeResult = storage.recordEvidenceFragmentsWithAudit({
      actorId: `${producerKind}:${producerVersion}`,
      actorKind: 'system',
      createdAt,
      eventKind: 'evidence_enrichment_recorded',
      observationId: observation.id,
      fragments,
      payload: {
        fragmentCount: fragments.length,
        fragmentKinds: summarizeCounts(fragments, 'fragmentKind'),
        fieldPaths: summarizeDistinctValues(fragments, 'fieldPath'),
        producerKind,
        producerVersion,
        sourceSurfaces: summarizeCounts(fragments, 'sourceSurface'),
      },
    });

    if (!writeResult.created.length) {
      skippedExistingCount += 1;
      results.push({
        observationId: observation.id,
        status: 'skipped_existing',
        createdCount: 0,
      });
      continue;
    }

    const { created } = writeResult;
    enrichedCount += 1;
    fragmentCount += created.length;
    results.push({
      observationId: observation.id,
      status: 'enriched',
      createdCount: created.length,
      fieldPaths: summarizeDistinctValues(created, 'fieldPath'),
      sourceSurfaces: summarizeCounts(created, 'sourceSurface'),
      fragmentKinds: summarizeCounts(created, 'fragmentKind'),
    });
  }

  return {
    producer: {
      producerKind,
      producerVersion,
    },
    filters: compactObject({
      runId: input.runId,
      sourceKey: input.sourceKey,
      observationId: input.observationId,
      freshness: input.freshness,
      limit: requestedLimit,
      scanLimit: observationLimit,
    }),
    scannedCount: observations.length,
    enrichedCount,
    skippedExistingCount,
    noFragmentCount,
    fragmentCount,
    results,
  };
}

function summarizeCounts(items, key) {
  const counts = {};

  for (const item of items) {
    const value = normalizeString(item?.[key]);
    if (!value) continue;
    counts[value] = Number(counts[value] || 0) + 1;
  }

  return counts;
}

function summarizeDistinctValues(items, key) {
  return Array.from(new Set(
    items
      .map((item) => normalizeString(item?.[key]))
      .filter(Boolean),
  ));
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

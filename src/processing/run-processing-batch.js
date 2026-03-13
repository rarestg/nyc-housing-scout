import { isGeminiProcessingProvenance, resolveProcessingProvenance } from './config.js';
import { processObservationWithHeuristics } from './heuristic-processor.js';
import { processObservationWithGemini } from './gemini/processor.js';

export async function runProcessingBatch(storage, input = {}) {
  const provenance = resolveProcessingProvenance(input);
  const claimed = [];
  const results = [];
  const handledJobIds = new Set();
  const batchStartedAt = new Date().toISOString();
  const batchStartedMs = Date.now();
  const requestedLimit = normalizeLimit(input.limit, 10);
  let firstClaimedAt = null;

  while (claimed.length < requestedLimit) {
    const [job] = storage.claimProcessingJobs({
      runId: input.runId,
      sourceKey: input.sourceKey,
      observationId: input.observationId,
      freshness: input.freshness,
      limit: 1,
      leaseMs: input.leaseMs,
      claimedBy: input.claimedBy,
      includeObservationPayload: true,
      excludeJobIds: Array.from(handledJobIds),
      ...provenance,
    });

    if (!job) {
      break;
    }

    handledJobIds.add(job.id);
    claimed.push(job);
    firstClaimedAt ||= job.claimedAt || new Date().toISOString();
    const jobStartedMs = Date.now();

    try {
      const basePayload = await processObservation(toObservationInput(job), {
        ...input,
        ...provenance,
      });
      const completedAt = new Date().toISOString();
      const resultMetrics = buildJobMetrics({
        job,
        outcomeAt: completedAt,
        outcomeAtMs: Date.now(),
        startedAtMs: jobStartedMs,
        status: 'processed',
        payload: basePayload,
      });
      const payload = attachProcessingMetrics(basePayload, {
        status: 'processed',
        claimedBy: input.claimedBy,
        attemptCount: resultMetrics.attemptCount,
        retryCount: resultMetrics.retryCount,
        claimedAt: job.claimedAt,
        completedAt,
        latencyMs: resultMetrics.latencyMs,
      });
      const completed = storage.completeProcessingJob({
        jobId: job.id,
        claimedBy: input.claimedBy,
        completedAt,
        payload,
      });

      results.push({
        jobId: completed.id,
        observationId: completed.observationId,
        status: completed.status,
        processedListingCount: payload.extracted.listingCount,
        attemptCount: resultMetrics.attemptCount,
        retryCount: resultMetrics.retryCount,
        timedOut: false,
        latencyMs: resultMetrics.latencyMs,
        claimedAt: job.claimedAt,
        completedAt,
        tokenUsage: resultMetrics.tokenUsage,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const errorInfo = classifyProcessingError(error);
      const failed = storage.failProcessingJob({
        jobId: job.id,
        claimedBy: input.claimedBy,
        failedAt,
        errorMessage: errorInfo.message,
        retryDelayMs: input.retryDelayMs,
      });
      const resultMetrics = buildJobMetrics({
        job,
        outcomeAt: failedAt,
        outcomeAtMs: Date.now(),
        startedAtMs: jobStartedMs,
        status: failed.status,
      });

      results.push({
        jobId: failed.id,
        observationId: failed.observationId,
        status: failed.status,
        error: failed.lastError,
        attemptCount: resultMetrics.attemptCount,
        retryCount: resultMetrics.retryCount,
        timedOut: errorInfo.timedOut,
        latencyMs: resultMetrics.latencyMs,
        claimedAt: job.claimedAt,
        completedAt: failedAt,
        tokenUsage: null,
      });
    }
  }

  const batchCompletedAt = new Date().toISOString();
  const metrics = summarizeBatchMetrics({
    batchStartedAt,
    batchStartedMs,
    batchCompletedAt,
    claimed,
    results,
    firstClaimedAt,
  });

  return {
    claimed,
    results,
    claimedCount: claimed.length,
    processedCount: results.filter((result) => result.status === 'processed').length,
    retryableCount: results.filter((result) => result.status === 'retryable').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    metrics,
  };
}

async function processObservation(observation, options) {
  if (isGeminiProcessingProvenance(options)) {
    return processObservationWithGemini(observation, options);
  }

  return processObservationWithHeuristics(observation, options);
}

function toObservationInput(job) {
  return {
    id: job.observationId,
    runId: job.observationRunId,
    sourceId: job.sourceId,
    stablePostId: job.stablePostId,
    platformPostId: job.platformPostId,
    sourceKey: job.sourceKey,
    groupName: job.sourceDisplayName,
    postUrl: job.postUrl,
    authorName: job.authorName,
    postedAtText: job.postedAtText,
    capturedAt: job.capturedAt,
    freshness: job.observationFreshness,
    payload: job.observationPayload,
  };
}

function attachProcessingMetrics(payload, metrics) {
  return {
    ...payload,
    processing: metrics,
  };
}

function buildJobMetrics(input) {
  const attemptCount = Number(input.job?.attemptCount || 0);
  const retryCount = Math.max(0, attemptCount - 1);
  const latencyMs = diffIsoOrMillis(input.job?.claimedAt, input.outcomeAt, input.outcomeAtMs - input.startedAtMs);

  return {
    status: input.status,
    attemptCount,
    retryCount,
    latencyMs,
    tokenUsage: extractTokenUsage(input.payload?.gemini?.usageMetadata),
  };
}

function summarizeBatchMetrics(input) {
  const latencies = input.results
    .map((result) => Number(result.latencyMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const tokenUsage = {};

  for (const result of input.results) {
    for (const [key, value] of Object.entries(result.tokenUsage || {})) {
      tokenUsage[key] = Number(tokenUsage[key] || 0) + value;
    }
  }

  return {
    batchStartedAt: input.batchStartedAt,
    batchCompletedAt: input.batchCompletedAt,
    claimToCompleteMs: diffIsoOrMillis(
      input.firstClaimedAt,
      input.batchCompletedAt,
      Date.now() - input.batchStartedMs,
    ),
    claimedSequentially: true,
    jobLatencyMs: {
      count: latencies.length,
      min: latencies.length ? Math.min(...latencies) : 0,
      max: latencies.length ? Math.max(...latencies) : 0,
      avg: latencies.length ? roundNumber(sum(latencies) / latencies.length) : 0,
    },
    timeoutCount: input.results.filter((result) => result.timedOut).length,
    retryCount: input.results.filter((result) => Number(result.retryCount || 0) > 0).length,
    tokenUsage,
    outcomes: {
      processed: input.results.filter((result) => result.status === 'processed').length,
      retryable: input.results.filter((result) => result.status === 'retryable').length,
      failed: input.results.filter((result) => result.status === 'failed').length,
    },
  };
}

function classifyProcessingError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  const name = error instanceof Error ? error.name : '';
  const timedOut = name === 'GeminiRequestTimeoutError'
    || normalizedMessage.includes('timed out')
    || normalizedMessage.includes('timeout');

  return {
    timedOut,
    message,
  };
}

function extractTokenUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object' || Array.isArray(usageMetadata)) {
    return null;
  }

  const counts = Object.fromEntries(
    Object.entries(usageMetadata).filter(([, value]) => Number.isFinite(value)),
  );

  return Object.keys(counts).length ? counts : null;
}

function diffIsoOrMillis(startIso, endIso, fallbackMs = 0) {
  const startMs = Date.parse(String(startIso || ''));
  const endMs = Date.parse(String(endIso || ''));

  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    return endMs - startMs;
  }

  return Math.max(0, fallbackMs);
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

import { processObservationWithHeuristics } from './heuristic-processor.js';

export function runProcessingBatch(storage, input = {}) {
  const claimed = storage.claimProcessingJobs({
    runId: input.runId,
    sourceKey: input.sourceKey,
    observationId: input.observationId,
    freshness: input.freshness,
    limit: input.limit,
    leaseMs: input.leaseMs,
    claimedBy: input.claimedBy,
    includeObservationPayload: true,
    processorVersion: input.processorVersion,
    schemaVersion: input.schemaVersion,
    modelName: input.modelName,
  });

  const results = [];

  for (const job of claimed) {
    try {
      const payload = processObservationWithHeuristics(toObservationInput(job), {
        processorVersion: input.processorVersion,
        schemaVersion: input.schemaVersion,
        modelName: input.modelName,
      });
      const completed = storage.completeProcessingJob({
        jobId: job.id,
        claimedBy: input.claimedBy,
        payload,
      });

      results.push({
        jobId: completed.id,
        observationId: completed.observationId,
        status: completed.status,
        processedListingCount: payload.extracted.listingCount,
      });
    } catch (error) {
      const failed = storage.failProcessingJob({
        jobId: job.id,
        claimedBy: input.claimedBy,
        errorMessage: error instanceof Error ? error.message : String(error),
        retryDelayMs: input.retryDelayMs,
      });

      results.push({
        jobId: failed.id,
        observationId: failed.observationId,
        status: failed.status,
        error: failed.lastError,
      });
    }
  }

  return {
    claimed,
    results,
    claimedCount: claimed.length,
    processedCount: results.filter((result) => result.status === 'processed').length,
    retryableCount: results.filter((result) => result.status === 'retryable').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
  };
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

import { extractListingsFromPost } from '../extractors/text-extractor.js';
import { resolveProcessingProvenance } from './config.js';

export function processObservationWithHeuristics(observation, options = {}) {
  const provenance = resolveProcessingProvenance(options);
  const processedAt = options.processedAt || new Date().toISOString();
  const post = buildCollectedPostFromObservation(observation);

  if (!post.postUrl) {
    throw new Error(`processing requires postUrl for observation ${observation.id}`);
  }

  const listings = extractListingsFromPost(post);

  return {
    processorVersion: provenance.processorVersion,
    schemaVersion: provenance.schemaVersion,
    modelName: provenance.modelName,
    processedAt,
    observation: {
      id: observation.id,
      runId: observation.runId,
      sourceId: observation.sourceId,
      stablePostId: observation.stablePostId,
      platformPostId: observation.platformPostId,
      sourceKey: post.sourceKey,
      groupName: post.groupName,
      authorName: post.authorName,
      postedAtText: post.postedAtText,
      capturedAt: post.capturedAt,
      freshness: observation.freshness,
      postUrl: post.postUrl,
    },
    extracted: {
      listingCount: listings.length,
      listings,
    },
  };
}

function buildCollectedPostFromObservation(observation) {
  const payload = observation?.payload && typeof observation.payload === 'object'
    ? observation.payload
    : {};

  return {
    ...payload,
    sourceKey: payload.sourceKey || observation.sourceKey || null,
    groupName: payload.groupName || observation.groupName || null,
    postId: payload.postId || observation.platformPostId || null,
    postUrl: payload.postUrl || observation.postUrl || null,
    authorName: payload.authorName || observation.authorName || null,
    postedAtText: payload.postedAtText || observation.postedAtText || null,
    bodyText: payload.bodyText || observation.bodyText || '',
    comments: Array.isArray(payload.comments) ? payload.comments : observation.comments,
    media: Array.isArray(payload.media) ? payload.media : observation.media,
    captureMethod: payload.captureMethod || observation.captureMethod || null,
    captureRunId: payload.captureRunId || observation.captureRunId || null,
    capturedAt: payload.capturedAt || observation.capturedAt || null,
    rawArtifactPath: payload.rawArtifactPath || observation.rawArtifactPath || null,
    captureHints: payload.captureHints || observation.captureHints || {},
    derivedLocation: payload.derivedLocation || observation.derivedLocation || null,
  };
}

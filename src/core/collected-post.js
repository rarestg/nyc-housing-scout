import { cleanPostBodyText, enrichPostLocation, normalizeAuthorName } from './post-cleaning.js';
import { sanitizeFilename } from './file-utils.js';
import {
  extractFacebookPostIdFromUrl,
  normalizeFacebookPostUrl,
} from './facebook-post-identity.js';

export function createCollectedPost(rawPost, options = {}) {
  const bodyText = cleanPostBodyText(rawPost.bodyText || '');
  const authorName = normalizeAuthorName(rawPost.authorName ?? rawPost.author, bodyText);
  const groupId = rawPost.groupId || options.groupId || null;
  const postId = rawPost.postId || null;
  const postUrl = normalizeFacebookPostUrl(rawPost.postUrl, { postId, groupId });
  const captureIndex = Number.isInteger(rawPost.captureIndex)
    ? rawPost.captureIndex
    : (Number.isInteger(rawPost.index) ? rawPost.index : null);
  const capturedAt = options.capturedAt || rawPost.capturedAt || new Date().toISOString();

  return enrichPostLocation({
    dedupeKey: rawPost.dedupeKey || buildFallbackDedupeKey({
      postId,
      postUrl,
      authorName,
      postedAtText: rawPost.postedAtText,
      bodyText,
      captureIndex,
    }),
    platform: options.platform || rawPost.platform || 'facebook',
    sourceKey: options.sourceKey || rawPost.sourceKey || null,
    groupName: rawPost.groupName || options.groupName || null,
    groupId,
    groupUrl: rawPost.groupUrl || options.groupUrl || null,
    postId,
    postUrl,
    storyId: rawPost.storyId || null,
    feedbackId: rawPost.feedbackId || null,
    authorName,
    authorId: rawPost.authorId || null,
    authorUrl: rawPost.authorUrl || null,
    postedAtText: rawPost.postedAtText || null,
    postedAtTimestamp: normalizeTimestamp(rawPost.postedAtTimestamp),
    postedAtIso: rawPost.postedAtIso || null,
    bodyText,
    comments: normalizeComments(rawPost.comments),
    media: normalizeMedia(rawPost),
    attachmentSummary: normalizeAttachmentSummary(rawPost.attachmentSummary),
    captureMethod: options.captureMethod || rawPost.captureMethod || null,
    captureRunId: options.captureRunId || rawPost.captureRunId || null,
    captureIndex,
    capturedAt,
    rawArtifactPath: options.rawArtifactPath || rawPost.rawArtifactPath || null,
    captureHints: {
      ...(rawPost.captureHints || {}),
      hasSeeMore: Boolean(rawPost.hasSeeMore ?? rawPost.seeMoreRef),
      seeMoreText: rawPost.seeMoreText || null,
    },
  });
}

export function getCollectedPostKey(post) {
  return post.postId
    || normalizeFacebookPostUrl(post.postUrl, { postId: post.postId, groupId: post.groupId })
    || post.dedupeKey
    || buildFallbackDedupeKey(post);
}

export function getCollectedIdentityAliases(post) {
  const aliases = [];
  const derivedPostId = extractFacebookPostIdFromUrl(post?.postUrl);

  if (post?.postId) {
    aliases.push(`post_id:${String(post.postId)}`);
  } else if (derivedPostId) {
    aliases.push(`post_id:${derivedPostId}`);
  }

  if (post?.postUrl) {
    const normalizedPostUrl = normalizeFacebookPostUrl(post.postUrl, {
      postId: post.postId,
      groupId: post.groupId,
    });
    if (normalizedPostUrl) {
      aliases.push(`post_url:${normalizedPostUrl}`);
    }
  }

  if (post?.dedupeKey) {
    aliases.push(`dedupe:${String(post.dedupeKey)}`);
  }

  return aliases;
}

export function choosePreferredCollectedPost(left, right) {
  if (!left) return right;
  if (!right) return left;

  const preferred = scoreCollectedPostRichness(right) > scoreCollectedPostRichness(left)
    ? right
    : left;
  const fallback = preferred === right ? left : right;
  const postId = preferred.postId || fallback.postId || null;
  const groupId = preferred.groupId || fallback.groupId || null;
  const postUrl = normalizeFacebookPostUrl(
    preferred.postUrl || fallback.postUrl,
    { postId, groupId },
  );

  return {
    ...fallback,
    ...preferred,
    platform: preferred.platform || fallback.platform || 'facebook',
    sourceKey: preferred.sourceKey || fallback.sourceKey || null,
    groupName: preferred.groupName || fallback.groupName || null,
    groupId,
    groupUrl: preferred.groupUrl || fallback.groupUrl || null,
    postId,
    postUrl,
    storyId: preferred.storyId || fallback.storyId || null,
    feedbackId: preferred.feedbackId || fallback.feedbackId || null,
    authorName: preferred.authorName || fallback.authorName || null,
    authorId: preferred.authorId || fallback.authorId || null,
    authorUrl: preferred.authorUrl || fallback.authorUrl || null,
    postedAtText: preferred.postedAtText || fallback.postedAtText || null,
    postedAtTimestamp: preferred.postedAtTimestamp ?? fallback.postedAtTimestamp ?? null,
    postedAtIso: preferred.postedAtIso || fallback.postedAtIso || null,
    bodyText: preferred.bodyText || fallback.bodyText || '',
    comments: uniqueStringsFromArrays(fallback.comments, preferred.comments),
    media: dedupeMedia([...(fallback.media || []), ...(preferred.media || [])]),
    attachmentSummary: mergeAttachmentSummary(fallback.attachmentSummary, preferred.attachmentSummary),
    captureMethod: preferred.captureMethod || fallback.captureMethod || null,
    captureRunId: preferred.captureRunId || fallback.captureRunId || null,
    captureIndex: preferred.captureIndex ?? fallback.captureIndex ?? null,
    capturedAt: preferred.capturedAt || fallback.capturedAt || null,
    rawArtifactPath: preferred.rawArtifactPath || fallback.rawArtifactPath || null,
    dedupeKey: preferred.dedupeKey || fallback.dedupeKey || null,
    captureHints: {
      ...(fallback.captureHints || {}),
      ...(preferred.captureHints || {}),
      networkEnrichment: {
        ...(fallback.captureHints?.networkEnrichment || {}),
        ...(preferred.captureHints?.networkEnrichment || {}),
      },
    },
  };
}

export function classifyCollectedPostFreshness(post, seenIds) {
  if (!post.postId) return 'unidentified';
  if (seenIds.has(post.postId)) return 'seen';
  return 'fresh';
}

export function mergeCollectedPostWithNetworkData(post, networkPost, options = {}) {
  const existing = post || {};
  const network = networkPost || {};
  const mergedBodyText = chooseMergedBodyText(existing.bodyText, network.bodyText, existing.captureHints);
  const mergedAuthorName = normalizeAuthorName(existing.authorName || network.authorName, mergedBodyText)
    || existing.authorName
    || network.authorName
    || null;
  const mergedPostId = existing.postId || network.postId || null;
  const mergedGroupId = existing.groupId || network.groupId || null;
  const mergedPostUrl = normalizeFacebookPostUrl(existing.postUrl || network.postUrl, {
    postId: mergedPostId,
    groupId: mergedGroupId,
  });
  const merged = enrichPostLocation({
    ...existing,
    postId: mergedPostId,
    postUrl: mergedPostUrl,
    storyId: existing.storyId || network.storyId || null,
    feedbackId: existing.feedbackId || network.feedbackId || null,
    authorName: mergedAuthorName,
    authorId: existing.authorId || network.authorId || null,
    authorUrl: existing.authorUrl || network.authorUrl || null,
    groupName: existing.groupName || network.groupName || null,
    groupId: mergedGroupId,
    groupUrl: existing.groupUrl || network.groupUrl || null,
    postedAtTimestamp: normalizeTimestamp(existing.postedAtTimestamp ?? network.postedAtTimestamp),
    postedAtIso: existing.postedAtIso || network.postedAtIso || null,
    bodyText: mergedBodyText,
    attachmentSummary: mergeAttachmentSummary(existing.attachmentSummary, network.attachmentSummary),
    captureHints: mergeCaptureHints(existing.captureHints, buildNetworkMergeHints(network, options)),
  });

  return {
    ...merged,
    dedupeKey: existing.dedupeKey || buildFallbackDedupeKey({
      postId: merged.postId,
      postUrl: merged.postUrl,
      authorName: merged.authorName,
      postedAtText: merged.postedAtText,
      bodyText: merged.bodyText,
      captureIndex: merged.captureIndex,
    }),
  };
}

export function buildCollectedPostArtifactId(post) {
  const captureIndex = post.captureIndex ?? post.index ?? 0;
  const suffix = String(captureIndex).padStart(3, '0');
  const base = post.postId || post.authorName || post.author || post.dedupeKey || `post-${suffix}`;
  return `${sanitizeFilename(base)}-${suffix}`;
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment) => String(comment || '').trim()).filter(Boolean);
}

function normalizeMedia(rawPost) {
  if (Array.isArray(rawPost.media)) {
    return dedupeMedia(rawPost.media.map((item) => normalizeMediaItem(item)).filter(Boolean));
  }

  const media = [
    ...toMediaItems(rawPost.mediaLinks, inferMediaTypeFromUrl),
    ...toMediaItems(rawPost.imageUrls, () => 'photo'),
    ...toMediaItems(rawPost.videoUrls, () => 'video'),
  ];

  return dedupeMedia(media);
}

function normalizeMediaItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    return { type: inferMediaTypeFromUrl(item), url: item };
  }

  const url = String(item.url || '').trim();
  if (!url) return null;

  return {
    type: item.type || inferMediaTypeFromUrl(url),
    url,
  };
}

function toMediaItems(items, typeResolver) {
  if (!Array.isArray(items)) return [];
  return items
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .map((url) => ({ type: typeResolver(url), url }));
}

function dedupeMedia(items) {
  const seen = new Set();
  const media = [];

  for (const item of items) {
    if (!item || !item.url) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    media.push(item);
  }

  return media;
}

function inferMediaTypeFromUrl(url) {
  if (/\/photo\/\?fbid=/i.test(url)) return 'photo';
  if (/\/videos?\//i.test(url)) return 'video';
  return 'unknown';
}

function buildFallbackDedupeKey(post) {
  if (post.postId) return post.postId;
  const normalizedPostUrl = normalizeFacebookPostUrl(post.postUrl, {
    postId: post.postId,
    groupId: post.groupId,
  });
  if (normalizedPostUrl) return normalizedPostUrl;
  const authorName = String(post.authorName || post.author || 'unknown-author').trim() || 'unknown-author';
  const postedAtText = String(post.postedAtText || 'unknown-time').trim() || 'unknown-time';
  const bodyText = cleanPostBodyText(post.bodyText || '').slice(0, 120) || `capture-${post.captureIndex ?? post.index ?? 'unknown'}`;
  return `${authorName}|${postedAtText}|${bodyText}`;
}

function normalizeNullableString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function scoreCollectedPostRichness(post) {
  let score = 0;

  if (post?.postId) score += 200;
  if (post?.postUrl) score += 120;
  if (post?.postedAtTimestamp) score += 40;
  if (post?.authorId) score += 15;
  if (post?.groupId) score += 10;
  if (post?.bodyText) score += Math.min(cleanPostBodyText(post.bodyText).length, 200);

  return score;
}

function normalizeTimestamp(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{9,}$/.test(value.trim())) {
    const numeric = Number.parseInt(value, 10);
    return Number.isInteger(numeric) ? numeric : null;
  }
  return null;
}

function normalizeAttachmentSummary(value) {
  if (!value || typeof value !== 'object') return null;

  const count = Number.isInteger(value.count) ? value.count : null;
  const types = Array.isArray(value.types)
    ? value.types.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const titles = Array.isArray(value.titles)
    ? value.titles.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const media = Array.isArray(value.media)
    ? value.media
      .map((item) => normalizeAttachmentMedia(item))
      .filter(Boolean)
    : [];

  if (count === null && !types.length && !titles.length && !media.length) {
    return null;
  }

  return {
    count: count ?? media.length,
    types,
    titles,
    media,
  };
}

function normalizeAttachmentMedia(value) {
  if (!value || typeof value !== 'object') return null;

  const type = String(value.type || '').trim();
  const id = String(value.id || '').trim();
  const url = String(value.url || '').trim();

  if (!type && !id && !url) return null;

  return {
    type: type || null,
    id: id || null,
    url: url || null,
  };
}

function chooseMergedBodyText(existingBody, networkBody, captureHints) {
  const current = cleanPostBodyText(existingBody || '');
  const candidate = cleanPostBodyText(networkBody || '');

  if (!candidate) return current;
  if (!current) return candidate;

  const hasSeeMore = Boolean(captureHints?.hasSeeMore);
  if (hasSeeMore && candidate.length >= current.length) {
    return candidate;
  }

  if (candidate.length > current.length && candidate.startsWith(current.slice(0, Math.min(current.length, 80)))) {
    return candidate;
  }

  if (candidate.length > current.length + 40) {
    return candidate;
  }

  return current;
}

function mergeAttachmentSummary(existing, incoming) {
  const left = normalizeAttachmentSummary(existing);
  const right = normalizeAttachmentSummary(incoming);

  if (!left) return right;
  if (!right) return left;

  return {
    count: Math.max(left.count ?? 0, right.count ?? 0),
    types: uniqueStringsFromArrays(left.types, right.types),
    titles: uniqueStringsFromArrays(left.titles, right.titles),
    media: dedupeAttachmentMedia([...(left.media || []), ...(right.media || [])]),
  };
}

function dedupeAttachmentMedia(items) {
  const seen = new Set();
  const media = [];

  for (const item of items || []) {
    const normalized = normalizeAttachmentMedia(item);
    if (!normalized) continue;

    const key = `${normalized.type || ''}|${normalized.id || ''}|${normalized.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    media.push(normalized);
  }

  return media;
}

function uniqueStringsFromArrays(...arrays) {
  const seen = new Set();
  const values = [];

  for (const array of arrays) {
    for (const item of array || []) {
      const normalized = String(item || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(normalized);
    }
  }

  return values;
}

function mergeCaptureHints(existing, incoming) {
  return {
    ...(existing || {}),
    ...(incoming || {}),
    networkEnrichment: {
      ...(existing?.networkEnrichment || {}),
      ...(incoming?.networkEnrichment || {}),
    },
  };
}

function buildNetworkMergeHints(networkPost, options = {}) {
  const selectedPath = networkPost?.source?.selectedPath || null;
  const selectedScore = networkPost?.source?.selectedScore ?? null;
  const request = networkPost?.request || {};
  const matchReasons = Array.isArray(options.matchReasons) ? options.matchReasons : [];

  return {
    networkEnrichment: {
      partial: Boolean(networkPost?.partial),
      selectedPath,
      selectedScore,
      requestFriendlyName: request.fbApiReqFriendlyName || null,
      requestDocId: request.docId || null,
      matchScore: Number.isFinite(options.matchScore) ? options.matchScore : null,
      matchReasons,
      matchStrategy: options.matchStrategy || null,
      domHadPostId: Boolean(options.domHadPostId),
      domHadPostUrl: Boolean(options.domHadPostUrl),
      identityRecovered: Boolean(options.identityRecovered),
      matchedCaptureId: options.matchedCaptureId || null,
      matchedCaptureMode: options.matchedCaptureMode || null,
      matchedRetentionReason: options.matchedRetentionReason || null,
      matchedStepIndex: Number.isInteger(options.matchedStepIndex) ? options.matchedStepIndex : null,
      matchedPhase: options.matchedPhase || null,
      mergedAtStepIndex: Number.isInteger(options.mergedAtStepIndex) ? options.mergedAtStepIndex : null,
    },
  };
}

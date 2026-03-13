import { cleanPostBodyText, enrichPostLocation, normalizeAuthorName } from './post-cleaning.js';
import { sanitizeFilename } from './file-utils.js';

export function createCollectedPost(rawPost, options = {}) {
  const bodyText = cleanPostBodyText(rawPost.bodyText || '');
  const authorName = normalizeAuthorName(rawPost.authorName ?? rawPost.author, bodyText);
  const captureIndex = Number.isInteger(rawPost.captureIndex)
    ? rawPost.captureIndex
    : (Number.isInteger(rawPost.index) ? rawPost.index : null);
  const capturedAt = options.capturedAt || rawPost.capturedAt || new Date().toISOString();

  return enrichPostLocation({
    dedupeKey: rawPost.dedupeKey || buildFallbackDedupeKey({
      postId: rawPost.postId,
      authorName,
      postedAtText: rawPost.postedAtText,
      bodyText,
      captureIndex,
    }),
    platform: options.platform || rawPost.platform || 'facebook',
    sourceKey: options.sourceKey || rawPost.sourceKey || null,
    groupName: rawPost.groupName || options.groupName || null,
    postId: rawPost.postId || null,
    postUrl: rawPost.postUrl || null,
    authorName,
    postedAtText: rawPost.postedAtText || null,
    bodyText,
    comments: normalizeComments(rawPost.comments),
    media: normalizeMedia(rawPost),
    captureMethod: options.captureMethod || rawPost.captureMethod || null,
    captureRunId: options.captureRunId || rawPost.captureRunId || null,
    captureIndex,
    capturedAt,
    rawArtifactPath: options.rawArtifactPath || rawPost.rawArtifactPath || null,
    captureHints: {
      hasSeeMore: Boolean(rawPost.hasSeeMore ?? rawPost.seeMoreRef),
      seeMoreText: rawPost.seeMoreText || null,
    },
  });
}

export function getCollectedPostKey(post) {
  return post.postId || post.dedupeKey || buildFallbackDedupeKey(post);
}

export function classifyCollectedPostFreshness(post, seenIds) {
  if (!post.postId) return 'unidentified';
  if (seenIds.has(post.postId)) return 'seen';
  return 'fresh';
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
  const authorName = String(post.authorName || post.author || 'unknown-author').trim() || 'unknown-author';
  const postedAtText = String(post.postedAtText || 'unknown-time').trim() || 'unknown-time';
  const bodyText = cleanPostBodyText(post.bodyText || '').slice(0, 120) || `capture-${post.captureIndex ?? post.index ?? 'unknown'}`;
  return `${authorName}|${postedAtText}|${bodyText}`;
}

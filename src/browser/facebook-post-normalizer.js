import { cleanPostBodyText, normalizeAuthorName } from '../core/post-cleaning.js';
import {
  buildFacebookFallbackPostUrl,
  normalizeFacebookPostUrl,
} from '../core/facebook-post-identity.js';
import { parseFacebookResponseText } from './facebook-response-parser.js';
import { collectFacebookNumericHints } from './network-capture.js';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeSpace(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNonNull(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function safeGet(value, ...path) {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return null;
      current = current[segment];
    } else {
      if (!isRecord(current)) return null;
      current = current[segment];
    }

    if (current === null || current === undefined) {
      return null;
    }
  }

  return current;
}

function uniqueStrings(values) {
  const seen = new Set();
  const items = [];

  for (const value of values || []) {
    const normalized = normalizeNullableString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

function cleanObject(record) {
  if (!isRecord(record)) return null;

  const cleaned = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isRecord(value) && Object.keys(value).length === 0) continue;
    cleaned[key] = value;
  }

  return Object.keys(cleaned).length ? cleaned : null;
}

function mergeDefinedRecords(...records) {
  const merged = {};

  for (const record of records) {
    if (!isRecord(record)) continue;

    for (const [key, value] of Object.entries(record)) {
      if (merged[key] !== undefined) continue;
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (isRecord(value) && Object.keys(value).length === 0) continue;
      merged[key] = value;
    }
  }

  return Object.keys(merged).length ? merged : null;
}

function pruneRecord(record, keys) {
  if (!isRecord(record)) return null;

  const pruned = {};
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isRecord(value) && Object.keys(value).length === 0) continue;
    pruned[key] = value;
  }

  return Object.keys(pruned).length ? pruned : null;
}

function formatUnixTimestamp(seconds) {
  if (!Number.isInteger(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function normalizeUnixTimestamp(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{9,}$/.test(value.trim())) {
    const numeric = Number.parseInt(value, 10);
    return Number.isInteger(numeric) ? numeric : null;
  }
  return null;
}

function decodeUnicodeEscapes(value) {
  return String(value || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => (
    String.fromCharCode(Number.parseInt(hex, 16))
  ));
}

function unescapeFragmentText(value) {
  return decodeUnicodeEscapes(value)
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

function decodeFacebookEncodedId(value) {
  const raw = normalizeNullableString(value);
  if (!raw) {
    return {
      raw: null,
      decodedText: null,
      numericId: null,
    };
  }

  const candidates = [raw];
  try {
    const decodedUri = decodeURIComponent(raw);
    if (decodedUri && decodedUri !== raw) {
      candidates.push(decodedUri);
    }
  } catch {
    // Ignore malformed URI encodings.
  }

  let decodedText = null;
  let numericId = /^\d{8,}$/.test(raw) ? raw : null;

  for (const candidate of candidates) {
    if (!decodedText) {
      decodedText = candidate;
    }

    const namespacedMatch = candidate.match(/(?:feedback|story|post|group_post):(\d{8,})/i);
    if (namespacedMatch) {
      numericId = namespacedMatch[1];
      decodedText = candidate;
      break;
    }

    const vkMatch = candidate.match(/:VK:(\d{8,})$/i);
    if (vkMatch) {
      numericId = vkMatch[1];
      decodedText = candidate;
      break;
    }

    if (/^\d{8,}$/.test(candidate)) {
      numericId = candidate;
      decodedText = candidate;
      break;
    }

    const normalizedBase64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = normalizedBase64.padEnd(Math.ceil(normalizedBase64.length / 4) * 4, '=');

    try {
      const decoded = Buffer.from(paddedBase64, 'base64').toString('utf8');
      if (decoded && decoded !== candidate) {
        candidates.push(decoded);
      }
    } catch {
      // Ignore non-base64 tokens.
    }
  }

  return {
    raw,
    decodedText: decodedText || null,
    numericId,
  };
}

function buildIdSignal(value) {
  const decoded = decodeFacebookEncodedId(value);
  const tokens = uniqueStrings([decoded.raw, decoded.decodedText, decoded.numericId]);

  return {
    raw: decoded.raw,
    decodedText: decoded.decodedText,
    numericId: decoded.numericId,
    tokens,
  };
}

function looksLikeFacebookStoryNode(payload) {
  if (!isRecord(payload)) return false;
  if (normalizeNullableString(payload.post_id) || normalizeNullableString(payload.postId)) return true;
  if (normalizeNullableString(payload.__typename) === 'Story') return true;
  if (normalizeNullableString(payload.__isFeedUnit) === 'Story') return true;
  if (isRecord(payload.feedback) && isRecord(payload.comet_sections)) return true;
  if (safeGet(payload, 'comet_sections', 'content', 'story')) return true;
  if (safeGet(payload, 'comet_sections', 'context_layout', 'story')) return true;
  return false;
}

function getMessageText(payload) {
  return cleanPostBodyText(firstNonNull(
    safeGet(payload, 'message', 'text'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'message', 'text'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'comet_sections', 'message', 'story', 'message', 'text'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'comet_sections', 'message_container', 'story', 'message', 'text'),
  ) || '');
}

function getAuthorRecord(payload) {
  const author = mergeDefinedRecords(
    safeGet(payload, 'feedback', 'owning_profile'),
    safeGet(payload, 'actors', 0),
    safeGet(payload, 'comet_sections', 'context_layout', 'story', 'comet_sections', 'actor_photo', 'story', 'actors', 0),
    safeGet(payload, 'comet_sections', 'context_layout', 'story', 'comet_sections', 'metadata', 0, 'story', 'actors', 0),
  );

  return pruneRecord(author, [
    '__typename',
    'id',
    'name',
    'short_name',
    'url',
    'profile_url',
    'profile_picture',
  ]);
}

function getGroupRecord(payload) {
  const group = mergeDefinedRecords(
    safeGet(payload, 'to'),
    safeGet(payload, 'target_group'),
    safeGet(payload, 'feedback', 'associated_group'),
    safeGet(payload, 'comet_sections', 'context_layout', 'story', 'comet_sections', 'actor_photo', 'story', 'to'),
  );

  return pruneRecord(group, [
    '__typename',
    'id',
    'name',
    'url',
    'profile_picture',
    'context_actor_hovercard',
    'is_multi_company_group',
    'work_official_status',
  ]);
}

function getAttachments(payload) {
  const attachments = firstNonNull(
    safeGet(payload, 'attachments'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'attachments'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'comet_sections', 'message', 'story', 'attachments'),
    safeGet(payload, 'comet_sections', 'content', 'story', 'comet_sections', 'message_container', 'story', 'attachments'),
  );

  return Array.isArray(attachments) ? attachments : [];
}

function getFeedbackContext(payload) {
  return safeGet(
    payload,
    'comet_sections',
    'feedback',
    'story',
    'story_ufi_container',
    'story',
    'feedback_context',
    'feedback_target_with_context',
  );
}

function getEngagement(payload) {
  const feedbackContext = getFeedbackContext(payload);

  return cleanObject({
    canViewerComment: firstNonNull(
      safeGet(feedbackContext, 'can_viewer_comment'),
      safeGet(feedbackContext, 'comment_list_renderer', 'feedback', 'can_viewer_comment'),
    ),
    commentsTotal: firstNonNull(
      safeGet(feedbackContext, 'comment_list_renderer', 'feedback', 'comment_rendering_instance', 'comments', 'total_count'),
      safeGet(feedbackContext, 'comment_list_renderer', 'feedback', 'comment_rendering_instance_for_feed_location', 'comments', 'total_count'),
      safeGet(feedbackContext, 'comet_ufi_summary_and_actions_renderer', 'feedback', 'comment_rendering_instance', 'comments', 'total_count'),
    ),
    reactionsTotal: safeGet(feedbackContext, 'comet_ufi_summary_and_actions_renderer', 'feedback', 'reaction_count', 'count'),
    sharesTotal: safeGet(feedbackContext, 'comet_ufi_summary_and_actions_renderer', 'feedback', 'share_count', 'count'),
    seenByTotal: safeGet(
      feedbackContext,
      'comet_ufi_summary_and_actions_renderer',
      'feedback',
      'if_viewer_cannot_see_seen_by_member_list',
      'seen_by',
      'count',
    ),
  });
}

function getViewerContext(payload) {
  const feedbackContext = getFeedbackContext(payload);

  return cleanObject({
    viewerActor: firstNonNull(
      safeGet(feedbackContext, 'comment_list_renderer', 'feedback', 'viewer_actor'),
      safeGet(feedbackContext, 'comet_ufi_summary_and_actions_renderer', 'feedback', 'viewer_actor'),
    ),
    currentActor: safeGet(feedbackContext, 'comment_list_renderer', 'feedback', 'actor_provider', 'current_actor'),
    viewerSaveState: safeGet(
      payload,
      'comet_sections',
      'feedback',
      'story',
      'story_ufi_container',
      'story',
      'save_info',
      'viewer_save_state',
    ),
  });
}

function getCreationTimestamp(payload) {
  return normalizeUnixTimestamp(firstNonNull(
    safeGet(payload, 'creation_time'),
    safeGet(payload, 'comet_sections', 'context_layout', 'story', 'comet_sections', 'metadata', 1, 'story', 'creation_time'),
    safeGet(payload, 'comet_sections', 'feedback', 'story', 'story_ufi_container', 'story', 'creation_time'),
  ));
}

function getUrls(payload, postId, groupRecord) {
  const urls = cleanObject({
    permalinkUrl: normalizeFacebookPostUrl(safeGet(payload, 'permalink_url'), { postId, groupId: groupRecord?.id }),
    wwwUrl: normalizeFacebookPostUrl(firstNonNull(
      safeGet(payload, 'wwwURL'),
      safeGet(payload, 'comet_sections', 'content', 'story', 'wwwURL'),
    ), { postId, groupId: groupRecord?.id }),
    postUrl: normalizeFacebookPostUrl(safeGet(
      payload,
      'comet_sections',
      'context_layout',
      'story',
      'comet_sections',
      'metadata',
      1,
      'story',
      'url',
    ), { postId, groupId: groupRecord?.id }),
    overrideUrl: normalizeFacebookPostUrl(safeGet(
      payload,
      'comet_sections',
      'context_layout',
      'story',
      'comet_sections',
      'metadata',
      1,
      'override_url',
    ), { postId, groupId: groupRecord?.id }),
    feedbackUrl: normalizeFacebookPostUrl(safeGet(
      getFeedbackContext(payload),
      'comment_list_renderer',
      'feedback',
      'url',
    ), { postId, groupId: groupRecord?.id }),
  });

  return urls || {};
}

function selectCanonicalPostUrl(urls, postId, groupRecord) {
  return firstNonNull(
    urls.postUrl,
    urls.permalinkUrl,
    urls.feedbackUrl,
    urls.wwwUrl,
    urls.overrideUrl,
    buildFacebookFallbackPostUrl(postId, {
      groupId: groupRecord?.id,
      groupUrl: groupRecord?.url,
    }),
  );
}

function summarizeAttachments(attachments) {
  const media = [];
  const titles = [];
  const types = [];
  const seenMediaKeys = new Set();
  const seenTitles = new Set();

  for (const attachment of attachments) {
    const type = normalizeNullableString(firstNonNull(
      safeGet(attachment, 'media', '__typename'),
      safeGet(attachment, '__typename'),
      safeGet(attachment, 'style_type_renderer', 'attachment_type'),
      safeGet(attachment, 'style_type_renderer', '__typename'),
    ));

    if (type && !types.includes(type)) {
      types.push(type);
    }

    const mediaUrl = normalizeNullableString(firstNonNull(
      safeGet(attachment, 'url'),
      safeGet(attachment, 'media', 'url'),
      safeGet(attachment, 'media', 'image', 'uri'),
      safeGet(attachment, 'media', 'preferred_thumbnail', 'image', 'uri'),
      safeGet(attachment, 'media', 'browser_native_hd_url'),
      safeGet(attachment, 'media', 'browser_native_sd_url'),
    ));
    const mediaId = normalizeNullableString(firstNonNull(
      safeGet(attachment, 'media', 'id'),
      safeGet(attachment, 'id'),
    ));
    const mediaKey = `${type || 'unknown'}|${mediaId || ''}|${mediaUrl || ''}`;

    if ((mediaId || mediaUrl) && !seenMediaKeys.has(mediaKey)) {
      seenMediaKeys.add(mediaKey);
      media.push(cleanObject({
        type: type || null,
        id: mediaId,
        url: mediaUrl,
      }));
    }

    const title = normalizeNullableString(firstNonNull(
      safeGet(attachment, 'title_with_entities', 'text'),
      safeGet(attachment, 'title', 'text'),
      safeGet(attachment, 'title'),
      safeGet(attachment, 'media', 'title', 'text'),
    ));

    if (title && !seenTitles.has(title)) {
      seenTitles.add(title);
      titles.push(title);
    }
  }

  return {
    count: Array.isArray(attachments) ? attachments.length : 0,
    types,
    titles,
    media: media.filter(Boolean),
  };
}

function collectPayloadIdSignals(payload) {
  const author = getAuthorRecord(payload);
  const group = getGroupRecord(payload);
  const directPostId = firstNonNull(payload?.post_id, payload?.postId);
  const directStoryId = firstNonNull(
    payload?.story_id,
    payload?.storyId,
    payload?.story_fbid,
    looksLikeFacebookStoryNode(payload) ? payload?.id : null,
  );
  const directFeedbackId = firstNonNull(
    payload?.feedback_id,
    payload?.feedbackId,
    safeGet(payload, 'feedback', 'id'),
  );

  return {
    postId: buildIdSignal(directPostId),
    storyId: buildIdSignal(directStoryId),
    feedbackId: buildIdSignal(directFeedbackId),
    authorId: buildIdSignal(author?.id),
    groupId: buildIdSignal(group?.id),
  };
}

function expandTargetTokens(values) {
  const tokens = [];
  for (const value of values || []) {
    tokens.push(...buildIdSignal(value).tokens);
  }
  return new Set(uniqueStrings(tokens));
}

function normalizeTargetIds(options = {}) {
  const targetPostIds = uniqueStrings([
    ...(options.postIds || []),
    options.postId,
    options.targetPostId,
    ...(options.matchHints?.postIds || []),
  ]);
  const targetStoryIds = uniqueStrings([
    ...(options.storyIds || []),
    options.storyId,
    options.targetStoryId,
    ...(options.matchHints?.storyIds || []),
  ]);
  const targetFeedbackIds = uniqueStrings([
    ...(options.feedbackIds || []),
    options.feedbackId,
    options.targetFeedbackId,
    ...(options.matchHints?.feedbackIds || []),
  ]);

  return {
    hasTargets: Boolean(targetPostIds.length || targetStoryIds.length || targetFeedbackIds.length),
    postIds: expandTargetTokens(targetPostIds),
    storyIds: expandTargetTokens(targetStoryIds),
    feedbackIds: expandTargetTokens(targetFeedbackIds),
  };
}

function getIntersection(values, targetSet) {
  const matches = [];
  for (const value of values || []) {
    if (targetSet.has(value) && !matches.includes(value)) {
      matches.push(value);
    }
  }
  return matches;
}

function buildCandidateMatch(signals, targets) {
  const postMatches = getIntersection(signals.postId.tokens, targets.postIds);
  const storyMatches = getIntersection(signals.storyId.tokens, targets.storyIds);
  const feedbackMatches = getIntersection(signals.feedbackId.tokens, targets.feedbackIds);
  const matchKinds = [];

  if (postMatches.length) matchKinds.push('postId');
  if (storyMatches.length) matchKinds.push('storyId');
  if (feedbackMatches.length) matchKinds.push('feedbackId');

  return {
    matched: Boolean(matchKinds.length),
    matchKinds,
    matchedValues: uniqueStrings([...postMatches, ...storyMatches, ...feedbackMatches]),
  };
}

function countPathDepth(path) {
  return (path.match(/\./g) || []).length + (path.match(/\[/g) || []).length;
}

function scoreCandidate(path, payload, match = { matchKinds: [] }) {
  const keyWeights = {
    id: 5,
    feedback: 8,
    actors: 8,
    attachments: 4,
    comet_sections: 10,
    cache_id: 3,
    permalink_url: 4,
    to: 4,
    target_group: 4,
    message: 4,
  };

  let score = 0;

  for (const [key, weight] of Object.entries(keyWeights)) {
    const value = payload[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isRecord(value) && Object.keys(value).length === 0) continue;
    if (value === '') continue;
    score += weight;
  }

  if (match.matchKinds.includes('postId')) score += 42;
  if (match.matchKinds.includes('storyId')) score += 28;
  if (match.matchKinds.includes('feedbackId')) score += 26;
  if (looksLikeFacebookStoryNode(payload)) score += 12;
  if (normalizeNullableString(payload.post_id) || normalizeNullableString(payload.postId)) score += 12;
  if (getMessageText(payload)) score += 15;
  if (getAuthorRecord(payload)) score += 10;
  if (getGroupRecord(payload)) score += 10;
  if (Object.keys(getUrls(payload, normalizeNullableString(payload.post_id) || normalizeNullableString(payload.postId), getGroupRecord(payload))).length) {
    score += 8;
  }
  if (getFeedbackContext(payload)) score += 8;
  if (Number.isInteger(getCreationTimestamp(payload))) score += 6;
  if (getAttachments(payload).length) score += 4;

  score -= countPathDepth(path);
  return score;
}

function visitCandidateObjects(root, docIndex, visitor) {
  const stack = [{ path: `doc[${docIndex}]`, value: root }];

  while (stack.length) {
    const current = stack.pop();
    const node = current.value;

    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        const value = node[index];
        if (Array.isArray(value) || isRecord(value)) {
          stack.push({
            path: `${current.path}[${index}]`,
            value,
          });
        }
      }
      continue;
    }

    if (!isRecord(node)) continue;

    visitor(current.path, node);

    const entries = Object.entries(node);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      if (Array.isArray(value) || isRecord(value)) {
        stack.push({
          path: `${current.path}.${key}`,
          value,
        });
      }
    }
  }
}

function buildCandidateGroupKey(payload, signals, docIndex, path) {
  return firstNonNull(
    signals.postId.numericId,
    signals.postId.raw,
    signals.storyId.raw,
    signals.feedbackId.raw,
    normalizeNullableString(payload.cache_id),
    `doc[${docIndex}]:${path}`,
  );
}

function compareCandidates(a, b) {
  if ((b.score || 0) !== (a.score || 0)) {
    return (b.score || 0) - (a.score || 0);
  }

  return (a.path?.length || 0) - (b.path?.length || 0);
}

function normalizeRequestMetadata(metadata) {
  if (!isRecord(metadata)) return null;

  return cleanObject({
    sourceTransport: normalizeNullableString(metadata.sourceTransport),
    url: normalizeNullableString(metadata.url),
    method: normalizeNullableString(metadata.method),
    fbApiReqFriendlyName: normalizeNullableString(metadata.fbApiReqFriendlyName),
    docId: normalizeNullableString(metadata.docId),
    actorId: normalizeNullableString(metadata.actorId),
    captureMode: normalizeNullableString(metadata.captureMode),
    requestTimestamp: normalizeNullableString(metadata.requestTimestamp),
    responseTimestamp: normalizeNullableString(metadata.responseTimestamp),
    groupIds: uniqueStrings(metadata.matchHints?.groupIds || []),
    requestPostIds: uniqueStrings(metadata.matchHints?.requestPostIds || []),
    requestStoryIds: uniqueStrings(metadata.matchHints?.requestStoryIds || []),
    requestFeedbackIds: uniqueStrings(metadata.matchHints?.requestFeedbackIds || []),
    matchedPostIds: uniqueStrings(metadata.matchHints?.postIds || []),
    matchedStoryIds: uniqueStrings(metadata.matchHints?.storyIds || []),
    matchedFeedbackIds: uniqueStrings(metadata.matchHints?.feedbackIds || []),
  });
}

function normalizeCandidateRecord(group, options = {}) {
  const payload = group.best.payload;
  const author = getAuthorRecord(payload) || {};
  const groupRecord = getGroupRecord(payload) || {};
  const bodyText = getMessageText(payload) || null;
  const postId = normalizeNullableString(group.best.signals.postId.numericId || group.best.signals.postId.raw);
  const storyId = normalizeNullableString(group.best.signals.storyId.raw);
  const feedbackId = normalizeNullableString(group.best.signals.feedbackId.raw);
  const postedAtTimestamp = getCreationTimestamp(payload);
  const urls = getUrls(payload, postId, groupRecord);
  const requestMetadata = normalizeRequestMetadata(options.requestMetadata);
  const normalizedAuthorName = normalizeAuthorName(firstNonNull(author.name, author.short_name), bodyText)
    || normalizeNullableString(firstNonNull(author.name, author.short_name));
  const normalized = {
    postId,
    postUrl: selectCanonicalPostUrl(urls, postId, groupRecord),
    storyId,
    storyIdDecoded: normalizeNullableString(group.best.signals.storyId.decodedText),
    feedbackId,
    feedbackIdDecoded: normalizeNullableString(group.best.signals.feedbackId.decodedText),
    typename: normalizeNullableString(payload.__typename),
    authorName: normalizedAuthorName,
    authorId: normalizeNullableString(author.id),
    authorUrl: normalizeNullableString(firstNonNull(author.profile_url, author.url)),
    groupName: normalizeNullableString(groupRecord.name),
    groupId: normalizeNullableString(groupRecord.id),
    groupUrl: normalizeNullableString(groupRecord.url),
    postedAtTimestamp,
    postedAtIso: formatUnixTimestamp(postedAtTimestamp),
    bodyText,
    isTextOnlyStory: firstNonNull(
      safeGet(payload, 'comet_sections', 'content', 'story', 'comet_sections', 'message', 'story', 'is_text_only_story'),
      safeGet(payload, 'is_text_only_story'),
    ),
    hasAttachedStory: payload.attached_story !== null && payload.attached_story !== undefined,
    attachmentSummary: summarizeAttachments(getAttachments(payload)),
    engagement: getEngagement(payload),
    source: cleanObject({
      parseMode: 'response_text',
      documentIndex: group.best.docIndex,
      selectedPath: group.best.path,
      matchCount: group.paths.length,
      selectedScore: group.best.score,
      matchKinds: group.matchKinds,
      matchedValues: group.matchedValues,
      matchPaths: group.paths,
      candidateCount: group.entries.length,
    }),
  };

  if (requestMetadata) {
    normalized.request = requestMetadata;
  }

  if (options.includeViewerContext) {
    const viewerContext = getViewerContext(payload);
    if (viewerContext) {
      normalized.viewerContext = viewerContext;
    }
  }

  return normalized;
}

export function collectFacebookPostCandidatesFromDocuments(documents, options = {}) {
  const targets = normalizeTargetIds(options);
  const includeAllCandidates = options.includeAllCandidates ?? !targets.hasTargets;
  const groups = new Map();

  for (const document of documents || []) {
    visitCandidateObjects(document.value, document.index, (path, payload) => {
      const signals = collectPayloadIdSignals(payload);
      const match = targets.hasTargets
        ? buildCandidateMatch(signals, targets)
        : { matched: looksLikeFacebookStoryNode(payload), matchKinds: ['storyLike'], matchedValues: [] };

      if (!match.matched && !includeAllCandidates) {
        return;
      }

      if (!match.matched && !looksLikeFacebookStoryNode(payload)) {
        return;
      }

      const score = scoreCandidate(path, payload, match);
      const groupKey = buildCandidateGroupKey(payload, signals, document.index, path);
      const entry = {
        docIndex: document.index,
        path,
        payload,
        signals,
        score,
        matchKinds: match.matchKinds,
        matchedValues: match.matchedValues,
      };

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          entries: [entry],
          best: entry,
          paths: [path],
          matchKinds: uniqueStrings(match.matchKinds),
          matchedValues: uniqueStrings(match.matchedValues),
        });
        return;
      }

      const group = groups.get(groupKey);
      group.entries.push(entry);
      if (!group.paths.includes(path)) {
        group.paths.push(path);
      }
      group.matchKinds = uniqueStrings([...group.matchKinds, ...match.matchKinds]);
      group.matchedValues = uniqueStrings([...group.matchedValues, ...match.matchedValues]);

      if (compareCandidates(entry, group.best) < 0) {
        group.best = entry;
      }
    });
  }

  return Array.from(groups.values())
    .map((group) => normalizeCandidateRecord(group, options))
    .sort((left, right) => compareCandidates(
      { score: left.source?.selectedScore, path: left.source?.selectedPath },
      { score: right.source?.selectedScore, path: right.source?.selectedPath },
    ));
}

export function extractFacebookPostCandidatesFromResponseText(text, options = {}) {
  const parsed = parseFacebookResponseText(text, options);

  return {
    ...parsed,
    candidates: collectFacebookPostCandidatesFromDocuments(parsed.documents, options),
  };
}

function extractPrimaryPostIdsFromFragment(text) {
  const ids = [];
  const patterns = [
    /"post_id"\s*:\s*"(\d{8,})"/g,
    /"top_level_post_id"\s*:\s*"(\d{8,})"/g,
    /\/permalink\/(\d{8,})/g,
    /multi_permalinks=(\d{8,})/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      ids.push(match[1]);
      match = pattern.exec(text);
    }
  }

  return uniqueStrings(ids);
}

function parseFragmentFieldSet(text) {
  const authorMatch = text.match(/"owning_profile"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"[^}]*"id"\s*:\s*"(\d+)"/s);
  const groupMatch = text.match(/"to"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"[^}]*"name"\s*:\s*"([^"]+)"/s);
  const targetGroupMatch = text.match(/"target_group"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"/s);
  const storyIdMatch = text.match(/"id"\s*:\s*"(Uzpf[^"]+)"/);
  const feedbackMatch = text.match(/"feedback"\s*:\s*\{(?:\s*"associated_group"\s*:\s*\{[\s\S]*?\}\s*,)?\s*"id"\s*:\s*"([^"]+)"/s);
  const urlMatch = text.match(/"wwwURL"\s*:\s*"([^"]+)"/);

  return cleanObject({
    authorName: authorMatch ? authorMatch[1] : null,
    authorId: authorMatch ? authorMatch[2] : null,
    groupId: groupMatch ? groupMatch[1] : (targetGroupMatch ? targetGroupMatch[1] : null),
    groupName: groupMatch ? groupMatch[2] : null,
    storyId: storyIdMatch ? storyIdMatch[1] : null,
    feedbackId: feedbackMatch ? feedbackMatch[1] : null,
    postUrl: urlMatch ? urlMatch[1] : null,
  });
}

function scoreFragmentBucket(bucket) {
  let score = bucket.primaryHits * 18;
  score += bucket.fragmentCount * 4;
  if (bucket.authorName) score += 10;
  if (bucket.authorId) score += 6;
  if (bucket.groupId) score += 8;
  if (bucket.groupName) score += 8;
  if (bucket.postUrl) score += 10;
  if (bucket.storyId) score += 6;
  if (bucket.feedbackId) score += 6;
  return score;
}

function normalizeFragmentBucket(bucket, item) {
  return {
    postId: bucket.postId,
    postUrl: normalizeFacebookPostUrl(bucket.postUrl, { postId: bucket.postId, groupId: bucket.groupId }),
    storyId: bucket.storyId || null,
    storyIdDecoded: normalizeNullableString(buildIdSignal(bucket.storyId).decodedText),
    feedbackId: bucket.feedbackId || null,
    feedbackIdDecoded: normalizeNullableString(buildIdSignal(bucket.feedbackId).decodedText),
    authorName: normalizeAuthorName(bucket.authorName, null) || normalizeNullableString(bucket.authorName),
    authorId: normalizeNullableString(bucket.authorId),
    groupName: normalizeNullableString(bucket.groupName),
    groupId: normalizeNullableString(bucket.groupId),
    groupUrl: null,
    postedAtTimestamp: null,
    postedAtIso: null,
    bodyText: null,
    isTextOnlyStory: null,
    hasAttachedStory: null,
    attachmentSummary: null,
    engagement: null,
    partial: true,
    source: cleanObject({
      parseMode: 'matched_fragments',
      documentIndex: null,
      selectedPath: null,
      matchCount: bucket.fragmentCount,
      selectedScore: scoreFragmentBucket(bucket),
      matchKinds: ['fragmentPostId'],
      matchedValues: [bucket.postId],
      matchedFragmentLabels: uniqueStrings(bucket.fragmentLabels),
      candidateCount: bucket.fragmentCount,
    }),
    request: normalizeRequestMetadata(item),
  };
}

function extractFacebookPostCandidatesFromMatchedFragments(item) {
  const fragments = Array.isArray(item?.matchedFragments) && item.matchedFragments.length
    ? item.matchedFragments.map((fragment) => ({
        label: fragment?.label || null,
        text: fragment?.text || '',
      }))
    : String(item?.capturedText || '')
      .split(/\n---\n/)
      .filter(Boolean)
      .map((text) => ({ label: null, text }));

  const buckets = new Map();
  const defaultPostId = normalizeNullableString(item?.matchHints?.postIds?.[0]);

  for (const fragment of fragments) {
    const decodedText = unescapeFragmentText(fragment.text);
    const fieldSet = parseFragmentFieldSet(decodedText) || {};
    const hints = collectFacebookNumericHints(decodedText);
    const primaryPostIds = extractPrimaryPostIdsFromFragment(decodedText);
    let postIds = primaryPostIds.length
      ? primaryPostIds
      : uniqueStrings(hints.postIds || []);

    if (!postIds.length && defaultPostId) {
      postIds = [defaultPostId];
    }

    for (const postId of postIds) {
      if (!buckets.has(postId)) {
        buckets.set(postId, {
          postId,
          primaryHits: 0,
          fragmentCount: 0,
          fragmentLabels: [],
          authorName: null,
          authorId: null,
          groupId: null,
          groupName: null,
          storyId: null,
          feedbackId: null,
          postUrl: null,
        });
      }

      const bucket = buckets.get(postId);
      bucket.fragmentCount += 1;
      if (primaryPostIds.includes(postId)) {
        bucket.primaryHits += 1;
      }
      if (fragment.label) {
        bucket.fragmentLabels.push(fragment.label);
      }
      if (!bucket.authorName && fieldSet.authorName) bucket.authorName = fieldSet.authorName;
      if (!bucket.authorId && fieldSet.authorId) bucket.authorId = fieldSet.authorId;
      if (!bucket.groupId && fieldSet.groupId) bucket.groupId = fieldSet.groupId;
      if (!bucket.groupName && fieldSet.groupName) bucket.groupName = fieldSet.groupName;
      if (!bucket.storyId && fieldSet.storyId) bucket.storyId = fieldSet.storyId;
      if (!bucket.feedbackId && fieldSet.feedbackId) bucket.feedbackId = fieldSet.feedbackId;
      if (!bucket.postUrl && fieldSet.postUrl) bucket.postUrl = fieldSet.postUrl;
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => normalizeFragmentBucket(bucket, item))
    .filter(Boolean)
    .sort((left, right) => (right.source?.selectedScore || 0) - (left.source?.selectedScore || 0));
}

function candidateMatchesTargetIds(candidate, options = {}) {
  const targets = normalizeTargetIds(options);
  if (!targets.hasTargets) return true;

  const postSignal = buildIdSignal(candidate?.postId);
  const storySignal = buildIdSignal(candidate?.storyId);
  const feedbackSignal = buildIdSignal(candidate?.feedbackId);

  return Boolean(
    getIntersection(postSignal.tokens, targets.postIds).length
    || getIntersection(storySignal.tokens, targets.storyIds).length
    || getIntersection(feedbackSignal.tokens, targets.feedbackIds).length
  );
}

export function extractFacebookPostCandidatesFromEnvelopeItem(item, options = {}) {
  const captureMode = normalizeNullableString(item?.captureMode);

  if (captureMode === 'full_text') {
    return extractFacebookPostCandidatesFromResponseText(item?.capturedText || '', {
      ...options,
      requestMetadata: item,
    }).candidates;
  }

  return extractFacebookPostCandidatesFromMatchedFragments(item)
    .filter((candidate) => candidateMatchesTargetIds(candidate, options));
}

function buildComparableBodySignature(value) {
  return cleanPostBodyText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countSharedBodyTokens(left, right) {
  const leftTokens = buildComparableBodySignature(left).split(/\s+/).filter(Boolean);
  const rightTokens = new Set(buildComparableBodySignature(right).split(/\s+/).filter(Boolean));
  if (!leftTokens.length || !rightTokens.size) return 0;

  let count = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

export function scoreCollectedPostAgainstFacebookCandidate(collectedPost, candidate) {
  let score = 0;
  const reasons = [];

  const collectedAuthor = normalizeSpace(collectedPost?.authorName || collectedPost?.author);
  const candidateAuthor = normalizeSpace(candidate?.authorName);
  if (collectedAuthor && candidateAuthor && collectedAuthor.localeCompare(candidateAuthor, undefined, { sensitivity: 'base' }) === 0) {
    score += 30;
    reasons.push('author_exact');
  }

  const collectedGroupId = normalizeNullableString(collectedPost?.groupId);
  const candidateGroupId = normalizeNullableString(candidate?.groupId);
  if (collectedGroupId && candidateGroupId && collectedGroupId === candidateGroupId) {
    score += 18;
    reasons.push('group_id');
  }

  const collectedGroupName = normalizeSpace(collectedPost?.groupName);
  const candidateGroupName = normalizeSpace(candidate?.groupName);
  if (collectedGroupName && candidateGroupName && collectedGroupName.localeCompare(candidateGroupName, undefined, { sensitivity: 'base' }) === 0) {
    score += 10;
    reasons.push('group_name');
  }

  const collectedBody = cleanPostBodyText(collectedPost?.bodyText || '');
  const candidateBody = cleanPostBodyText(candidate?.bodyText || '');
  const sharedTokens = countSharedBodyTokens(collectedBody, candidateBody);
  if (sharedTokens >= 12) {
    score += 32;
    reasons.push('body_strong_overlap');
  } else if (sharedTokens >= 6) {
    score += 18;
    reasons.push('body_partial_overlap');
  } else if (collectedBody && candidateBody && (
    candidateBody.startsWith(collectedBody)
    || collectedBody.startsWith(candidateBody)
  )) {
    score += 20;
    reasons.push('body_prefix');
  }

  const collectedPostId = normalizeNullableString(collectedPost?.postId);
  if (collectedPostId && collectedPostId === normalizeNullableString(candidate?.postId)) {
    score += 100;
    reasons.push('post_id');
  }

  const collectedPostUrl = normalizeNullableString(collectedPost?.postUrl);
  if (collectedPostUrl && collectedPostUrl === normalizeNullableString(candidate?.postUrl)) {
    score += 90;
    reasons.push('post_url');
  }

  return {
    score,
    reasons,
  };
}

export function findBestFacebookCandidateForCollectedPost(collectedPost, candidates, options = {}) {
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 30;
  const scored = (candidates || [])
    .map((candidate) => ({
      candidate,
      ...scoreCollectedPostAgainstFacebookCandidate(collectedPost, candidate),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0] || null;
  if (!best || best.score < minScore) {
    return null;
  }

  return best;
}

import {
  extractFacebookPostCandidatesFromEnvelopeItem,
  findBestFacebookCandidateForCollectedPost,
} from '../browser/facebook-post-normalizer.js';
import {
  extractFacebookPostIdFromUrl,
  normalizeFacebookPostUrl,
} from '../core/facebook-post-identity.js';
import {
  mergeCollectedPostWithNetworkData,
} from '../core/collected-post.js';

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReuseBodyText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  const items = [];
  const seen = new Set();

  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

function hasAuthorAndBodyEvidence(reasons) {
  const normalizedReasons = new Set(Array.isArray(reasons) ? reasons : []);
  const hasBodyEvidence = normalizedReasons.has('body_strong_overlap')
    || normalizedReasons.has('body_partial_overlap')
    || normalizedReasons.has('body_prefix');
  return normalizedReasons.has('author_exact') && hasBodyEvidence;
}

function candidateSupportsIdentityRecovery(candidate) {
  return Boolean(candidate?.postId || candidate?.postUrl);
}

function getCandidateExactIdentityKeys(candidate) {
  const keys = [];
  const derivedPostId = extractFacebookPostIdFromUrl(candidate?.postUrl);
  const normalizedPostUrl = normalizeFacebookPostUrl(candidate?.postUrl, {
    postId: candidate?.postId,
    groupId: candidate?.groupId,
  });

  if (candidate?.postId || derivedPostId) {
    keys.push(`post_id:${String(candidate?.postId || derivedPostId)}`);
  }

  if (normalizedPostUrl) {
    keys.push(`post_url:${normalizedPostUrl}`);
  }

  return keys;
}

function getCandidateIdentityAliases(candidate) {
  const keys = getCandidateExactIdentityKeys(candidate);

  if (candidate?.storyId) {
    keys.push(`story_id:${String(candidate.storyId)}`);
  }

  if (candidate?.feedbackId) {
    keys.push(`feedback_id:${String(candidate.feedbackId)}`);
  }

  return uniqueStrings(keys);
}

function getPostExactIdentityKeys(post) {
  const keys = [];
  const derivedPostId = extractFacebookPostIdFromUrl(post?.postUrl);
  const normalizedPostUrl = normalizeFacebookPostUrl(post?.postUrl, {
    postId: post?.postId,
    groupId: post?.groupId,
  });

  if (post?.postId || derivedPostId) {
    keys.push(`post_id:${String(post?.postId || derivedPostId)}`);
  }

  if (normalizedPostUrl) {
    keys.push(`post_url:${normalizedPostUrl}`);
  }

  return keys;
}

export function createNetworkIntegrationState(enabled = true) {
  return {
    enabled: Boolean(enabled),
    currentStepIndex: null,
    maxFuzzyCandidateStepAge: 6,
    entries: new Map(),
    identityAliases: new Map(),
    parseErrors: [],
    candidatesExtracted: 0,
    pooledCandidates: 0,
    replacedCandidates: 0,
    mergedPosts: 0,
    recoveredIdentityCount: 0,
    mergedWithExactIdentity: 0,
    fullTextMatches: 0,
    fragmentMatches: 0,
    matches: [],
  };
}

export function beginNetworkIntegrationStep(state, stepIndex) {
  if (!state?.enabled) return;
  state.currentStepIndex = stepIndex;
}

export function getNetworkCandidateKey(candidate, fallbackKey) {
  const normalizedPostUrl = normalizeFacebookPostUrl(candidate?.postUrl, {
    postId: candidate?.postId,
    groupId: candidate?.groupId,
  });
  return candidate?.postId
    || normalizedPostUrl
    || candidate?.storyId
    || candidate?.feedbackId
    || fallbackKey;
}

export function scoreNetworkCandidateRichness(candidate) {
  let score = 0;

  if (candidate?.request?.captureMode === 'full_text') score += 200;
  if (candidate?.postId) score += 120;
  if (!candidate?.partial) score += 60;
  if (candidate?.bodyText) score += 40;
  if (candidate?.postedAtTimestamp) score += 30;
  if (candidate?.postUrl) score += 15;
  if (candidate?.authorName) score += 10;
  if (candidate?.groupId) score += 5;
  if (candidate?.source?.selectedScore) score += Number(candidate.source.selectedScore) || 0;

  return score;
}

export function getResolvedDomReuseKey(post) {
  const matchParts = getResolvedDomReuseMatchParts(post);

  if (!matchParts) {
    return null;
  }

  return `${matchParts.sourceSignature}|${matchParts.authorSignature}`;
}

function getResolvedDomReuseMatchParts(post) {
  const sourceSignature = normalizeMatchText(post?.sourceKey);
  const groupIdSignature = normalizeMatchText(post?.groupId);
  const groupNameSignature = normalizeMatchText(post?.groupName);
  const authorSignature = normalizeMatchText(post?.authorName);
  const bodySignature = normalizeReuseBodyText(post?.bodyText).slice(0, 160);

  if (!authorSignature) {
    return null;
  }

  return {
    sourceSignature,
    groupIdSignature,
    groupNameSignature,
    authorSignature,
    bodySignature,
  };
}

function groupsAreCompatible(left, right) {
  if (!left || !right) return false;

  if (left.groupIdSignature && right.groupIdSignature) {
    return left.groupIdSignature === right.groupIdSignature;
  }

  if (left.groupNameSignature && right.groupNameSignature) {
    return left.groupNameSignature === right.groupNameSignature;
  }

  if ((left.groupIdSignature || left.groupNameSignature || right.groupIdSignature || right.groupNameSignature)) {
    if (left.groupNameSignature && right.groupNameSignature) {
      return left.groupNameSignature === right.groupNameSignature;
    }

    return false;
  }

  if (left.sourceSignature || right.sourceSignature) {
    return left.sourceSignature === right.sourceSignature;
  }

  return true;
}

function choosePreferredEntry(left, right) {
  if (!left) return right;
  if (!right) return left;

  return scoreNetworkCandidateRichness(right.candidate) > scoreNetworkCandidateRichness(left.candidate)
    ? right
    : left;
}

function buildEntryMatch(post, entry, minScore) {
  const bestMatch = findBestFacebookCandidateForCollectedPost(
    post,
    [entry.candidate],
    { minScore },
  );

  return bestMatch
    ? { ...bestMatch, reasons: Array.isArray(bestMatch.reasons) ? bestMatch.reasons : [] }
    : null;
}

function isNetworkEntry(entry) {
  return entry?.entryType === 'network_candidate';
}

function canUseEntryForDuplicateReuse(entry) {
  return Boolean(entry?.allowDuplicateReuse && entry?.reuseKey && entry?.reuseParts);
}

function isEntryWithinFuzzyWindow(state, entry, stepIndex = state?.currentStepIndex) {
  if (!entry?.allowFuzzyRecovery || entry.fuzzyConsumed) return false;
  if (!candidateSupportsIdentityRecovery(entry.candidate)) return false;
  if (!Number.isInteger(stepIndex) || !Number.isInteger(entry.stepIndex)) return true;

  const age = stepIndex - entry.stepIndex;
  return age >= 0 && age <= state.maxFuzzyCandidateStepAge;
}

function countPooledNetworkEntries(state) {
  let count = 0;

  for (const entry of state?.entries?.values?.() || []) {
    if (isNetworkEntry(entry)) {
      count += 1;
    }
  }

  return count;
}

function buildResolverEntry(candidate, options = {}) {
  const normalizedPostUrl = normalizeFacebookPostUrl(candidate?.postUrl, {
    postId: candidate?.postId,
    groupId: candidate?.groupId,
  });
  const fallbackKey = options.fallbackKey
    || options.entryKey
    || options.key
    || normalizedPostUrl
    || candidate?.postId
    || getResolvedDomReuseKey(candidate);

  return {
    key: fallbackKey,
    candidate,
    entryType: options.entryType || 'network_candidate',
    allowExactIdentityMatch: Boolean(options.allowExactIdentityMatch),
    allowFuzzyRecovery: Boolean(options.allowFuzzyRecovery),
    allowDuplicateReuse: Boolean(options.allowDuplicateReuse),
    fuzzyConsumed: Boolean(options.fuzzyConsumed),
    captureId: options.captureId || null,
    captureMode: options.captureMode || null,
    retentionReason: options.retentionReason || null,
    stepIndex: Number.isInteger(options.stepIndex) ? options.stepIndex : null,
    capturePhase: options.capturePhase || null,
    identityAliases: getCandidateIdentityAliases(candidate),
    exactIdentityKeys: getCandidateExactIdentityKeys(candidate),
    reuseKey: getResolvedDomReuseKey(candidate),
    reuseParts: getResolvedDomReuseMatchParts(candidate),
  };
}

function getIndexedEntryKeys(state, aliases) {
  const keys = new Set();

  for (const alias of aliases || []) {
    const key = state?.identityAliases?.get(alias);
    if (key && state.entries.has(key)) {
      keys.add(key);
    }
  }

  return Array.from(keys);
}

function choosePreferredFromEntries(entries, fallbackEntry = null) {
  let preferred = fallbackEntry;

  for (const entry of entries || []) {
    preferred = choosePreferredEntry(preferred, entry);
  }

  return preferred;
}

function indexEntryAliases(state, entry) {
  if (!isNetworkEntry(entry)) return;

  for (const alias of entry.identityAliases || []) {
    state.identityAliases.set(alias, entry.key);
  }
}

function replaceEntry(state, nextEntry, entriesToCollapse = []) {
  const collapsed = Array.isArray(entriesToCollapse) ? entriesToCollapse : [];

  for (const entry of collapsed) {
    if (entry?.key && entry.key !== nextEntry.key) {
      state.entries.delete(entry.key);
    }
  }

  state.entries.set(nextEntry.key, nextEntry);
  indexEntryAliases(state, nextEntry);
  return nextEntry;
}

function getExactIdentityEntryForPost(state, post) {
  for (const identityKey of getPostExactIdentityKeys(post)) {
    const entryKey = state?.identityAliases?.get(identityKey);
    if (!entryKey) continue;

    const entry = state.entries.get(entryKey);
    if (entry?.allowExactIdentityMatch) {
      return entry;
    }
  }

  return null;
}

function findResolvedReuseEntries(state, post) {
  const target = getResolvedDomReuseMatchParts(post);
  const reuseKey = getResolvedDomReuseKey(post);
  if (!target || !reuseKey) return [];

  return Array.from(state?.entries?.values?.() || []).filter((entry) => {
    if (!canUseEntryForDuplicateReuse(entry)) return false;
    if (entry.reuseKey !== reuseKey) return false;
    return groupsAreCompatible(target, entry.reuseParts);
  });
}

function findMatchingResolvedEntries(state, targetEntry) {
  const targetExactKeys = new Set(targetEntry.exactIdentityKeys || []);

  return Array.from(state?.entries?.values?.() || []).filter((entry) => {
    if (!canUseEntryForDuplicateReuse(entry)) return false;
    if (entry.reuseKey !== targetEntry.reuseKey) return false;
    if (!groupsAreCompatible(targetEntry.reuseParts, entry.reuseParts)) return false;
    if (entry.key === targetEntry.key) return true;
    if (!targetExactKeys.size || !entry.exactIdentityKeys?.length) return false;
    return entry.exactIdentityKeys.some((identityKey) => targetExactKeys.has(identityKey));
  });
}

function refreshConsumedNetworkEntry(state, entry, mergedPost) {
  const currentEntry = state?.entries?.get(entry?.key);
  if (!isNetworkEntry(currentEntry)) {
    return;
  }

  const mergedCandidate = choosePreferredEntry(
    currentEntry,
    buildResolverEntry(mergedPost, {
      key: currentEntry.key,
      entryType: 'network_candidate',
      allowExactIdentityMatch: true,
      allowFuzzyRecovery: candidateSupportsIdentityRecovery(mergedPost),
      captureId: currentEntry.captureId,
      captureMode: currentEntry.captureMode,
      retentionReason: currentEntry.retentionReason,
      stepIndex: currentEntry.stepIndex,
      capturePhase: currentEntry.capturePhase,
    }),
  )?.candidate || currentEntry.candidate;
  const refreshed = buildResolverEntry(mergedCandidate, {
    key: currentEntry.key,
    entryType: 'network_candidate',
    allowExactIdentityMatch: true,
    allowFuzzyRecovery: candidateSupportsIdentityRecovery(mergedCandidate),
    fuzzyConsumed: true,
    captureId: currentEntry.captureId,
    captureMode: currentEntry.captureMode,
    retentionReason: currentEntry.retentionReason,
    stepIndex: currentEntry.stepIndex,
    capturePhase: currentEntry.capturePhase,
  });

  refreshed.identityAliases = uniqueStrings([
    ...(currentEntry.identityAliases || []),
    ...getCandidateIdentityAliases(mergedPost),
  ]);
  refreshed.exactIdentityKeys = uniqueStrings([
    ...(currentEntry.exactIdentityKeys || []),
    ...getCandidateExactIdentityKeys(mergedPost),
  ]);

  replaceEntry(state, refreshed);
}

export function registerNetworkCandidate(state, candidate, options = {}) {
  if (!state?.enabled || !candidate) {
    return null;
  }

  const nextEntry = buildResolverEntry(candidate, {
    key: options.entryKey || options.key || options.fallbackKey || getNetworkCandidateKey(candidate, options.fallbackKey),
    entryType: 'network_candidate',
    allowExactIdentityMatch: true,
    allowFuzzyRecovery: candidateSupportsIdentityRecovery(candidate),
    fuzzyConsumed: false,
    captureId: options.captureId,
    captureMode: options.captureMode,
    retentionReason: options.retentionReason,
    stepIndex: options.stepIndex,
    capturePhase: options.capturePhase,
  });
  const matchingKeys = getIndexedEntryKeys(state, nextEntry.identityAliases);
  const existingEntries = matchingKeys
    .map((key) => state.entries.get(key))
    .filter(isNetworkEntry);
  const preferredEntry = choosePreferredFromEntries(existingEntries, nextEntry) || nextEntry;
  const storedEntry = {
    ...preferredEntry,
    key: existingEntries[0]?.key || nextEntry.key,
    entryType: 'network_candidate',
    allowExactIdentityMatch: true,
    allowFuzzyRecovery: candidateSupportsIdentityRecovery(preferredEntry.candidate),
    allowDuplicateReuse: false,
    fuzzyConsumed: existingEntries.some((entry) => entry.fuzzyConsumed),
    identityAliases: uniqueStrings([
      ...existingEntries.flatMap((entry) => entry.identityAliases || []),
      ...nextEntry.identityAliases,
    ]),
    exactIdentityKeys: uniqueStrings([
      ...existingEntries.flatMap((entry) => entry.exactIdentityKeys || []),
      ...nextEntry.exactIdentityKeys,
    ]),
    reuseKey: getResolvedDomReuseKey(preferredEntry.candidate),
    reuseParts: getResolvedDomReuseMatchParts(preferredEntry.candidate),
  };

  const replacedExisting = existingEntries.length
    && scoreNetworkCandidateRichness(preferredEntry.candidate) > scoreNetworkCandidateRichness(existingEntries[0].candidate);
  if (replacedExisting) {
    state.replacedCandidates += 1;
  }

  return replaceEntry(state, storedEntry, existingEntries);
}

export function registerResolvedPostForReuse(state, post, options = {}) {
  if (!state?.enabled || !post || (!post.postId && !post.postUrl)) {
    return null;
  }

  const candidate = options.candidate || post;
  const resolvedIdentityKey = options.entryKey
    || post.postId
    || normalizeFacebookPostUrl(post.postUrl, {
      postId: post.postId,
      groupId: post.groupId,
    })
    || getResolvedDomReuseKey(post);
  const entry = buildResolverEntry(candidate, {
    key: resolvedIdentityKey ? `resolved:${resolvedIdentityKey}` : null,
    entryType: 'resolved_post',
    allowExactIdentityMatch: false,
    allowFuzzyRecovery: false,
    allowDuplicateReuse: true,
    captureId: options.captureId,
    captureMode: options.captureMode || 'resolved_post',
    retentionReason: options.retentionReason,
    stepIndex: options.stepIndex,
    capturePhase: options.capturePhase,
  });

  if (!entry.reuseKey) {
    return null;
  }

  const existingEntries = findMatchingResolvedEntries(state, entry);
  const preferredEntry = choosePreferredFromEntries(existingEntries, entry) || entry;
  const storedEntry = {
    ...preferredEntry,
    key: existingEntries[0]?.key || entry.key,
    entryType: 'resolved_post',
    allowExactIdentityMatch: false,
    allowFuzzyRecovery: false,
    allowDuplicateReuse: true,
    fuzzyConsumed: false,
    identityAliases: uniqueStrings([
      ...existingEntries.flatMap((existing) => existing.identityAliases || []),
      ...entry.identityAliases,
    ]),
    exactIdentityKeys: uniqueStrings([
      ...existingEntries.flatMap((existing) => existing.exactIdentityKeys || []),
      ...entry.exactIdentityKeys,
    ]),
    reuseKey: preferredEntry.reuseKey || entry.reuseKey,
    reuseParts: preferredEntry.reuseParts || entry.reuseParts,
  };

  return replaceEntry(state, storedEntry, existingEntries);
}

export function registerNetworkCandidates(state, items, stepIndex = state?.currentStepIndex) {
  const drainedItems = Array.isArray(items) ? items : [];
  let extractedCount = 0;

  if (!state?.enabled) {
    return extractedCount;
  }

  if (Number.isInteger(stepIndex)) {
    beginNetworkIntegrationStep(state, stepIndex);
  }

  for (const item of drainedItems) {
    try {
      const candidates = extractFacebookPostCandidatesFromEnvelopeItem(item);
      extractedCount += candidates.length;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        registerNetworkCandidate(state, candidate, {
          entryKey: getNetworkCandidateKey(candidate, `${item.captureId}:${index}`),
          captureId: item.captureId,
          captureMode: item.captureMode,
          retentionReason: item.retentionReason || null,
          stepIndex: item.stepIndex,
          capturePhase: item.capturePhase,
        });
      }
    } catch (error) {
      state.parseErrors.push({
        captureId: item.captureId || null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  state.candidatesExtracted += extractedCount;
  state.pooledCandidates = countPooledNetworkEntries(state);

  return extractedCount;
}

export function matchNetworkCandidateForPost(state, post) {
  if (!state?.enabled || !post) return null;

  const exactEntry = getExactIdentityEntryForPost(state, post);
  if (exactEntry) {
    const bestMatch = buildEntryMatch(post, exactEntry, 0)
      || {
        candidate: exactEntry.candidate,
        score: 0,
        reasons: [],
      };

    return {
      entry: exactEntry,
      bestMatch,
      matchKind: 'exact_identity',
    };
  }

  if (post.postId || post.postUrl) {
    return null;
  }

  const reusedEntries = findResolvedReuseEntries(state, post);
  if (reusedEntries.length) {
    const bestMatch = findBestFacebookCandidateForCollectedPost(
      post,
      reusedEntries.map((entry) => entry.candidate),
      { minScore: 55 },
    );
    if (bestMatch) {
      const reusedEntry = reusedEntries.find((entry) => entry.candidate === bestMatch.candidate);
      if (
        reusedEntry
        && candidateSupportsIdentityRecovery(reusedEntry.candidate)
        && hasAuthorAndBodyEvidence(bestMatch.reasons)
      ) {
        return {
          entry: reusedEntry,
          bestMatch: {
            ...bestMatch,
            reasons: [...bestMatch.reasons, 'resolved_duplicate_key'],
          },
          matchKind: 'resolved_duplicate',
        };
      }
    }
  }

  const availableEntries = Array.from(state.entries.values()).filter((entry) => (
    isNetworkEntry(entry)
    && isEntryWithinFuzzyWindow(state, entry, state.currentStepIndex)
  ));
  if (!availableEntries.length) return null;

  const minScore = 55;
  const bestMatch = findBestFacebookCandidateForCollectedPost(
    post,
    availableEntries.map((entry) => entry.candidate),
    { minScore },
  );
  if (!bestMatch) return null;

  const entry = availableEntries.find((candidateEntry) => candidateEntry.candidate === bestMatch.candidate);
  if (!entry || !hasAuthorAndBodyEvidence(bestMatch.reasons)) {
    return null;
  }

  return {
    entry,
    bestMatch,
    matchKind: 'fuzzy_recovery',
  };
}

export function applyNetworkCandidateMatch(post, match, stepIndex) {
  const hadIdentity = Boolean(post.postId || post.postUrl);
  const matchReasons = Array.isArray(match.bestMatch.reasons) ? match.bestMatch.reasons : [];
  const merged = mergeCollectedPostWithNetworkData(post, match.bestMatch.candidate, {
    matchScore: match.bestMatch.score,
    matchReasons,
    matchStrategy: match.matchKind || null,
    domHadPostId: Boolean(post.postId),
    domHadPostUrl: Boolean(post.postUrl),
    identityRecovered: !hadIdentity && Boolean(match.bestMatch.candidate?.postId || match.bestMatch.candidate?.postUrl),
    matchedCaptureId: match.entry.captureId,
    matchedCaptureMode: match.entry.captureMode,
    matchedRetentionReason: match.entry.retentionReason,
    matchedStepIndex: match.entry.stepIndex,
    matchedPhase: match.entry.capturePhase,
    mergedAtStepIndex: stepIndex,
  });

  return {
    post: merged,
    recoveredIdentity: !hadIdentity && Boolean(merged.postId || merged.postUrl),
    matchSummary: {
      stepIndex,
      captureId: match.entry.captureId,
      captureMode: match.entry.captureMode,
      retentionReason: match.entry.retentionReason,
      matchScore: match.bestMatch.score,
      matchReasons,
      matchStrategy: match.matchKind || null,
      postId: merged.postId || null,
      postUrl: merged.postUrl || null,
      authorName: merged.authorName || null,
      recoveredIdentity: !hadIdentity && Boolean(merged.postId || merged.postUrl),
    },
  };
}

export function recordAcceptedNetworkMerge(state, mergeResult) {
  if (!mergeResult?.matchSummary) return;

  state.mergedPosts += 1;

  if (mergeResult.recoveredIdentity && (mergeResult.post?.postId || mergeResult.post?.postUrl)) {
    state.recoveredIdentityCount += 1;
  }

  if ((mergeResult.matchSummary.matchReasons || []).includes('post_id')
    || (mergeResult.matchSummary.matchReasons || []).includes('post_url')) {
    state.mergedWithExactIdentity += 1;
  }

  if (mergeResult.matchSummary.captureMode === 'full_text') {
    state.fullTextMatches += 1;
  } else {
    state.fragmentMatches += 1;
  }

  state.matches.push(mergeResult.matchSummary);
}

export function createWorkingSetEntry(rawPost, post, stepIndex) {
  return {
    rawPost,
    post,
    stepIndex,
    mergeResult: null,
    persisted: false,
  };
}

export function resolveWorkingSetEntry(state, entry, stepIndex) {
  if (!entry?.post || !state?.enabled) {
    return entry;
  }

  const match = matchNetworkCandidateForPost(state, entry.post);
  if (!match) {
    return entry;
  }

  const mergeResult = applyNetworkCandidateMatch(entry.post, match, stepIndex);
  if (match.matchKind === 'fuzzy_recovery' && match.entry) {
    refreshConsumedNetworkEntry(state, match.entry, mergeResult.post);
  }

  if (mergeResult.post?.postId || mergeResult.post?.postUrl) {
    registerResolvedPostForReuse(state, mergeResult.post, {
      candidate: mergeResult.post,
      captureId: match.entry.captureId,
      captureMode: match.entry.captureMode,
      retentionReason: match.entry.retentionReason,
      stepIndex: match.entry.stepIndex,
      capturePhase: match.entry.capturePhase,
      entryKey: match.entry.key,
    });
  }

  return {
    ...entry,
    post: mergeResult.post,
    mergeResult,
  };
}

export function resolveWorkingSetEntries(state, entries, stepIndex, options = {}) {
  const onlyWithoutIdentity = Boolean(options.onlyWithoutIdentity);
  const skipMatched = Boolean(options.skipMatched);
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    if (skipMatched && entry?.mergeResult) {
      return entry;
    }

    if (onlyWithoutIdentity && entry?.post && (entry.post.postId || entry.post.postUrl)) {
      return entry;
    }

    return resolveWorkingSetEntry(state, entry, stepIndex);
  });
}

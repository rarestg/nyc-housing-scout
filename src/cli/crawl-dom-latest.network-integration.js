import {
  extractFacebookPostCandidatesFromEnvelopeItem,
  findBestFacebookCandidateForCollectedPost,
} from '../browser/facebook-post-normalizer.js';
import {
  extractFacebookPostIdFromUrl,
  mergeCollectedPostWithNetworkData,
  normalizeFacebookPostUrl,
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

function getCandidateIdentityAliases(candidate) {
  const keys = getCandidateExactIdentityKeys(candidate);

  if (candidate?.storyId) {
    keys.push(`story_id:${String(candidate.storyId)}`);
  }

  if (candidate?.feedbackId) {
    keys.push(`feedback_id:${String(candidate.feedbackId)}`);
  }

  return keys;
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
    candidateEntries: new Map(),
    exactIdentityIndex: new Map(),
    fuzzyCandidateKeys: new Set(),
    consumedFuzzyIdentityKeys: new Set(),
    resolvedDomReuseIndex: new Map(),
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
  if (state.currentStepIndex === stepIndex) return;
  state.currentStepIndex = stepIndex;
  pruneFuzzyCandidateKeys(state);
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

function findResolvedReuseEntries(state, post) {
  const target = getResolvedDomReuseMatchParts(post);
  if (!target) return [];

  const bucket = state.resolvedDomReuseIndex.get(getResolvedDomReuseKey(post)) || [];
  return bucket.filter((entry) => {
    const entryParts = getResolvedDomReuseMatchParts(entry?.candidate);
    if (!entryParts) return false;
    return groupsAreCompatible(target, entryParts);
  });
}

function choosePreferredEntry(left, right) {
  if (!left) return right;
  if (!right) return left;

  return scoreNetworkCandidateRichness(right.candidate) > scoreNetworkCandidateRichness(left.candidate)
    ? right
    : left;
}

function registerExactIdentityEntry(state, entry) {
  for (const identityKey of getCandidateExactIdentityKeys(entry.candidate)) {
    const existingKey = state.exactIdentityIndex.get(identityKey);
    const existingEntry = existingKey ? state.candidateEntries.get(existingKey) : null;
    const preferred = choosePreferredEntry(existingEntry, entry);
    if (preferred) {
      state.exactIdentityIndex.set(identityKey, preferred.key);
    }
  }
}

function entryIsWithinFuzzyWindow(state, entry, stepIndex = state?.currentStepIndex) {
  if (!entry || entry.fuzzyConsumed) return false;
  if (!Number.isInteger(stepIndex) || !Number.isInteger(entry.stepIndex)) return true;

  const age = stepIndex - entry.stepIndex;
  return age >= 0 && age <= state.maxFuzzyCandidateStepAge;
}

function pruneFuzzyCandidateKeys(state) {
  const nextKeys = new Set();

  for (const key of state?.fuzzyCandidateKeys || []) {
    const entry = state.candidateEntries.get(key);
    if (entryIsWithinFuzzyWindow(state, entry, state.currentStepIndex)) {
      nextKeys.add(key);
    }
  }

  state.fuzzyCandidateKeys = nextKeys;
  pruneConsumedFuzzyCandidateKeys(state);
}

function entryMatchesConsumedFuzzyIdentity(state, entry) {
  const aliases = getCandidateIdentityAliases(entry?.candidate);
  return aliases.some((alias) => state?.consumedFuzzyIdentityKeys?.has(alias));
}

function markCandidateFuzzyIdentityConsumed(state, candidate) {
  const aliases = getCandidateIdentityAliases(candidate);
  if (!aliases.length) return;

  for (const alias of aliases) {
    state.consumedFuzzyIdentityKeys.add(alias);
  }
}

function pruneConsumedFuzzyCandidateKeys(state) {
  for (const key of Array.from(state?.fuzzyCandidateKeys || [])) {
    const entry = state.candidateEntries.get(key);
    if (!entry) {
      state.fuzzyCandidateKeys.delete(key);
      continue;
    }

    if (entryMatchesConsumedFuzzyIdentity(state, entry)) {
      entry.fuzzyConsumed = true;
      markCandidateFuzzyIdentityConsumed(state, entry.candidate);
      state.fuzzyCandidateKeys.delete(key);
    }
  }
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

function getExactIdentityEntryForPost(state, post) {
  for (const identityKey of getPostExactIdentityKeys(post)) {
    const candidateKey = state.exactIdentityIndex.get(identityKey);
    if (!candidateKey) continue;

    const entry = state.candidateEntries.get(candidateKey);
    if (entry) {
      return entry;
    }
  }

  return null;
}

export function registerResolvedPostForReuse(state, post, options = {}) {
  if (!state?.enabled || !post || (!post.postId && !post.postUrl)) {
    return;
  }

  const reuseKey = getResolvedDomReuseKey(post);
  if (!reuseKey) return;

  const entry = {
    key: options.entryKey || post.postId || normalizeFacebookPostUrl(post.postUrl, {
      postId: post.postId,
      groupId: post.groupId,
    }) || reuseKey,
    candidate: options.candidate || post,
    captureId: options.captureId || null,
    captureMode: options.captureMode || 'resolved_post',
    retentionReason: options.retentionReason || null,
    stepIndex: Number.isInteger(options.stepIndex) ? options.stepIndex : null,
    capturePhase: options.capturePhase || null,
  };
  const existingEntries = state.resolvedDomReuseIndex.get(reuseKey) || [];
  const entryIdentityKeys = getCandidateExactIdentityKeys(entry.candidate);
  const nextEntries = [];
  let replaced = false;

  for (const existing of existingEntries) {
    const existingIdentityKeys = getCandidateExactIdentityKeys(existing.candidate);
    const sharesIdentity = entryIdentityKeys.length
      && existingIdentityKeys.length
      && entryIdentityKeys.some((identityKey) => existingIdentityKeys.includes(identityKey));

    if (sharesIdentity || existing.key === entry.key) {
      nextEntries.push(choosePreferredEntry(existing, entry));
      replaced = true;
      continue;
    }
    nextEntries.push(existing);
  }

  if (!replaced) {
    nextEntries.push(entry);
  }

  state.resolvedDomReuseIndex.set(reuseKey, nextEntries);
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
        const candidateKey = getNetworkCandidateKey(candidate, `${item.captureId}:${index}`);
        const entry = {
          key: candidateKey,
          candidate,
          captureId: item.captureId,
          captureMode: item.captureMode,
          retentionReason: item.retentionReason || null,
          stepIndex: item.stepIndex,
          capturePhase: item.capturePhase,
          fuzzyConsumed: false,
        };
        if (entryMatchesConsumedFuzzyIdentity(state, entry)) {
          entry.fuzzyConsumed = true;
          markCandidateFuzzyIdentityConsumed(state, entry.candidate);
        }
        const existing = state.candidateEntries.get(candidateKey);
        const preferred = choosePreferredEntry(existing, entry);

        if (preferred === entry) {
          if (existing) {
            state.replacedCandidates += 1;
          }
          state.candidateEntries.set(candidateKey, entry);
        }

        const storedEntry = state.candidateEntries.get(candidateKey);
        if (entryMatchesConsumedFuzzyIdentity(state, storedEntry)) {
          storedEntry.fuzzyConsumed = true;
          markCandidateFuzzyIdentityConsumed(state, storedEntry.candidate);
        }
        registerExactIdentityEntry(state, storedEntry);

        if (
          storedEntry
          && candidateSupportsIdentityRecovery(storedEntry.candidate)
          && entryIsWithinFuzzyWindow(state, storedEntry, state.currentStepIndex)
        ) {
          storedEntry.fuzzyConsumed = false;
          state.fuzzyCandidateKeys.add(candidateKey);
        }
      }
    } catch (error) {
      state.parseErrors.push({
        captureId: item.captureId || null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  state.candidatesExtracted += extractedCount;
  state.pooledCandidates = state.candidateEntries.size;

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

  const availableEntries = Array.from(state.fuzzyCandidateKeys)
    .map((key) => state.candidateEntries.get(key))
    .filter((entry) => (
      entry
      && candidateSupportsIdentityRecovery(entry.candidate)
      && entryIsWithinFuzzyWindow(state, entry, state.currentStepIndex)
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
    markCandidateFuzzyIdentityConsumed(state, match.entry.candidate);
    markCandidateFuzzyIdentityConsumed(state, mergeResult.post);
    match.entry.fuzzyConsumed = true;
    state.fuzzyCandidateKeys.delete(match.entry.key);
    pruneConsumedFuzzyCandidateKeys(state);
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

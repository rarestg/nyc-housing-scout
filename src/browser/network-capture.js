function getDefaultPromisingFriendlyNamePattern() {
  return '(group|feed|story|permalink|focused|ufi|comment)';
}

function getDefaultFullTextFriendlyNamePattern() {
  return '(group|feed|story|permalink|focused)';
}

export function getDefaultNetworkCaptureOptions() {
  return {
    captureVersion: 'facebook-network-capture-v1',
    targetGroupIds: [],
    maxBufferedEnvelopes: 80,
    maxRequestChars: 4000,
    maxVariablesChars: 4000,
    maxResponsePreviewChars: 16000,
    maxFullResponseChars: 20000,
    maxHighSignalFullResponseChars: 750000,
    maxFullTextEnvelopes: 6,
    maxMatchedFragments: 6,
    maxFragmentChars: 700,
    promisingFriendlyNamePattern: getDefaultPromisingFriendlyNamePattern(),
    fullTextFriendlyNamePattern: getDefaultFullTextFriendlyNamePattern(),
  };
}

export const DEFAULT_NETWORK_CAPTURE_OPTIONS = Object.freeze(getDefaultNetworkCaptureOptions());

export function createNetworkCaptureStats(existingStats = {}, overrides = {}) {
  return {
    installCalls: Number(existingStats.installCalls || 0),
    fetchPatched: Boolean(existingStats.fetchPatched),
    xhrPatched: Boolean(existingStats.xhrPatched),
    fetchCandidates: 0,
    xhrCandidates: 0,
    responsesInspected: 0,
    captured: 0,
    skippedLowSignal: 0,
    skippedNonText: 0,
    responseReadErrors: 0,
    bufferDrops: 0,
    fullTextCaptured: 0,
    fullTextBudgetExhausted: 0,
    resetAt: null,
    ...overrides,
  };
}

export function createInstalledNetworkCaptureState(rawOptions = {}, installedAt = new Date().toISOString()) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  return {
    installed: true,
    version: options.captureVersion,
    installedAt,
    options,
    items: [],
    nextSequence: 1,
    stats: createNetworkCaptureStats({}, {
      installCalls: 1,
      resetAt: installedAt,
    }),
    originals: {},
  };
}

export function resetInstalledNetworkCaptureRunState(existing, rawOptions = {}, resetAt = new Date().toISOString()) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  if (!existing || typeof existing !== 'object') {
    return createInstalledNetworkCaptureState(options, resetAt);
  }

  existing.installed = true;
  existing.version = options.captureVersion;
  existing.options = options;
  existing.items = [];
  existing.nextSequence = 1;
  existing.stats = createNetworkCaptureStats(existing?.stats || {}, {
    installCalls: Number(existing?.stats?.installCalls || 0) + 1,
    fetchPatched: Boolean(existing?.stats?.fetchPatched),
    xhrPatched: Boolean(existing?.stats?.xhrPatched),
    resetAt,
  });
  existing.originals = existing.originals && typeof existing.originals === 'object'
    ? existing.originals
    : {};

  return existing;
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function uniqueValues(values) {
  const seen = new Set();
  const items = [];

  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }

  return items;
}

function normalizeIdArray(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return uniqueValues(raw.filter((item) => /^\d{8,}$/.test(String(item || '').trim())));
}

export function normalizeNetworkCaptureOptions(input = {}) {
  const defaults = getDefaultNetworkCaptureOptions();
  return {
    captureVersion: String(input.captureVersion || defaults.captureVersion),
    targetGroupIds: normalizeIdArray(input.targetGroupIds || defaults.targetGroupIds),
    maxBufferedEnvelopes: clampInteger(input.maxBufferedEnvelopes, defaults.maxBufferedEnvelopes, 10, 500),
    maxRequestChars: clampInteger(input.maxRequestChars, defaults.maxRequestChars, 200, 20000),
    maxVariablesChars: clampInteger(input.maxVariablesChars, defaults.maxVariablesChars, 200, 20000),
    maxResponsePreviewChars: clampInteger(input.maxResponsePreviewChars, defaults.maxResponsePreviewChars, 1000, 120000),
    maxFullResponseChars: clampInteger(input.maxFullResponseChars, defaults.maxFullResponseChars, 1000, 120000),
    maxHighSignalFullResponseChars: clampInteger(
      input.maxHighSignalFullResponseChars,
      defaults.maxHighSignalFullResponseChars,
      defaults.maxFullResponseChars,
      1000000,
    ),
    maxFullTextEnvelopes: clampInteger(input.maxFullTextEnvelopes, defaults.maxFullTextEnvelopes, 1, 20),
    maxMatchedFragments: clampInteger(input.maxMatchedFragments, defaults.maxMatchedFragments, 1, 20),
    maxFragmentChars: clampInteger(input.maxFragmentChars, defaults.maxFragmentChars, 100, 2000),
    promisingFriendlyNamePattern: String(input.promisingFriendlyNamePattern || defaults.promisingFriendlyNamePattern),
    fullTextFriendlyNamePattern: String(input.fullTextFriendlyNamePattern || defaults.fullTextFriendlyNamePattern),
  };
}

export function truncateText(value, limit) {
  const text = String(value || '');
  if (!text) return '';

  const maxChars = clampInteger(limit, 1000, 1, 500000);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function addPatternMatches(target, text, regex, valueIndex = 1) {
  const sourceText = String(text || '');
  if (!sourceText) return;

  let match = regex.exec(sourceText);
  while (match) {
    const value = String(match[valueIndex] || '').trim();
    if (/^\d{8,}$/.test(value) && !target.includes(value)) {
      target.push(value);
    }

    if (regex.lastIndex <= match.index) {
      regex.lastIndex = match.index + 1;
    }
    match = regex.exec(sourceText);
  }
}

export function collectFacebookNumericHints(value) {
  const text = String(value || '');
  const groupIds = [];
  const postIds = [];
  const storyIds = [];
  const feedbackIds = [];

  addPatternMatches(groupIds, text, /\/groups\/(\d{8,})/gi);
  addPatternMatches(groupIds, text, /(?:group(?:ID|Id|_id)|group_id)["']?\s*[:=]\s*["']?(\d{8,})/gi);

  addPatternMatches(postIds, text, /\/posts\/(\d{8,})/gi);
  addPatternMatches(postIds, text, /(?:post_id|postId)["']?\s*[:=]\s*["']?(\d{8,})/gi);
  addPatternMatches(postIds, text, /\b(?:post|group_post):(\d{8,})\b/gi);

  addPatternMatches(storyIds, text, /(?:story_id|storyId|story_fbid)["']?\s*[:=]\s*["']?(\d{8,})/gi);
  addPatternMatches(storyIds, text, /\bstory:(\d{8,})\b/gi);

  addPatternMatches(feedbackIds, text, /(?:feedback(?:_id)?|feedback_id)["']?\s*[:=]\s*["']?(\d{8,})/gi);
  addPatternMatches(feedbackIds, text, /\bfeedback:(\d{8,})\b/gi);

  return {
    groupIds,
    postIds,
    storyIds,
    feedbackIds,
  };
}

function readObjectField(record, keys) {
  if (!record || typeof record !== 'object') return null;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    return value;
  }

  return null;
}

export function parseFacebookGraphQlRequest(bodyText, contentType) {
  const normalizedContentType = String(contentType || '').toLowerCase();
  let text = '';

  if (typeof bodyText === 'string') {
    text = bodyText;
  } else if (bodyText === null || bodyText === undefined) {
    text = '';
  } else if (typeof URLSearchParams !== 'undefined' && bodyText instanceof URLSearchParams) {
    text = bodyText.toString();
  } else if (typeof FormData !== 'undefined' && bodyText instanceof FormData) {
    text = Array.from(bodyText.entries())
      .map(([key, value]) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`)
      .join('&');
  } else if (typeof bodyText === 'object') {
    try {
      text = JSON.stringify(bodyText);
    } catch {
      text = String(bodyText);
    }
  } else {
    text = String(bodyText);
  }

  const trimmed = text.trim();
  let parseMode = 'raw';
  let fbApiReqFriendlyName = null;
  let docId = null;
  let variablesText = null;
  let actorId = null;

  if (trimmed && (
    normalizedContentType.includes('application/x-www-form-urlencoded')
    || /(?:^|&)fb_api_req_friendly_name=/.test(trimmed)
    || /(?:^|&)doc_id=/.test(trimmed)
  )) {
    const params = new URLSearchParams(trimmed);
    parseMode = 'form';
    fbApiReqFriendlyName = params.get('fb_api_req_friendly_name');
    docId = params.get('doc_id');
    variablesText = params.get('variables');
    actorId = params.get('av');
  } else if (trimmed && (normalizedContentType.includes('application/json') || /^[\[{]/.test(trimmed))) {
    try {
      const parsed = JSON.parse(trimmed);
      parseMode = 'json';
      fbApiReqFriendlyName = readObjectField(parsed, ['fb_api_req_friendly_name', 'fbApiReqFriendlyName']);
      docId = readObjectField(parsed, ['doc_id', 'docId']);
      const variables = readObjectField(parsed, ['variables']);
      variablesText = typeof variables === 'string'
        ? variables
        : variables !== null && variables !== undefined
          ? JSON.stringify(variables)
          : null;
      actorId = readObjectField(parsed, ['av']);
    } catch {
      parseMode = 'raw';
    }
  }

  return {
    bodyText: text,
    bodyLength: text.length,
    parseMode,
    fbApiReqFriendlyName: fbApiReqFriendlyName ? String(fbApiReqFriendlyName) : null,
    docId: docId ? String(docId) : null,
    variablesText: variablesText ? String(variablesText) : null,
    actorId: actorId ? String(actorId) : null,
  };
}

export function analyzeFacebookGraphQlRequest(input, rawOptions = {}) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  const method = String(input?.method || 'GET').toUpperCase();
  const url = String(input?.url || '');
  const requestContentType = String(input?.requestContentType || '').trim() || null;

  if (!/\/api\/graphql(?:\/|$|\?)/i.test(url)) {
    return {
      url,
      method,
      requestContentType,
      shouldInspectResponse: false,
      strongSignal: false,
      skipReason: 'non_graphql_url',
      signalReasons: [],
      requestHints: {
        groupIds: [],
        postIds: [],
        storyIds: [],
        feedbackIds: [],
      },
      hasTargetGroupId: false,
      promisingFriendlyName: false,
      fbApiReqFriendlyName: null,
      docId: null,
      actorId: null,
      requestBodyParseMode: 'raw',
      requestTextFragment: '',
      variablesTextFragment: '',
    };
  }

  const parsedRequest = parseFacebookGraphQlRequest(input?.requestBodyText, requestContentType);
  const requestHintSource = [url, parsedRequest.bodyText, parsedRequest.variablesText].filter(Boolean).join('\n');
  const requestHints = collectFacebookNumericHints(requestHintSource);
  const promisingFriendlyNamePattern = new RegExp(options.promisingFriendlyNamePattern, 'i');
  const promisingFriendlyName = Boolean(
    parsedRequest.fbApiReqFriendlyName && promisingFriendlyNamePattern.test(parsedRequest.fbApiReqFriendlyName),
  );
  const hasTargetGroupId = options.targetGroupIds.some((groupId) => requestHints.groupIds.includes(groupId));
  const signalReasons = [];

  if (promisingFriendlyName) signalReasons.push('promising_friendly_name');
  if (requestHints.groupIds.length) signalReasons.push('request_group_id');
  if (requestHints.postIds.length) signalReasons.push('request_post_id');
  if (requestHints.storyIds.length) signalReasons.push('request_story_id');
  if (requestHints.feedbackIds.length) signalReasons.push('request_feedback_id');
  if (hasTargetGroupId) signalReasons.push('target_group_id');
  if (parsedRequest.docId && (promisingFriendlyName || requestHints.groupIds.length || requestHints.postIds.length || requestHints.storyIds.length || requestHints.feedbackIds.length)) {
    signalReasons.push('doc_id');
  }

  return {
    url,
    method,
    requestContentType,
    shouldInspectResponse: signalReasons.length > 0,
    strongSignal: Boolean(
      hasTargetGroupId
      || requestHints.postIds.length
      || requestHints.storyIds.length
      || requestHints.feedbackIds.length
    ),
    skipReason: signalReasons.length ? null : 'low_signal_request',
    signalReasons,
    requestHints,
    hasTargetGroupId,
    promisingFriendlyName,
    fbApiReqFriendlyName: parsedRequest.fbApiReqFriendlyName,
    docId: parsedRequest.docId,
    actorId: parsedRequest.actorId,
    requestBodyParseMode: parsedRequest.parseMode,
    requestTextFragment: truncateText(parsedRequest.bodyText, options.maxRequestChars),
    variablesTextFragment: truncateText(parsedRequest.variablesText, options.maxVariablesChars),
  };
}

function pushUniqueFragment(fragments, seen, label, text, options) {
  const value = truncateText(text, options.maxFragmentChars).trim();
  if (!value) return;

  const key = `${label}:${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  fragments.push({ label, text: value });
}

function captureAroundToken(fragments, seen, responseText, label, token, options) {
  if (!token) return;

  let startIndex = responseText.indexOf(token);
  while (startIndex !== -1 && fragments.length < options.maxMatchedFragments) {
    const fragmentStart = Math.max(0, startIndex - 160);
    const fragmentEnd = Math.min(responseText.length, startIndex + token.length + 240);
    pushUniqueFragment(fragments, seen, label, responseText.slice(fragmentStart, fragmentEnd), options);
    startIndex = responseText.indexOf(token, startIndex + token.length);
  }
}

export function extractMatchedTextFragments(responseText, combinedHints, rawOptions = {}) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  const sourceText = String(responseText || '');
  const fragments = [];
  const seen = new Set();

  const tokenGroups = [
    ['group_id', combinedHints?.groupIds || []],
    ['post_id', combinedHints?.postIds || []],
    ['story_id', combinedHints?.storyIds || []],
    ['feedback_id', combinedHints?.feedbackIds || []],
  ];

  for (const [label, tokens] of tokenGroups) {
    for (const token of tokens) {
      captureAroundToken(fragments, seen, sourceText, label, token, options);
      if (fragments.length >= options.maxMatchedFragments) {
        return fragments.slice(0, options.maxMatchedFragments);
      }
    }
  }

  const keywordPattern = /(?:group(?:ID|Id|_id)|group_id|post_id|story_id|story_fbid|feedback|\/posts\/)/gi;
  let match = keywordPattern.exec(sourceText);
  while (match && fragments.length < options.maxMatchedFragments) {
    const token = String(match[0] || '');
    const startIndex = Math.max(0, match.index - 160);
    const endIndex = Math.min(sourceText.length, match.index + token.length + 240);
    pushUniqueFragment(fragments, seen, 'keyword', sourceText.slice(startIndex, endIndex), options);

    if (keywordPattern.lastIndex <= match.index) {
      keywordPattern.lastIndex = match.index + 1;
    }
    match = keywordPattern.exec(sourceText);
  }

  return fragments.slice(0, options.maxMatchedFragments);
}

export function buildFacebookNetworkCaptureEnvelope(input, rawOptions = {}) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  const requestAnalysis = input?.requestAnalysis || analyzeFacebookGraphQlRequest(input, options);
  if (!requestAnalysis.shouldInspectResponse) return null;

  const responseText = String(input?.responseText || '');
  const responseHints = collectFacebookNumericHints(responseText);
  const combinedHints = {
    groupIds: uniqueValues([...(requestAnalysis.requestHints.groupIds || []), ...(responseHints.groupIds || [])]),
    postIds: uniqueValues([...(requestAnalysis.requestHints.postIds || []), ...(responseHints.postIds || [])]),
    storyIds: uniqueValues([...(requestAnalysis.requestHints.storyIds || []), ...(responseHints.storyIds || [])]),
    feedbackIds: uniqueValues([...(requestAnalysis.requestHints.feedbackIds || []), ...(responseHints.feedbackIds || [])]),
  };
  const hasTargetGroupId = options.targetGroupIds.some((groupId) => combinedHints.groupIds.includes(groupId));
  const responseSignalReasons = [];

  if (responseHints.groupIds.length) responseSignalReasons.push('response_group_id');
  if (responseHints.postIds.length) responseSignalReasons.push('response_post_id');
  if (responseHints.storyIds.length) responseSignalReasons.push('response_story_id');
  if (responseHints.feedbackIds.length) responseSignalReasons.push('response_feedback_id');
  if (hasTargetGroupId) responseSignalReasons.push('target_group_id');

  const shouldCapture = Boolean(
    requestAnalysis.strongSignal
    || hasTargetGroupId
    || responseHints.postIds.length
    || responseHints.storyIds.length
    || responseHints.feedbackIds.length
    || (requestAnalysis.promisingFriendlyName && responseHints.groupIds.length)
  );
  if (!shouldCapture) return null;

  const matchedFragments = extractMatchedTextFragments(responseText, combinedHints, options);
  const fullTextFriendlyNamePattern = new RegExp(options.fullTextFriendlyNamePattern, 'i');
  const prefersFullText = Boolean(
    requestAnalysis.fbApiReqFriendlyName
    && fullTextFriendlyNamePattern.test(requestAnalysis.fbApiReqFriendlyName)
    && (
      hasTargetGroupId
      || responseHints.postIds.length
      || responseHints.storyIds.length
      || responseHints.feedbackIds.length
    )
  );
  const fullTextLimit = prefersFullText
    ? options.maxHighSignalFullResponseChars
    : options.maxFullResponseChars;
  const captureMode = responseText.length <= fullTextLimit
    ? 'full_text'
    : matchedFragments.length
      ? 'matched_fragments'
      : 'response_head';
  const retentionReason = captureMode === 'full_text'
    ? prefersFullText && responseText.length > options.maxFullResponseChars
      ? 'high_signal_full_text'
      : 'small_response_full_text'
    : matchedFragments.length
      ? 'matched_fragments'
      : 'response_head';
  const capturedText = captureMode === 'full_text'
    ? truncateText(responseText, fullTextLimit)
    : matchedFragments.length
      ? truncateText(matchedFragments.map((fragment) => fragment.text).join('\n---\n'), options.maxResponsePreviewChars)
      : truncateText(responseText, options.maxResponsePreviewChars);

  return {
    captureVersion: options.captureVersion,
    sourceTransport: String(input?.sourceTransport || 'unknown'),
    url: requestAnalysis.url,
    method: requestAnalysis.method,
    requestTimestamp: input?.requestTimestamp || null,
    responseTimestamp: input?.responseTimestamp || null,
    status: Number.isFinite(input?.status) ? input.status : null,
    ok: typeof input?.ok === 'boolean' ? input.ok : null,
    requestContentType: requestAnalysis.requestContentType,
    responseContentType: String(input?.responseContentType || '').trim() || null,
    fbApiReqFriendlyName: requestAnalysis.fbApiReqFriendlyName,
    docId: requestAnalysis.docId,
    actorId: requestAnalysis.actorId,
    requestBodyParseMode: requestAnalysis.requestBodyParseMode,
    requestTextFragment: requestAnalysis.requestTextFragment,
    variablesTextFragment: requestAnalysis.variablesTextFragment,
    captureMode,
    retentionReason,
    capturedText,
    matchedFragments,
    responseBodyLength: responseText.length,
    responseTextTruncated: captureMode !== 'full_text' || responseText.length > fullTextLimit,
    matchHints: {
      hasTargetGroupId,
      requestSignalReasons: requestAnalysis.signalReasons,
      responseSignalReasons,
      requestGroupIds: requestAnalysis.requestHints.groupIds,
      responseGroupIds: responseHints.groupIds,
      groupIds: combinedHints.groupIds,
      postIds: combinedHints.postIds,
      storyIds: combinedHints.storyIds,
      feedbackIds: combinedHints.feedbackIds,
    },
  };
}

function downgradeFullTextEnvelopeForBudget(envelope, rawOptions = {}) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  if (!envelope || envelope.captureMode !== 'full_text') {
    return envelope;
  }

  const matchedFragments = Array.isArray(envelope.matchedFragments)
    ? envelope.matchedFragments
    : [];
  const downgradedMode = matchedFragments.length ? 'matched_fragments' : 'response_head';
  const capturedText = matchedFragments.length
    ? truncateText(matchedFragments.map((fragment) => fragment.text).join('\n---\n'), options.maxResponsePreviewChars)
    : truncateText(envelope.capturedText, options.maxResponsePreviewChars);

  return {
    ...envelope,
    captureMode: downgradedMode,
    retentionReason: 'full_text_budget_exhausted',
    capturedText,
    responseTextTruncated: true,
  };
}

export function storeNetworkCaptureEnvelope(state, envelope, rawOptions = {}) {
  if (!state || !envelope) return null;

  const hasExplicitOptions = Boolean(
    rawOptions
    && typeof rawOptions === 'object'
    && Object.keys(rawOptions).length > 0
  );
  const options = normalizeNetworkCaptureOptions(hasExplicitOptions ? rawOptions : (state.options || {}));
  state.options = options;
  state.items = Array.isArray(state.items) ? state.items : [];
  state.nextSequence = Number.isInteger(state.nextSequence) && state.nextSequence > 0 ? state.nextSequence : 1;
  if (!state.stats || typeof state.stats !== 'object') {
    state.stats = createNetworkCaptureStats({}, {
      installCalls: 0,
      fetchPatched: false,
      xhrPatched: false,
      resetAt: null,
    });
  }

  let storedEnvelope = envelope;
  if (
    storedEnvelope.captureMode === 'full_text'
    && state.stats.fullTextCaptured >= options.maxFullTextEnvelopes
  ) {
    storedEnvelope = downgradeFullTextEnvelopeForBudget(storedEnvelope, options);
    state.stats.fullTextBudgetExhausted += 1;
  }

  if (storedEnvelope.captureMode === 'full_text') {
    state.stats.fullTextCaptured += 1;
  }

  const storedItem = {
    captureId: `netcap_${String(state.nextSequence).padStart(4, '0')}`,
    ...storedEnvelope,
  };
  state.items.push(storedItem);
  state.nextSequence += 1;
  state.stats.captured += 1;

  while (state.items.length > options.maxBufferedEnvelopes) {
    state.items.shift();
    state.stats.bufferDrops += 1;
  }

  return storedItem;
}

function toTopEntries(counter, limit = 10) {
  return Object.entries(counter)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export function summarizeFacebookNetworkCapture(items, limit = 10) {
  const envelopes = Array.isArray(items) ? items : [];
  const byTransport = {};
  const byCaptureMode = {};
  const byRetentionReason = {};
  const byFriendlyName = {};
  const byDocId = {};
  let withTargetGroupId = 0;
  let withPostIds = 0;
  let withStoryIds = 0;
  let withFeedbackIds = 0;

  for (const item of envelopes) {
    const transport = String(item?.sourceTransport || 'unknown');
    byTransport[transport] = (byTransport[transport] || 0) + 1;

    const captureMode = String(item?.captureMode || 'unknown');
    byCaptureMode[captureMode] = (byCaptureMode[captureMode] || 0) + 1;

    const retentionReason = String(item?.retentionReason || 'unknown');
    byRetentionReason[retentionReason] = (byRetentionReason[retentionReason] || 0) + 1;

    if (item?.fbApiReqFriendlyName) {
      byFriendlyName[item.fbApiReqFriendlyName] = (byFriendlyName[item.fbApiReqFriendlyName] || 0) + 1;
    }

    if (item?.docId) {
      byDocId[item.docId] = (byDocId[item.docId] || 0) + 1;
    }

    if (item?.matchHints?.hasTargetGroupId) withTargetGroupId += 1;
    if ((item?.matchHints?.postIds || []).length) withPostIds += 1;
    if ((item?.matchHints?.storyIds || []).length) withStoryIds += 1;
    if ((item?.matchHints?.feedbackIds || []).length) withFeedbackIds += 1;
  }

  return {
    capturedCount: envelopes.length,
    withTargetGroupId,
    withPostIds,
    withStoryIds,
    withFeedbackIds,
    byTransport,
    byCaptureMode,
    byRetentionReason,
    topFriendlyNames: toTopEntries(byFriendlyName, limit),
    topDocIds: toTopEntries(byDocId, limit),
  };
}

function buildBrowserPrelude() {
  const helpers = [
    getDefaultPromisingFriendlyNamePattern,
    getDefaultFullTextFriendlyNamePattern,
    getDefaultNetworkCaptureOptions,
    createNetworkCaptureStats,
    createInstalledNetworkCaptureState,
    resetInstalledNetworkCaptureRunState,
    clampInteger,
    uniqueValues,
    normalizeIdArray,
    normalizeNetworkCaptureOptions,
    truncateText,
    addPatternMatches,
    collectFacebookNumericHints,
    readObjectField,
    parseFacebookGraphQlRequest,
    analyzeFacebookGraphQlRequest,
    pushUniqueFragment,
    captureAroundToken,
    extractMatchedTextFragments,
    buildFacebookNetworkCaptureEnvelope,
    downgradeFullTextEnvelopeForBudget,
    storeNetworkCaptureEnvelope,
  ];

  return helpers.map((fn) => fn.toString()).join('\n');
}

function NETWORK_CAPTURE_INSTALL_RUNTIME(rawOptions) {
  const options = normalizeNetworkCaptureOptions(rawOptions);
  const captureKey = '__NYC_HOUSING_SCOUT_NETWORK_CAPTURE__';
  const scope = globalThis;
  const existing = scope[captureKey];

  if (existing?.installed) {
    const resetState = resetInstalledNetworkCaptureRunState(existing, options, new Date().toISOString());
    scope[captureKey] = resetState;
    return {
      installed: true,
      reinstalled: true,
      version: resetState.version,
      installedAt: resetState.installedAt,
      options: resetState.options,
      stats: resetState.stats,
    };
  }

  const state = createInstalledNetworkCaptureState(options, new Date().toISOString());

  function copyHeaders(headers) {
    const record = {};
    if (!headers) return record;

    if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => {
        record[String(key).toLowerCase()] = String(value);
      });
      return record;
    }

    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        record[String(entry[0]).toLowerCase()] = String(entry[1]);
      }
      return record;
    }

    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        record[String(key).toLowerCase()] = String(value);
      }
    }

    return record;
  }

  function readBodyText(body) {
    if (typeof body === 'string') return Promise.resolve(body);
    if (body === null || body === undefined) return Promise.resolve('');
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return Promise.resolve(body.toString());
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return Promise.resolve(Array.from(body.entries())
        .map(([key, value]) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`)
        .join('&'));
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob && typeof body.text === 'function') {
      return body.text().catch(() => '');
    }
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return Promise.resolve('');
    if (typeof body === 'object') {
      try {
        return Promise.resolve(JSON.stringify(body));
      } catch {
        return Promise.resolve(String(body));
      }
    }
    return Promise.resolve(String(body));
  }

  function looksTextualContentType(contentType) {
    if (!contentType) return true;
    return /(json|text|javascript|graphql)/i.test(String(contentType));
  }

  function toAbsoluteUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return raw;

    try {
      return new URL(raw, location.href).href;
    } catch {
      return raw;
    }
  }

  function storeEnvelope(envelope) {
    storeNetworkCaptureEnvelope(state, envelope, state.options);
  }

  if (typeof scope.fetch === 'function') {
    const originalFetch = scope.fetch.bind(scope);
    state.originals.fetch = originalFetch;
    scope.fetch = function patchedFetch(input, init) {
      const requestTimestamp = new Date().toISOString();
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = toAbsoluteUrl(typeof input === 'string'
        ? input
        : typeof input?.url === 'string'
          ? input.url
          : '');
      const headers = {
        ...copyHeaders(input?.headers),
        ...copyHeaders(init?.headers),
      };
      const requestContentType = headers['content-type'] || null;
      const requestBodyPromise = init?.body !== undefined
        ? readBodyText(init.body)
        : typeof input?.clone === 'function' && !input?.bodyUsed
          ? input.clone().text().catch(() => '')
          : Promise.resolve('');

      return originalFetch(input, init).then((response) => {
        Promise.resolve(requestBodyPromise)
          .then((requestBodyText) => {
            const requestAnalysis = analyzeFacebookGraphQlRequest({
              url,
              method,
              requestContentType,
              requestBodyText,
            }, state.options);

            if (!requestAnalysis.shouldInspectResponse) {
              state.stats.skippedLowSignal += 1;
              return;
            }

            state.stats.fetchCandidates += 1;
            const responseContentType = response?.headers?.get?.('content-type') || null;
            if (!looksTextualContentType(responseContentType)) {
              state.stats.skippedNonText += 1;
              return;
            }

            state.stats.responsesInspected += 1;
            return response.clone().text()
              .then((responseText) => {
                const envelope = buildFacebookNetworkCaptureEnvelope({
                  sourceTransport: 'fetch',
                  requestTimestamp,
                  responseTimestamp: new Date().toISOString(),
                  status: response?.status,
                  ok: response?.ok,
                  responseContentType,
                  responseText,
                  requestAnalysis,
                }, state.options);
                storeEnvelope(envelope);
              })
              .catch(() => {
                state.stats.responseReadErrors += 1;
              });
          })
          .catch(() => {
            state.stats.responseReadErrors += 1;
          });

        return response;
      });
    };
    state.stats.fetchPatched = true;
  }

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest?.prototype) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;
    state.originals.xhrOpen = originalOpen;
    state.originals.xhrSetRequestHeader = originalSetRequestHeader;
    state.originals.xhrSend = originalSend;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__nycHousingScoutCapture = {
        method: String(method || 'GET').toUpperCase(),
        url: toAbsoluteUrl(url),
        headers: {},
      };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
      if (this.__nycHousingScoutCapture) {
        this.__nycHousingScoutCapture.headers[String(name || '').toLowerCase()] = String(value);
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const capture = this.__nycHousingScoutCapture || { method: 'GET', url: '', headers: {} };
      capture.requestTimestamp = new Date().toISOString();

      readBodyText(body)
        .then((requestBodyText) => {
          capture.requestBodyText = requestBodyText;
          capture.requestAnalysis = analyzeFacebookGraphQlRequest({
            url: capture.url,
            method: capture.method,
            requestContentType: capture.headers['content-type'] || null,
            requestBodyText,
          }, state.options);

          if (!capture.requestAnalysis.shouldInspectResponse) {
            state.stats.skippedLowSignal += 1;
            return;
          }

          state.stats.xhrCandidates += 1;
          this.addEventListener('loadend', () => {
            const responseContentType = this.getResponseHeader?.('content-type') || null;
            if (!looksTextualContentType(responseContentType)) {
              state.stats.skippedNonText += 1;
              return;
            }

            state.stats.responsesInspected += 1;
            let responseText = '';

            try {
              if (typeof this.responseText === 'string') {
                responseText = this.responseText;
              } else if (typeof this.response === 'string') {
                responseText = this.response;
              } else if (this.response && typeof this.response === 'object') {
                responseText = JSON.stringify(this.response);
              }
            } catch {
              state.stats.responseReadErrors += 1;
              return;
            }

            const envelope = buildFacebookNetworkCaptureEnvelope({
              sourceTransport: 'xhr',
              requestTimestamp: capture.requestTimestamp,
              responseTimestamp: new Date().toISOString(),
              status: Number(this.status),
              ok: Number(this.status) >= 200 && Number(this.status) < 300,
              responseContentType,
              responseText,
              requestAnalysis: capture.requestAnalysis,
            }, state.options);
            storeEnvelope(envelope);
          }, { once: true });
        })
        .catch(() => {
          state.stats.responseReadErrors += 1;
        });

      return originalSend.apply(this, arguments);
    };

    state.stats.xhrPatched = true;
  }

  scope[captureKey] = state;
  return {
    installed: true,
    reinstalled: false,
    version: state.version,
    installedAt: state.installedAt,
    options: state.options,
    stats: state.stats,
  };
}

function NETWORK_CAPTURE_DRAIN_RUNTIME(input) {
  const captureKey = '__NYC_HOUSING_SCOUT_NETWORK_CAPTURE__';
  const state = globalThis[captureKey];
  if (!state?.installed) {
    return {
      installed: false,
      items: [],
      remaining: 0,
      stats: null,
    };
  }

  const maxItems = clampInteger(input?.maxItems, state.items.length || 1, 1, 1000);
  const clear = input?.clear !== false;
  const items = state.items.slice(0, maxItems);

  if (clear) {
    state.items = state.items.slice(items.length);
  }

  return {
    installed: true,
    version: state.version,
    installedAt: state.installedAt,
    options: state.options,
    stats: state.stats,
    items,
    remaining: state.items.length,
  };
}

export function createFacebookNetworkCaptureInstallFn(input = {}) {
  const options = normalizeNetworkCaptureOptions(input);
  return `() => {\n${buildBrowserPrelude()}\nreturn (${NETWORK_CAPTURE_INSTALL_RUNTIME.toString()})(${JSON.stringify(options)});\n}`;
}

export function createFacebookNetworkCaptureDrainFn(input = {}) {
  const args = {
    clear: input?.clear !== false,
    maxItems: clampInteger(input?.maxItems, DEFAULT_NETWORK_CAPTURE_OPTIONS.maxBufferedEnvelopes, 1, 1000),
  };

  return `() => {\n${clampInteger.toString()}\nreturn (${NETWORK_CAPTURE_DRAIN_RUNTIME.toString()})(${JSON.stringify(args)});\n}`;
}

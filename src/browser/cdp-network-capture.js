import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import {
  analyzeFacebookGraphQlRequest,
  buildFacebookNetworkCaptureEnvelope,
  createInstalledNetworkCaptureState,
  normalizeNetworkCaptureOptions,
  storeNetworkCaptureEnvelope,
} from './network-capture.js';
import {
  getBrowserStatus,
  getBrowserTabs,
} from '../core/browser-pipeline.js';

const RELAY_AUTH_HEADER = 'x-openclaw-relay-token';
const RELAY_AUTH_SCOPE = 'openclaw-extension-relay-v1';

function toIsoTimestamp(value, multiplier = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  try {
    return new Date(numeric * multiplier).toISOString();
  } catch {
    return null;
  }
}

function getRequestMapKey(sessionId, requestId) {
  return `${String(sessionId || '')}:${String(requestId || '')}`;
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key || '').toLowerCase() !== target) continue;
    return value === null || value === undefined || value === ''
      ? null
      : String(value);
  }

  return null;
}

function looksTextualContentType(contentType) {
  if (!contentType) return true;
  return /(json|text|javascript|graphql|form-urlencoded)/i.test(String(contentType));
}

function applyHeaderFallbackToRequestAnalysis(requestAnalysis, headers, options) {
  const friendlyNameHeader = getHeaderValue(headers, 'x-fb-friendly-name');
  if (!friendlyNameHeader || requestAnalysis?.fbApiReqFriendlyName) {
    return requestAnalysis;
  }

  const promisingFriendlyName = new RegExp(options.promisingFriendlyNamePattern, 'i').test(friendlyNameHeader);
  const signalReasons = Array.isArray(requestAnalysis?.signalReasons)
    ? [...requestAnalysis.signalReasons]
    : [];
  if (promisingFriendlyName && !signalReasons.includes('promising_friendly_name')) {
    signalReasons.push('promising_friendly_name');
  }

  return {
    ...requestAnalysis,
    fbApiReqFriendlyName: friendlyNameHeader,
    promisingFriendlyName,
    signalReasons,
    shouldInspectResponse: signalReasons.length > 0,
  };
}

function normalizePotentialBase64Text(value) {
  const text = String(value || '');
  if (!text) return '';
  if (!/^[A-Za-z0-9+/=]+$/.test(text) || text.length % 4 !== 0) {
    return text;
  }

  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    return /(?:fb_api_req_friendly_name|doc_id|variables=|^\{|\[)/.test(decoded) ? decoded : text;
  } catch {
    return text;
  }
}

function readRequestPostData(request) {
  if (!request || typeof request !== 'object') {
    return '';
  }

  if (typeof request.postData === 'string') {
    return request.postData;
  }

  if (Array.isArray(request.postDataEntries) && request.postDataEntries.length) {
    return request.postDataEntries
      .map((entry) => normalizePotentialBase64Text(entry?.bytes))
      .join('');
  }

  return '';
}

function decodeResponseBody(result) {
  const bodyText = String(result?.body || '');
  if (!result?.base64Encoded) {
    return bodyText;
  }

  try {
    return Buffer.from(bodyText, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function chooseTargetTab(tabs, targetId, preferredUrl) {
  const pageTabs = (Array.isArray(tabs) ? tabs : []).filter((tab) => tab?.type === 'page');
  if (!pageTabs.length) {
    throw new Error('no attached page tabs available for CDP capture');
  }

  if (targetId) {
    const exact = pageTabs.find((tab) => String(tab.targetId || '') === String(targetId));
    if (exact) {
      return exact;
    }
  }

  if (preferredUrl) {
    const normalizedPreferred = String(preferredUrl || '').trim();
    const byUrl = pageTabs.find((tab) => String(tab.url || '').trim() === normalizedPreferred)
      || pageTabs.find((tab) => String(tab.url || '').includes(normalizedPreferred));
    if (byUrl) {
      return byUrl;
    }
  }

  return pageTabs[0];
}

function readOpenClawConfig(configPath) {
  const resolvedPath = configPath || path.join(os.homedir(), '.openclaw', 'openclaw.json');
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

export function resolveOpenClawGatewayToken(configPath) {
  const envToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
  if (envToken) {
    return envToken;
  }

  const config = readOpenClawConfig(configPath);
  const token = config?.gateway?.auth?.token;
  if (!token) {
    throw new Error('OpenClaw gateway.auth.token is not configured');
  }

  return String(token).trim();
}

export function deriveOpenClawRelayAuthToken(gatewayToken, port) {
  const token = String(gatewayToken || '').trim();
  const numericPort = Number.parseInt(String(port || ''), 10);

  if (!token) {
    throw new Error('gateway token is required to derive the OpenClaw relay auth token');
  }

  if (!Number.isFinite(numericPort) || numericPort <= 0) {
    throw new Error(`invalid OpenClaw relay port: ${port}`);
  }

  return createHmac('sha256', token)
    .update(`${RELAY_AUTH_SCOPE}:${numericPort}`)
    .digest('hex');
}

export function createFacebookCdpCaptureState(rawOptions = {}, installedAt = new Date().toISOString()) {
  const capture = createInstalledNetworkCaptureState(rawOptions, installedAt);
  capture.stats.cdpConnected = false;
  capture.stats.cdpCandidates = 0;
  capture.stats.cdpSessionsEnabled = 0;

  return {
    capture,
    pendingRequests: new Map(),
    pendingBodyReads: new Set(),
    enabledSessionIds: new Set(),
    graphqlRequests: [],
    maxLoggedGraphQlRequests: Math.max(Number(capture.options.maxBufferedEnvelopes || 80) * 4, 120),
    nextGraphQlRequestSequence: 1,
    targetId: null,
    sessionId: null,
    lastActivityAtMs: Date.parse(installedAt) || Date.now(),
    startup: {
      armedAt: installedAt,
      navigationRequestedAt: null,
      navigationCompletedAt: null,
      initialUrl: null,
      navigatedToUrl: null,
      firstRequestTimestamp: null,
      firstResponseTimestamp: null,
    },
  };
}

function noteCaptureActivity(state) {
  if (!state || typeof state !== 'object') {
    return;
  }

  state.lastActivityAtMs = Date.now();
}

export function recordFacebookCdpNavigationStart(state, details = {}, requestedAt = new Date().toISOString()) {
  if (!state || typeof state !== 'object') return;

  state.startup.navigationRequestedAt = requestedAt;
  state.startup.initialUrl = details.fromUrl || state.startup.initialUrl || null;
  state.startup.navigatedToUrl = details.toUrl || state.startup.navigatedToUrl || null;
}

export function recordFacebookCdpNavigationComplete(state, details = {}, completedAt = new Date().toISOString()) {
  if (!state || typeof state !== 'object') return;

  state.startup.navigationCompletedAt = completedAt;
  if (details.url) {
    state.startup.navigatedToUrl = details.url;
  }
}

function noteStartupRequest(state, timestamp) {
  if (!state?.startup?.navigationRequestedAt || !timestamp) {
    return;
  }

  if (!state.startup.firstRequestTimestamp) {
    state.startup.firstRequestTimestamp = timestamp;
  }
}

function noteStartupResponse(state, timestamp) {
  if (!state?.startup?.navigationRequestedAt || !timestamp) {
    return;
  }

  if (!state.startup.firstResponseTimestamp) {
    state.startup.firstResponseTimestamp = timestamp;
  }
}

function recordGraphQlRequest(state, requestAnalysis, requestTimestamp) {
  const loggedRequest = {
    requestSequence: state.nextGraphQlRequestSequence,
    requestTimestamp,
    url: requestAnalysis.url,
    method: requestAnalysis.method,
    requestContentType: requestAnalysis.requestContentType,
    fbApiReqFriendlyName: requestAnalysis.fbApiReqFriendlyName,
    docId: requestAnalysis.docId,
    actorId: requestAnalysis.actorId,
    shouldInspectResponse: requestAnalysis.shouldInspectResponse,
    strongSignal: requestAnalysis.strongSignal,
    skipReason: requestAnalysis.skipReason,
    signalReasons: Array.isArray(requestAnalysis.signalReasons) ? [...requestAnalysis.signalReasons] : [],
    hasTargetGroupId: requestAnalysis.hasTargetGroupId,
    requestHints: {
      groupIds: [...(requestAnalysis.requestHints?.groupIds || [])],
      postIds: [...(requestAnalysis.requestHints?.postIds || [])],
      storyIds: [...(requestAnalysis.requestHints?.storyIds || [])],
      feedbackIds: [...(requestAnalysis.requestHints?.feedbackIds || [])],
    },
    requestTextFragment: requestAnalysis.requestTextFragment,
    variablesTextFragment: requestAnalysis.variablesTextFragment,
  };

  state.graphqlRequests.push(loggedRequest);
  state.nextGraphQlRequestSequence += 1;

  while (state.graphqlRequests.length > state.maxLoggedGraphQlRequests) {
    state.graphqlRequests.shift();
  }
}

export function handleFacebookCdpRequestWillBeSent(state, params, sessionId) {
  if (!state?.capture) {
    return null;
  }

  noteCaptureActivity(state);
  const request = params?.request || {};
  const requestTimestamp = toIsoTimestamp(params?.wallTime, 1000) || new Date().toISOString();
  const requestContentType = getHeaderValue(request.headers, 'content-type');
  const requestBodyText = readRequestPostData(request);
  const requestAnalysis = applyHeaderFallbackToRequestAnalysis(analyzeFacebookGraphQlRequest({
    url: request.url,
    method: request.method,
    requestContentType,
    requestBodyText,
  }, state.capture.options), request.headers, state.capture.options);

  if (/\/api\/graphql(?:\/|$|\?)/i.test(String(request.url || ''))) {
    recordGraphQlRequest(state, requestAnalysis, requestTimestamp);
  }

  if (!requestAnalysis.shouldInspectResponse) {
    state.capture.stats.skippedLowSignal += 1;
    return null;
  }

  noteStartupRequest(state, requestTimestamp);
  state.capture.stats.cdpCandidates = Number(state.capture.stats.cdpCandidates || 0) + 1;

  const pending = {
    requestId: params?.requestId || null,
    sessionId: sessionId || null,
    requestTimestamp,
    requestAnalysis,
    responseTimestamp: null,
    responseContentType: null,
    status: null,
    ok: null,
  };

  state.pendingRequests.set(getRequestMapKey(sessionId, params?.requestId), pending);
  return pending;
}

export function handleFacebookCdpResponseReceived(state, params, sessionId) {
  if (!state?.capture) {
    return null;
  }

  noteCaptureActivity(state);
  const requestKey = getRequestMapKey(sessionId, params?.requestId);
  const pending = state.pendingRequests.get(requestKey);
  if (!pending) {
    return null;
  }

  const response = params?.response || {};
  const responseTimestamp = toIsoTimestamp(response.responseTime, response.responseTime > 1e12 ? 1 : 1000)
    || new Date().toISOString();
  const responseContentType = getHeaderValue(response.headers, 'content-type')
    || response.mimeType
    || null;

  pending.responseTimestamp = responseTimestamp;
  pending.responseContentType = responseContentType;
  pending.status = Number.isFinite(response.status) ? response.status : null;
  pending.ok = pending.status === null ? null : pending.status >= 200 && pending.status < 300;

  if (!looksTextualContentType(responseContentType)) {
    state.capture.stats.skippedNonText += 1;
    state.pendingRequests.delete(requestKey);
    return null;
  }

  noteStartupResponse(state, responseTimestamp);
  return pending;
}

export async function handleFacebookCdpLoadingFinished(state, params, sessionId, getResponseBody) {
  if (!state?.capture) {
    return null;
  }

  noteCaptureActivity(state);
  const requestKey = getRequestMapKey(sessionId, params?.requestId);
  const pending = state.pendingRequests.get(requestKey);
  if (!pending) {
    return null;
  }

  state.pendingRequests.delete(requestKey);
  state.capture.stats.responsesInspected += 1;
  const responseBodyPromise = (async () => {
    let responseText = '';
    try {
      responseText = decodeResponseBody(await getResponseBody(params?.requestId, sessionId));
    } catch {
      state.capture.stats.responseReadErrors += 1;
      return null;
    } finally {
      noteCaptureActivity(state);
    }

    const envelope = buildFacebookNetworkCaptureEnvelope({
      sourceTransport: 'cdp',
      url: pending.requestAnalysis.url,
      method: pending.requestAnalysis.method,
      requestTimestamp: pending.requestTimestamp,
      responseTimestamp: pending.responseTimestamp || new Date().toISOString(),
      status: pending.status,
      ok: pending.ok,
      requestContentType: pending.requestAnalysis.requestContentType,
      responseContentType: pending.responseContentType,
      responseText,
      requestAnalysis: pending.requestAnalysis,
    }, state.capture.options);

    if (!envelope) {
      return null;
    }

    noteCaptureActivity(state);
    return storeNetworkCaptureEnvelope(state.capture, envelope, state.capture.options);
  })();

  state.pendingBodyReads.add(responseBodyPromise);
  noteCaptureActivity(state);

  try {
    return await responseBodyPromise;
  } finally {
    state.pendingBodyReads.delete(responseBodyPromise);
    noteCaptureActivity(state);
  }
}

export function handleFacebookCdpLoadingFailed(state, params, sessionId) {
  if (!state?.pendingRequests) {
    return;
  }

  noteCaptureActivity(state);
  state.pendingRequests.delete(getRequestMapKey(sessionId, params?.requestId));
}

export function drainFacebookCdpCaptureState(state, input = {}) {
  const maxItems = Number.parseInt(String(input.maxItems || state?.capture?.options?.maxBufferedEnvelopes || 80), 10);
  const clear = input.clear !== false;
  const items = Array.isArray(state?.capture?.items) ? state.capture.items : [];
  const nextItems = items.slice(0, Math.max(0, maxItems));

  if (clear && nextItems.length) {
    items.splice(0, nextItems.length);
  }

  const pendingRequests = state?.pendingRequests?.size || 0;
  const inFlightBodyReads = state?.pendingBodyReads?.size || 0;
  const remainingBuffered = clear
    ? items.length
    : Math.max(0, items.length - nextItems.length);

  return {
    items: nextItems,
    remainingBuffered,
    pendingRequests,
    inFlightBodyReads,
    remaining: remainingBuffered + pendingRequests + inFlightBodyReads,
    stats: state?.capture?.stats ? { ...state.capture.stats } : null,
  };
}

export async function waitForFacebookCdpCaptureIdle(state, input = {}) {
  const idleMs = Math.max(0, Number.parseInt(String(input.idleMs ?? 120), 10) || 0);
  const timeoutMs = Math.max(idleMs, Number.parseInt(String(input.timeoutMs ?? 1500), 10) || 0);
  const pollMs = Math.max(10, Number.parseInt(String(input.pollMs ?? 25), 10) || 25);
  const deadlineAt = Date.now() + timeoutMs;
  const observeStartedAt = Date.now();

  while (Date.now() <= deadlineAt) {
    const pendingRequests = state?.pendingRequests?.size || 0;
    const inFlightBodyReads = state?.pendingBodyReads?.size || 0;
    const idleSinceAt = Math.max(
      observeStartedAt,
      Number(state?.lastActivityAtMs || observeStartedAt),
    );
    const idleForMs = Math.max(0, Date.now() - idleSinceAt);

    if (!pendingRequests && !inFlightBodyReads && idleForMs >= idleMs) {
      return {
        timedOut: false,
        pendingRequests,
        inFlightBodyReads,
        idleForMs,
        bufferedItems: Array.isArray(state?.capture?.items) ? state.capture.items.length : 0,
      };
    }

    if (inFlightBodyReads) {
      await Promise.race([
        Promise.allSettled([...state.pendingBodyReads]),
        new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadlineAt - Date.now())))),
      ]);
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadlineAt - Date.now()))));
  }

  return {
    timedOut: true,
    pendingRequests: state?.pendingRequests?.size || 0,
    inFlightBodyReads: state?.pendingBodyReads?.size || 0,
    idleForMs: Math.max(0, Date.now() - Number(state?.lastActivityAtMs || Date.now())),
    bufferedItems: Array.isArray(state?.capture?.items) ? state.capture.items.length : 0,
  };
}

export function summarizeFacebookCdpCaptureInstalledState(state) {
  return {
    installed: true,
    reinstalled: false,
    transport: 'cdp',
    version: state.capture.version,
    installedAt: state.capture.installedAt,
    options: state.capture.options,
    stats: { ...state.capture.stats },
    targetId: state.targetId,
    sessionId: state.sessionId,
    pendingRequests: state.pendingRequests.size,
    inFlightBodyReads: state.pendingBodyReads.size,
    lastActivityAt: toIsoTimestamp(state.lastActivityAtMs, 1),
    startup: { ...state.startup },
  };
}

export function filterFacebookCdpRequestsByTimestampWindow(requests = [], input = {}) {
  const startAt = input?.startTimestamp ? Date.parse(String(input.startTimestamp)) : Number.NEGATIVE_INFINITY;
  const endAt = input?.endTimestamp ? Date.parse(String(input.endTimestamp)) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startAt) && input?.startTimestamp) {
    return [];
  }
  if (!Number.isFinite(endAt) && input?.endTimestamp) {
    return [];
  }

  return requests.filter((request) => {
    const requestAt = Date.parse(String(request?.requestTimestamp || ''));
    if (!Number.isFinite(requestAt)) {
      return false;
    }

    return requestAt >= startAt && requestAt <= endAt;
  });
}

export function summarizeFacebookCdpGraphQlRequests(requests = []) {
  const topFriendlyNames = new Map();
  const topDocIds = new Map();
  let startupInspectableCount = 0;

  for (const request of requests) {
    if (request?.fbApiReqFriendlyName) {
      topFriendlyNames.set(
        request.fbApiReqFriendlyName,
        (topFriendlyNames.get(request.fbApiReqFriendlyName) || 0) + 1,
      );
    }

    if (request?.docId) {
      topDocIds.set(
        request.docId,
        (topDocIds.get(request.docId) || 0) + 1,
      );
    }

    if (request?.shouldInspectResponse) {
      startupInspectableCount += 1;
    }
  }

  function sortCounter(counter) {
    return Array.from(counter.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ value, count }));
  }

  return {
    count: requests.length,
    inspectableCount: startupInspectableCount,
    topFriendlyNames: sortCounter(topFriendlyNames),
    topDocIds: sortCounter(topDocIds),
  };
}

export async function createFacebookCdpNetworkCaptureController({
  profileName,
  rawOptions = {},
  targetId = null,
  preferredUrl = null,
}) {
  const status = getBrowserStatus(profileName);
  if (!status?.running || !status?.cdpReady || !status?.cdpPort) {
    throw new Error(`browser profile ${profileName} is not CDP-ready`);
  }

  const selectedTab = chooseTargetTab(getBrowserTabs(profileName)?.tabs, targetId, preferredUrl);
  const gatewayToken = resolveOpenClawGatewayToken();
  const relayToken = deriveOpenClawRelayAuthToken(gatewayToken, status.cdpPort);
  const wsUrl = `ws://127.0.0.1:${status.cdpPort}/cdp?token=${encodeURIComponent(relayToken)}`;
  const state = createFacebookCdpCaptureState(normalizeNetworkCaptureOptions(rawOptions));
  state.targetId = selectedTab.targetId;
  state.startup.initialUrl = selectedTab.url || null;

  const socket = new WebSocket(wsUrl);
  const pendingCommands = new Map();
  const attachedWaiters = new Set();
  let nextCommandId = 1;
  let closed = false;

  function settleAttachedWaiters(error = null) {
    for (const waiter of attachedWaiters) {
      waiter.stop();
      if (error) {
        waiter.reject(error);
      } else if (state.sessionId) {
        waiter.resolve(state.sessionId);
      }
    }
    attachedWaiters.clear();
  }

  function rejectPendingCommands(error) {
    for (const pending of pendingCommands.values()) {
      pending.reject(error);
    }
    pendingCommands.clear();
  }

  async function send(method, params = {}, sessionId = undefined) {
    if (closed) {
      throw new Error('CDP capture controller is closed');
    }

    const commandId = nextCommandId++;
    const payload = {
      id: commandId,
      method,
      params,
    };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    const promise = new Promise((resolve, reject) => {
      pendingCommands.set(commandId, { resolve, reject });
    });

    socket.send(JSON.stringify(payload));
    return promise;
  }

  async function enableNetworkForSession(sessionId) {
    if (!sessionId || state.enabledSessionIds.has(sessionId)) {
      return;
    }

    await send('Network.enable', {
      maxPostDataSize: Math.max(
        Number(state.capture.options.maxRequestChars || 8192),
        Number(state.capture.options.maxVariablesChars || 20000),
        65536,
      ),
    }, sessionId);
    state.enabledSessionIds.add(sessionId);
    state.capture.stats.cdpSessionsEnabled = state.enabledSessionIds.size;
  }

  function waitForAttachedSession(timeoutMs = 3000) {
    if (state.sessionId) {
      return Promise.resolve(state.sessionId);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        attachedWaiters.delete(waiter);
        reject(new Error('timed out waiting for attached page session'));
      }, timeoutMs);

      const waiter = {
        resolve,
        reject,
        stop() {
          clearTimeout(timer);
        },
      };

      attachedWaiters.add(waiter);
    });
  }

  socket.addEventListener('message', (event) => {
    let message = null;
    try {
      message = JSON.parse(String(event.data || ''));
    } catch {
      return;
    }

    if (typeof message?.id === 'number') {
      const pending = pendingCommands.get(message.id);
      if (!pending) return;
      pendingCommands.delete(message.id);
      if (message.error?.message) {
        pending.reject(new Error(String(message.error.message)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message?.method !== 'string') {
      return;
    }

    if (message.method === 'Target.attachedToTarget') {
      noteCaptureActivity(state);
      const targetInfo = message.params?.targetInfo || {};
      const attachedTargetId = String(targetInfo.targetId || '').trim();
      const attachedSessionId = String(message.params?.sessionId || '').trim();
      if (!attachedTargetId || !attachedSessionId || (targetInfo.type || 'page') !== 'page') {
        return;
      }

      if (attachedTargetId !== state.targetId && attachedSessionId !== state.sessionId) {
        return;
      }

      state.targetId = attachedTargetId;
      state.sessionId = attachedSessionId;
      void enableNetworkForSession(attachedSessionId)
        .then(() => settleAttachedWaiters())
        .catch((error) => settleAttachedWaiters(error));
      return;
    }

    if (message.method === 'Target.detachedFromTarget') {
      noteCaptureActivity(state);
      const detachedSessionId = String(message.params?.sessionId || '').trim();
      if (detachedSessionId && detachedSessionId === state.sessionId) {
        state.enabledSessionIds.delete(detachedSessionId);
        state.capture.stats.cdpSessionsEnabled = state.enabledSessionIds.size;
        state.sessionId = null;
      }
      return;
    }

    if (message.sessionId && state.sessionId && message.sessionId !== state.sessionId) {
      return;
    }

    if (message.method === 'Network.requestWillBeSent') {
      handleFacebookCdpRequestWillBeSent(state, message.params, message.sessionId);
      return;
    }

    if (message.method === 'Network.responseReceived') {
      handleFacebookCdpResponseReceived(state, message.params, message.sessionId);
      return;
    }

    if (message.method === 'Network.loadingFinished') {
      void handleFacebookCdpLoadingFinished(
        state,
        message.params,
        message.sessionId,
        (requestId, sessionId) => send('Network.getResponseBody', { requestId }, sessionId),
      );
      return;
    }

    if (message.method === 'Network.loadingFailed') {
      handleFacebookCdpLoadingFailed(state, message.params, message.sessionId);
    }
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out opening the OpenClaw CDP websocket')), 5000);

    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('failed to open the OpenClaw CDP websocket'));
    }, { once: true });

    socket.addEventListener('close', () => {
      clearTimeout(timeout);
    }, { once: true });
  });

  state.capture.stats.cdpConnected = true;

  socket.addEventListener('close', () => {
    closed = true;
    state.capture.stats.cdpConnected = false;
    const error = new Error('OpenClaw CDP websocket closed');
    settleAttachedWaiters(error);
    rejectPendingCommands(error);
  });

  try {
    await send('Target.setDiscoverTargets', { discover: true });
  } catch {
    // The relay still works without target discovery; auto-attach is the important part.
  }

  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  if (!state.sessionId) {
    try {
      await waitForAttachedSession(1500);
    } catch {
      const attached = await send('Target.attachToTarget', {
        targetId: state.targetId,
        flatten: true,
      });
      if (attached?.sessionId) {
        state.sessionId = String(attached.sessionId);
        await enableNetworkForSession(state.sessionId);
      }
    }
  }

  if (state.sessionId) {
    await enableNetworkForSession(state.sessionId);
  }

  return {
    transport: 'cdp',
    targetId: state.targetId,
    state,
    drain(input = {}) {
      return drainFacebookCdpCaptureState(state, input);
    },
    async waitForIdle(input = {}) {
      return waitForFacebookCdpCaptureIdle(state, input);
    },
    noteNavigationStart(details = {}, timestamp = new Date().toISOString()) {
      recordFacebookCdpNavigationStart(state, details, timestamp);
    },
    noteNavigationComplete(details = {}, timestamp = new Date().toISOString()) {
      recordFacebookCdpNavigationComplete(state, details, timestamp);
    },
    getInstalledSummary() {
      return summarizeFacebookCdpCaptureInstalledState(state);
    },
    getGraphQlRequests() {
      return [...state.graphqlRequests];
    },
    getTargetId() {
      return state.targetId;
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      try {
        socket.close();
      } catch {
        // Ignore close errors on shutdown.
      }
      settleAttachedWaiters(new Error('CDP capture controller closed'));
      rejectPendingCommands(new Error('CDP capture controller closed'));
    },
  };
}

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage } from '../storage/storage.js';
import { bundleDashboardApp } from './dashboard/app/build-dashboard.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4310;
const DEFAULT_REVIEW_OPERATOR_ID = 'local-review';
const STATIC_DIR = fileURLToPath(new URL('./', import.meta.url));
const DASHBOARD_DIR = fileURLToPath(new URL('./dashboard/', import.meta.url));

export async function startInspectionServer(options = {}) {
  const workspaceRoot = path.resolve(process.cwd());
  const dataDir = path.resolve(workspaceRoot, options.dataDir || 'data');
  const host = String(options.host || DEFAULT_HOST).trim() || DEFAULT_HOST;
  const port = normalizePort(options.port, DEFAULT_PORT);
  const storage = createStorage({ dataDir });
  const assets = await loadStaticAssets();
  const context = {
    assets,
    dataDir,
    storage,
    workspaceRoot,
  };

  let closed = false;
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, context).catch((error) => {
      const isApi = isApiRequest(request);
      writeError(response, error, isApi);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  return {
    host,
    port: resolvedPort,
    url: `http://${urlHost}:${resolvedPort}`,
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      storage.close?.();
    },
  };
}

export function resolveArtifactFilePath(relativePath, options = {}) {
  const normalized = String(relativePath || '').trim();
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const dataDir = path.resolve(options.dataDir || path.join(workspaceRoot, 'data'));

  if (!normalized) {
    throw createHttpError(400, 'Missing artifact path.');
  }

  if (path.isAbsolute(normalized) || normalized.includes('\0')) {
    throw createHttpError(400, 'Artifact path must be a relative path.');
  }

  const candidate = normalized.startsWith('data/')
    ? path.resolve(workspaceRoot, normalized)
    : path.resolve(dataDir, normalized);

  const allowedRoots = new Set([
    path.resolve(workspaceRoot, 'data'),
    dataDir,
  ]);
  const isAllowed = Array.from(allowedRoots).some((root) => isPathInsideRoot(candidate, root));

  if (!isAllowed) {
    throw createHttpError(400, 'Artifact path must stay inside data/.');
  }

  if (!fs.existsSync(candidate)) {
    throw createHttpError(404, `Artifact not found: ${normalized}`);
  }

  return candidate;
}

async function handleRequest(request, response, context) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const dashboardListingMatch = pathname.match(/^\/api\/dashboard\/listings\/([^/]+)$/u);
  const dashboardPostMatch = pathname.match(/^\/api\/dashboard\/posts\/([^/]+)$/u);
  const dashboardReviewMatch = pathname.match(/^\/api\/dashboard\/review\/([^/]+)$/u);
  const dashboardDebugRunMatch = pathname.match(/^\/api\/dashboard\/debug\/runs\/([^/]+)$/u);
  const isReviewManualOverrideSet = pathname === '/api/dashboard/review/manual-overrides';
  const isReviewManualOverrideClear = pathname === '/api/dashboard/review/manual-overrides/clear';

  if (request.method === 'POST' && (isReviewManualOverrideSet || isReviewManualOverrideClear)) {
    const body = await readJsonBody(request);
    const listingId = requireJsonString(body, 'listingId');
    const fieldPath = requireJsonString(body, 'fieldPath');
    const reviewId = readJsonString(body, 'reviewId');
    const operatorId = readJsonString(body, 'operatorId') || DEFAULT_REVIEW_OPERATOR_ID;
    const listingDetail = readWithRetry(() => context.storage.getDashboardListingDetail({ listingId }));

    if (!listingDetail) {
      throw createHttpError(404, `Dashboard listing not found: ${listingId}`);
    }

    const currentFieldState = Array.isArray(listingDetail.listing?.locationFieldStates)
      ? listingDetail.listing.locationFieldStates.find((candidate) => candidate.fieldPath === fieldPath)
      : null;

    if (!currentFieldState) {
      throw createHttpError(400, `Review overrides currently support dashboard location fields only: ${fieldPath}`);
    }

    const actionInput = {
      action: isReviewManualOverrideClear ? 'clear' : 'set',
      actorId: operatorId,
      actorKind: 'operator',
      fieldPath,
      metadata: readJsonObject(body.metadata),
      operatorId,
      reason: readJsonString(body, 'reason') || (
        isReviewManualOverrideClear
          ? 'Manual override cleared from Review.'
          : 'Manual override saved from Review.'
      ),
      reviewId,
      targetId: listingId,
      targetKind: 'listing_record',
    };

    if (!isReviewManualOverrideClear) {
      actionInput.value = normalizeReviewOverrideValue(body.value, fieldPath);
    }

    const actionResult = readWithRetry(() => context.storage.applyManualOverrideAction(actionInput));
    const updatedListingDetail = readWithRetry(() => context.storage.getDashboardListingDetail({ listingId }));
    const updatedFieldState = Array.isArray(updatedListingDetail?.listing?.locationFieldStates)
      ? updatedListingDetail.listing.locationFieldStates.find((candidate) => candidate.fieldPath === fieldPath) || null
      : null;
    const updatedReview = reviewId
      ? readWithRetry(() => context.storage.getDashboardReviewItem({ reviewId }))
      : null;

    writeJson(response, {
      action: actionResult.action,
      auditEvent: actionResult.auditEvent,
      fieldPath,
      fieldState: updatedFieldState,
      listing: updatedListingDetail?.listing || null,
      manualOverride: actionResult.manualOverride,
      review: updatedReview,
      reviewId: reviewId || null,
      reviewLinkTarget: updatedListingDetail?.listing?.reviewLinkTarget || null,
      targetKind: actionResult.targetKind,
      targetId: actionResult.targetId,
    });
    return;
  }

  if (request.method !== 'GET') {
    throw createHttpError(405, 'Only GET requests are supported.');
  }

  if (pathname === '/' || pathname === '/index.html' || isDashboardAppRoute(pathname)) {
    writeHtml(response, context.assets.dashboardHtml);
    return;
  }

  if (pathname === '/inspector' || pathname === '/inspector/index.html') {
    writeHtml(response, context.assets.html);
    return;
  }

  if (pathname === '/app.js') {
    writeText(response, context.assets.js, 'application/javascript; charset=utf-8');
    return;
  }

  if (pathname === '/styles.css') {
    writeText(response, context.assets.css, 'text/css; charset=utf-8');
    return;
  }

  if (pathname === '/dashboard/app.js') {
    writeText(response, context.assets.dashboardJs, 'application/javascript; charset=utf-8');
    return;
  }

  if (pathname === '/dashboard/styles.css') {
    writeText(response, context.assets.dashboardCss, 'text/css; charset=utf-8');
    return;
  }

  if (pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (pathname === '/artifact-file') {
    const filePath = resolveArtifactFilePath(url.searchParams.get('path'), {
      dataDir: context.dataDir,
      workspaceRoot: context.workspaceRoot,
    });
    const rawText = fs.readFileSync(filePath, 'utf8');
    const contentType = path.extname(filePath) === '.json'
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
    writeText(response, rawText, contentType);
    return;
  }

  if (pathname === '/api/dashboard/listings') {
    const result = readWithRetry(() => context.storage.listDashboardListings({
      q: readString(url.searchParams, 'q'),
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      freshness: readString(url.searchParams, 'freshness'),
      listingType: readString(url.searchParams, 'listingType'),
      intent: readString(url.searchParams, 'intent'),
      borough: readString(url.searchParams, 'borough'),
      neighborhood: readString(url.searchParams, 'neighborhood'),
      priceMin: readString(url.searchParams, 'priceMin'),
      priceMax: readString(url.searchParams, 'priceMax'),
      bedsMin: readString(url.searchParams, 'bedsMin'),
      bedsMax: readString(url.searchParams, 'bedsMax'),
      bathsMin: readString(url.searchParams, 'bathsMin'),
      postedWithinHours: readString(url.searchParams, 'postedWithinHours'),
      minConfidence: readString(url.searchParams, 'minConfidence'),
      hasAmbiguities: readString(url.searchParams, 'hasAmbiguities'),
      sort: readString(url.searchParams, 'sort'),
      page: readString(url.searchParams, 'page'),
      pageSize: readString(url.searchParams, 'pageSize'),
    }));
    writeJson(response, result);
    return;
  }

  if (dashboardListingMatch) {
    const listingId = decodeURIComponent(dashboardListingMatch[1]);
    const detail = readWithRetry(() => context.storage.getDashboardListingDetail({ listingId }));

    if (!detail) {
      throw createHttpError(404, `Dashboard listing not found: ${listingId}`);
    }

    writeJson(response, detail);
    return;
  }

  if (pathname === '/api/dashboard/posts') {
    const result = readWithRetry(() => context.storage.listDashboardPosts({
      q: readString(url.searchParams, 'q'),
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      freshness: readString(url.searchParams, 'freshness'),
      processingStatus: readString(url.searchParams, 'processingStatus'),
      postedWithinHours: readString(url.searchParams, 'postedWithinHours'),
      sort: readString(url.searchParams, 'sort'),
      page: readString(url.searchParams, 'page'),
      pageSize: readString(url.searchParams, 'pageSize'),
    }));
    writeJson(response, result);
    return;
  }

  if (dashboardPostMatch) {
    const observationId = decodeURIComponent(dashboardPostMatch[1]);
    const detail = readWithRetry(() => context.storage.getDashboardPostDetail({ observationId }));

    if (!detail) {
      throw createHttpError(404, `Dashboard post not found: ${observationId}`);
    }

    writeJson(response, detail);
    return;
  }

  if (pathname === '/api/dashboard/review') {
    const result = readWithRetry(() => context.storage.listDashboardReviewItems({
      queue: readString(url.searchParams, 'queue'),
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      postedWithinHours: readString(url.searchParams, 'postedWithinHours'),
      sort: readString(url.searchParams, 'sort'),
      page: readString(url.searchParams, 'page'),
      pageSize: readString(url.searchParams, 'pageSize'),
    }));
    writeJson(response, result);
    return;
  }

  if (dashboardReviewMatch) {
    const reviewId = decodeURIComponent(dashboardReviewMatch[1]);
    const detail = readWithRetry(() => context.storage.getDashboardReviewItem({
      postedWithinHours: readString(url.searchParams, 'postedWithinHours'),
      queue: readString(url.searchParams, 'queue'),
      reviewId,
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
    }));

    if (!detail) {
      throw createHttpError(404, `Dashboard review item not found: ${reviewId}`);
    }

    writeJson(response, detail);
    return;
  }

  if (pathname === '/api/dashboard/debug/runs') {
    const result = readWithRetry(() => context.storage.listDashboardDebugRuns({
      sourceKey: readString(url.searchParams, 'sourceKey'),
      status: readString(url.searchParams, 'status'),
      runKind: readString(url.searchParams, 'runKind'),
      page: readString(url.searchParams, 'page'),
      pageSize: readString(url.searchParams, 'pageSize'),
    }));
    writeJson(response, result);
    return;
  }

  if (pathname === '/api/dashboard/debug/run') {
    const runId = requireQuery(url.searchParams, 'runId');
    const detail = readWithRetry(() => context.storage.getDashboardDebugRun({ runId }));

    if (!detail) {
      throw createHttpError(404, `Dashboard run not found: ${runId}`);
    }

    writeJson(response, detail);
    return;
  }

  if (dashboardDebugRunMatch) {
    const runId = decodeURIComponent(dashboardDebugRunMatch[1]);
    const detail = readWithRetry(() => context.storage.getDashboardDebugRun({ runId }));

    if (!detail) {
      throw createHttpError(404, `Dashboard run not found: ${runId}`);
    }

    writeJson(response, detail);
    return;
  }

  if (pathname === '/api/sources') {
    const items = readWithRetry(() => context.storage.listSources({
      limit: readLimit(url.searchParams, 50),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      platform: readString(url.searchParams, 'platform'),
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/runs') {
    const items = readWithRetry(() => context.storage.listRecentRuns({
      limit: readLimit(url.searchParams, 50),
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      status: readString(url.searchParams, 'status'),
      runKind: readString(url.searchParams, 'runKind'),
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/run') {
    const runId = requireQuery(url.searchParams, 'runId');
    const [run] = readWithRetry(() => context.storage.listRecentRuns({ runId, limit: 1 }));

    if (!run) {
      throw createHttpError(404, `Run not found: ${runId}`);
    }

    const validation = readWithRetry(() => context.storage.validateRun({ runId }));
    writeJson(response, { run, validation });
    return;
  }

  if (pathname === '/api/observations') {
    const full = readBoolean(url.searchParams, 'full');
    const items = readWithRetry(() => context.storage.listObservations({
      limit: readLimit(url.searchParams, hasQuery(url.searchParams, 'runId') ? 500 : 100),
      runId: readString(url.searchParams, 'runId'),
      observationId: readString(url.searchParams, 'observationId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      freshness: readString(url.searchParams, 'freshness'),
      includeFullText: full,
      includeCollections: full,
      includePayload: full,
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/jobs') {
    const full = readBoolean(url.searchParams, 'full');
    const items = readWithRetry(() => context.storage.listProcessingJobs({
      limit: readLimit(url.searchParams, hasQuery(url.searchParams, 'runId') ? 500 : 100),
      runId: readString(url.searchParams, 'runId'),
      observationId: readString(url.searchParams, 'observationId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      freshness: readString(url.searchParams, 'freshness'),
      status: readString(url.searchParams, 'status'),
      processorVersion: readString(url.searchParams, 'processorVersion'),
      schemaVersion: readString(url.searchParams, 'schemaVersion'),
      modelName: readString(url.searchParams, 'modelName'),
      includeObservationPayload: full,
      includeProcessedPayload: full,
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/listings') {
    const full = readBoolean(url.searchParams, 'full');
    const items = readWithRetry(() => context.storage.listListings({
      limit: readLimit(url.searchParams, hasQuery(url.searchParams, 'runId') ? 500 : 100),
      runId: readString(url.searchParams, 'runId'),
      observationId: readString(url.searchParams, 'observationId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      listingType: readString(url.searchParams, 'listingType'),
      includePayload: full,
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/run-steps') {
    const items = readWithRetry(() => context.storage.listRunSteps({
      limit: readLimit(url.searchParams, hasQuery(url.searchParams, 'runId') ? 500 : 100),
      runId: readString(url.searchParams, 'runId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/artifacts') {
    const items = readWithRetry(() => context.storage.listArtifactRefs({
      limit: readLimit(url.searchParams, hasQuery(url.searchParams, 'runId') ? 500 : 100),
      runId: readString(url.searchParams, 'runId'),
      observationId: readString(url.searchParams, 'observationId'),
      sourceKey: readString(url.searchParams, 'sourceKey'),
      artifactKind: readString(url.searchParams, 'artifactKind'),
    }));
    writeJson(response, { count: items.length, items });
    return;
  }

  if (pathname === '/api/validate-run') {
    const runId = requireQuery(url.searchParams, 'runId');
    const result = readWithRetry(() => context.storage.validateRun({ runId }));
    writeJson(response, { runId, result });
    return;
  }

  throw createHttpError(404, `Route not found: ${pathname}`);
}

async function loadStaticAssets() {
  return {
    js: fs.readFileSync(path.join(STATIC_DIR, 'inspection-app.js'), 'utf8'),
    css: fs.readFileSync(path.join(STATIC_DIR, 'inspection-app.css'), 'utf8'),
    dashboardCss: fs.readFileSync(path.join(DASHBOARD_DIR, 'styles', 'dashboard.css'), 'utf8'),
    dashboardHtml: fs.readFileSync(path.join(DASHBOARD_DIR, 'app', 'index.html'), 'utf8'),
    dashboardJs: await bundleDashboardApp(),
    html: fs.readFileSync(path.join(STATIC_DIR, 'inspection-app.html'), 'utf8'),
  };
}

function isDashboardAppRoute(pathname) {
  return pathname === '/listings'
    || pathname === '/posts'
    || pathname === '/review'
    || pathname === '/debug'
    || pathname.startsWith('/debug/');
}

function readWithRetry(task, attempts = 2) {
  let remaining = attempts;

  while (remaining >= 0) {
    try {
      return task();
    } catch (error) {
      if (!isBusyError(error) || remaining === 0) {
        throw error;
      }

      remaining -= 1;
    }
  }

  return null;
}

function isBusyError(error) {
  const message = String(error?.message || '');
  return message.includes('database is locked') || message.includes('SQLITE_BUSY');
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody);
    return readJsonObject(parsed);
  } catch {
    throw createHttpError(400, 'Request body must be valid JSON.');
  }
}

function normalizePort(value, fallback) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function readLimit(searchParams, fallback) {
  const parsed = Number(searchParams.get('limit'));

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 500);
}

function readBoolean(searchParams, name) {
  const value = searchParams.get(name);
  return value === '1' || value === 'true' || value === 'yes';
}

function readString(searchParams, name) {
  const value = searchParams.get(name);
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function readJsonString(value, name) {
  const normalized = String(value?.[name] || '').trim();
  return normalized || undefined;
}

function requireJsonString(value, name) {
  const normalized = readJsonString(value, name);

  if (!normalized) {
    throw createHttpError(400, `Missing required JSON field: ${name}`);
  }

  return normalized;
}

function readJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function normalizeReviewOverrideValue(value, fieldPath) {
  const normalized = typeof value === 'string'
    ? value.trim()
    : value;

  if (normalized === undefined || normalized === null || normalized === '') {
    throw createHttpError(400, `Review override requires a non-empty value for ${fieldPath}.`);
  }

  return normalized;
}

function requireQuery(searchParams, name) {
  const value = readString(searchParams, name);

  if (!value) {
    throw createHttpError(400, `Missing required query parameter: ${name}`);
  }

  return value;
}

function hasQuery(searchParams, name) {
  return Boolean(readString(searchParams, name));
}

function isPathInsideRoot(targetPath, rootPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isApiRequest(request) {
  return Boolean(request.url && request.url.startsWith('/api/'));
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function writeHtml(response, html) {
  writeText(response, html, 'text/html; charset=utf-8');
}

function writeJson(response, value, statusCode = 200) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function writeText(response, text, contentType, statusCode = 200) {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(text);
}

function writeError(response, error, asJson) {
  const statusCode = error?.statusCode || (isBusyError(error) ? 503 : 500);
  const message = statusCode === 500
    ? 'Unexpected server error.'
    : String(error?.message || 'Request failed.');

  if (asJson) {
    writeJson(response, { error: message }, statusCode);
    return;
  }

  writeText(response, message, 'text/plain; charset=utf-8', statusCode);
}

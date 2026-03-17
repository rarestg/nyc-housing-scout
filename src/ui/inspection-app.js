const TAB_KEYS = ['summary', 'observations', 'jobs', 'listings', 'runSteps', 'artifacts'];

const state = {
  sources: [],
  runs: [],
  selectedRunId: null,
  selectedTab: 'summary',
  cache: new Map(),
  runsFilter: {
    sourceKey: '',
    query: '',
  },
  tabFilters: {
    observations: { freshness: '', query: '' },
    jobs: { status: '', query: '' },
    listings: { extractorVersion: '', query: '' },
    runSteps: { query: '' },
    artifacts: { artifactKind: '', query: '' },
  },
  loading: {
    sources: false,
    runs: false,
    tabs: new Set(),
  },
  error: null,
};

const elements = {
  globalStatus: document.querySelector('#globalStatus'),
  sourceFilterSelect: document.querySelector('#sourceFilterSelect'),
  runSearchInput: document.querySelector('#runSearchInput'),
  runsCountLabel: document.querySelector('#runsCountLabel'),
  runsList: document.querySelector('#runsList'),
  detailHeader: document.querySelector('#detailHeader'),
  summaryStrip: document.querySelector('#summaryStrip'),
  tabBar: document.querySelector('#tabBar'),
  tabFilters: document.querySelector('#tabFilters'),
  tabContent: document.querySelector('#tabContent'),
  refreshAllButton: document.querySelector('#refreshAllButton'),
};

void init();

async function init() {
  bindEvents();
  hydrateFromLocation();
  await Promise.all([loadSources(), loadRuns()]);

  const runId = state.selectedRunId || state.runs[0]?.id || null;
  if (runId) {
    await selectRun(runId, { preserveHashTab: true });
  } else {
    render();
  }
}

function bindEvents() {
  elements.sourceFilterSelect.addEventListener('change', async (event) => {
    state.runsFilter.sourceKey = event.target.value;
    await loadRuns();
  });

  elements.runSearchInput.addEventListener('input', () => {
    state.runsFilter.query = elements.runSearchInput.value;
    renderRuns();
  });

  elements.refreshAllButton.addEventListener('click', async () => {
    const selectedRunId = state.selectedRunId;
    state.cache.clear();
    await Promise.all([loadSources(), loadRuns()]);

    if (selectedRunId) {
      await selectRun(selectedRunId, { preserveHashTab: true });
    } else {
      render();
    }
  });

  window.addEventListener('hashchange', async () => {
    const previousRunId = state.selectedRunId;
    hydrateFromLocation();

    if (state.selectedRunId && state.selectedRunId !== previousRunId) {
      await selectRun(state.selectedRunId, { preserveHashTab: true });
      return;
    }

    render();
  });
}

async function loadSources() {
  state.loading.sources = true;
  renderStatus('Loading sources...');

  try {
    const response = await fetchJson('/api/sources?limit=100');
    state.sources = response.items || [];
    renderSourceFilter();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading.sources = false;
    renderStatus();
  }
}

async function loadRuns() {
  state.loading.runs = true;
  renderStatus('Loading runs...');

  try {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (state.runsFilter.sourceKey) {
      params.set('sourceKey', state.runsFilter.sourceKey);
    }

    const response = await fetchJson(`/api/runs?${params.toString()}`);
    state.runs = response.items || [];

    if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId)) {
      state.selectedRunId = state.runs[0]?.id || null;
      writeHash();
    }

    render();
  } catch (error) {
    state.error = error.message;
    render();
  } finally {
    state.loading.runs = false;
    renderStatus();
  }
}

async function selectRun(runId, options = {}) {
  state.selectedRunId = runId;
  if (!options.preserveHashTab) {
    state.selectedTab = 'summary';
  }

  writeHash();
  ensureRunCache(runId);
  render();

  await loadRunOverview(runId);

  if (state.selectedTab !== 'summary') {
    await loadActiveTab(runId, state.selectedTab);
  } else {
    render();
  }
}

async function loadRunOverview(runId) {
  const cache = ensureRunCache(runId);
  if (cache.overview) {
    return;
  }

  cache.loadingOverview = true;
  render();

  try {
    const response = await fetchJson(`/api/run?runId=${encodeURIComponent(runId)}`);
    cache.overview = response;
  } catch (error) {
    cache.overviewError = error.message;
  } finally {
    cache.loadingOverview = false;
    render();
  }
}

async function loadActiveTab(runId, tabKey) {
  const cache = ensureRunCache(runId);
  if (cache.tabs[tabKey]?.items) {
    return;
  }

  state.loading.tabs.add(`${runId}:${tabKey}`);
  render();

  try {
    const response = await fetchJson(buildTabUrl(tabKey, runId));
    cache.tabs[tabKey] = response;
  } catch (error) {
    cache.tabs[tabKey] = { error: error.message, items: [] };
  } finally {
    state.loading.tabs.delete(`${runId}:${tabKey}`);
    render();
  }
}

function buildTabUrl(tabKey, runId) {
  const params = new URLSearchParams();
  params.set('runId', runId);
  params.set('limit', '500');

  if (tabKey === 'observations' || tabKey === 'jobs' || tabKey === 'listings') {
    params.set('full', '1');
  }

  switch (tabKey) {
    case 'observations':
      return `/api/observations?${params.toString()}`;
    case 'jobs':
      return `/api/jobs?${params.toString()}`;
    case 'listings':
      return `/api/listings?${params.toString()}`;
    case 'runSteps':
      return `/api/run-steps?${params.toString()}`;
    case 'artifacts':
      return `/api/artifacts?${params.toString()}`;
    default:
      return `/api/run?${params.toString()}`;
  }
}

function ensureRunCache(runId) {
  if (!state.cache.has(runId)) {
    state.cache.set(runId, {
      overview: null,
      overviewError: null,
      loadingOverview: false,
      tabs: {},
    });
  }

  return state.cache.get(runId);
}

function hydrateFromLocation() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const runId = params.get('run');
  const tab = params.get('tab');

  if (runId) {
    state.selectedRunId = runId;
  }

  if (TAB_KEYS.includes(tab)) {
    state.selectedTab = tab;
  }
}

function writeHash() {
  const params = new URLSearchParams();

  if (state.selectedRunId) {
    params.set('run', state.selectedRunId);
  }

  if (state.selectedTab && state.selectedTab !== 'summary') {
    params.set('tab', state.selectedTab);
  }

  const nextHash = params.toString();
  if (window.location.hash.replace(/^#/, '') !== nextHash) {
    window.location.hash = nextHash;
  }
}

function render() {
  renderSourceFilter();
  renderRuns();
  renderDetailHeader();
  renderSummaryStrip();
  renderTabBar();
  renderTabFilters();
  renderTabContent();
  renderStatus();
}

function renderStatus(message) {
  if (message) {
    elements.globalStatus.textContent = message;
    return;
  }

  if (state.error) {
    elements.globalStatus.textContent = state.error;
    return;
  }

  if (state.loading.runs) {
    elements.globalStatus.textContent = 'Refreshing runs...';
    return;
  }

  if (state.selectedRunId && state.loading.tabs.size > 0) {
    elements.globalStatus.textContent = 'Loading run data...';
    return;
  }

  const runCount = state.runs.length;
  elements.globalStatus.textContent = runCount
    ? `${runCount} runs loaded`
    : 'No runs loaded';
}

function renderSourceFilter() {
  const currentValue = state.runsFilter.sourceKey;
  const options = ['<option value="">All sources</option>']
    .concat(state.sources.map((source) => {
      const selected = source.sourceKey === currentValue ? ' selected' : '';
      return `<option value="${escapeHtml(source.sourceKey)}"${selected}>${escapeHtml(source.sourceKey)}</option>`;
    }))
    .join('');

  elements.sourceFilterSelect.innerHTML = options;
}

function renderRuns() {
  const filteredRuns = getFilteredRuns();
  elements.runsCountLabel.textContent = `${filteredRuns.length} shown`;

  if (state.loading.runs && filteredRuns.length === 0) {
    elements.runsList.innerHTML = '<div class="loading-state">Loading runs...</div>';
    return;
  }

  if (filteredRuns.length === 0) {
    elements.runsList.innerHTML = '<div class="empty-state">No runs match the current filters.</div>';
    return;
  }

  elements.runsList.innerHTML = filteredRuns.map((run) => renderRunCard(run)).join('');
  elements.runsList.querySelectorAll('.run-card').forEach((button) => {
    button.addEventListener('click', async () => {
      const runId = button.dataset.runId;
      if (runId) {
        await selectRun(runId);
      }
    });
  });
}

function renderRunCard(run) {
  const isSelected = run.id === state.selectedRunId;
  const className = isSelected ? 'run-card is-selected' : 'run-card';
  const counts = [
    metricChip('fresh', run.freshObservationCount),
    metricChip('seen', run.seenObservationCount),
    metricChip('listings', run.listingCount),
  ].join('');

  return `
    <button type="button" class="${className}" data-run-id="${escapeHtml(run.id)}">
      <div class="run-card-head">
        <div>
          <p class="run-id">${escapeHtml(run.id)}</p>
          <p class="run-meta">${escapeHtml(run.sourceKey)} · ${escapeHtml(run.runKind)} · ${escapeHtml(run.status)}</p>
        </div>
        <div class="badge-row">
          ${renderStatusBadge(run.status)}
          ${renderBadge(run.runKind, 'accent')}
        </div>
      </div>
      <div class="runs-metrics">
        ${counts}
      </div>
      <div class="meta-row subtle">
        <span>Started ${escapeHtml(formatDateTime(run.startedAt))}</span>
        <span>${escapeHtml(formatDuration(run.durationSeconds))}</span>
      </div>
    </button>
  `;
}

function renderDetailHeader() {
  const run = getSelectedRun();

  if (!run) {
    elements.detailHeader.className = 'detail-header empty-state';
    elements.detailHeader.textContent = 'Select a run to inspect.';
    return;
  }

  const cache = ensureRunCache(run.id);
  const validation = cache.overview?.validation;
  const issueCount = validation?.issues?.length || 0;

  elements.detailHeader.className = 'detail-header';
  elements.detailHeader.innerHTML = `
    <div class="record-header">
      <div>
        <h2>${escapeHtml(run.id)}</h2>
        <p>${escapeHtml(run.sourceDisplayName || run.sourceKey)} · ${escapeHtml(run.runKind)} · ${escapeHtml(run.status)}</p>
      </div>
      <div class="badge-row">
        ${renderStatusBadge(run.status)}
        ${renderBadge(`${run.freshObservationCount} fresh`, 'accent')}
        ${issueCount ? renderBadge(`${issueCount} issue${issueCount === 1 ? '' : 's'}`, 'danger') : renderBadge('validated', 'good')}
      </div>
    </div>
  `;
}

function renderSummaryStrip() {
  const run = getSelectedRun();

  if (!run) {
    elements.summaryStrip.innerHTML = '';
    return;
  }

  const cache = ensureRunCache(run.id);
  const validation = cache.overview?.validation;
  const summary = run.summary || {};

  elements.summaryStrip.innerHTML = `
    <section class="summary-card">
      <h3>Run Summary</h3>
      <div class="summary-grid">
        ${summaryTerm('Source key', run.sourceKey)}
        ${summaryTerm('Started', formatDateTime(run.startedAt))}
        ${summaryTerm('Finished', formatDateTime(run.finishedAt))}
        ${summaryTerm('Duration', formatDuration(run.durationSeconds))}
        ${summaryTerm('Fresh / Seen / Unknown', `${run.freshObservationCount} / ${run.seenObservationCount} / ${run.unidentifiedObservationCount}`)}
        ${summaryTerm('Listings / Steps / Artifacts', `${run.listingCount} / ${run.runStepCount} / ${run.artifactCount}`)}
      </div>
    </section>
    <section class="summary-card">
      <h3>Run Summary JSON</h3>
      <div class="summary-grid">
        ${summaryTerm('Collected', summary.collected ?? 'n/a')}
        ${summaryTerm('Fresh collected', summary.freshCollected ?? 'n/a')}
        ${summaryTerm('Seen collected', summary.seenCollected ?? 'n/a')}
        ${summaryTerm('Unknown collected', summary.unidentifiedCollected ?? 'n/a')}
        ${summaryTerm('Extracted listings', summary.extractedListings ?? 'n/a')}
        ${summaryTerm('With IDs', summary.withIds ?? 'n/a')}
      </div>
      <div class="link-row">
        ${run.collectedExportPath ? `<a href="/artifact-file?path=${encodeURIComponent(run.collectedExportPath)}" target="_blank" rel="noreferrer">Collected export</a>` : ''}
        ${run.listingsExportPath ? `<a href="/artifact-file?path=${encodeURIComponent(run.listingsExportPath)}" target="_blank" rel="noreferrer">Listings export</a>` : ''}
        ${run.sourceExternalUrl ? `<a href="${escapeHtml(run.sourceExternalUrl)}" target="_blank" rel="noreferrer">Group URL</a>` : ''}
      </div>
    </section>
    <section class="summary-card">
      <h3>Validation</h3>
      ${renderValidationSummary(validation, cache.loadingOverview, cache.overviewError)}
    </section>
  `;
}

function renderValidationSummary(validation, loading, error) {
  if (loading) {
    return '<div class="loading-state">Loading validation...</div>';
  }

  if (error) {
    return `<div class="empty-state">${escapeHtml(error)}</div>`;
  }

  if (!validation) {
    return '<div class="empty-state">Validation not loaded.</div>';
  }

  const counts = validation.counts || {};
  const issues = validation.issues || [];

  return `
    <div class="validation-grid">
      ${summaryTerm('DB listings', counts.listings)}
      ${summaryTerm('Summary listings', validation.summary?.extractedListings ?? 'n/a')}
      ${summaryTerm('Raw artifacts', counts.rawArtifacts)}
      ${summaryTerm('Healthy', validation.isHealthy ? 'yes' : 'no')}
    </div>
    ${issues.length ? `<ul class="issue-list">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : '<p class="subtle">No validation issues.</p>'}
  `;
}

function renderTabBar() {
  const run = getSelectedRun();

  if (!run) {
    elements.tabBar.innerHTML = '';
    return;
  }

  const tabs = [
    ['summary', 'Summary'],
    ['observations', 'Observations'],
    ['jobs', 'Jobs'],
    ['listings', 'Listings'],
    ['runSteps', 'Run Steps'],
    ['artifacts', 'Artifacts'],
  ];

  elements.tabBar.innerHTML = tabs.map(([key, label]) => {
    const activeClass = key === state.selectedTab ? 'tab-button is-active' : 'tab-button';
    return `<button type="button" class="${activeClass}" data-tab-key="${key}">${escapeHtml(label)}</button>`;
  }).join('');

  elements.tabBar.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const tabKey = button.dataset.tabKey;
      if (!TAB_KEYS.includes(tabKey)) {
        return;
      }

      state.selectedTab = tabKey;
      writeHash();
      render();

      if (tabKey !== 'summary' && state.selectedRunId) {
        await loadActiveTab(state.selectedRunId, tabKey);
      }
    });
  });
}

function renderTabFilters() {
  const run = getSelectedRun();

  if (!run || state.selectedTab === 'summary') {
    elements.tabFilters.innerHTML = '';
    return;
  }

  const cache = ensureRunCache(run.id);
  const tabPayload = cache.tabs[state.selectedTab];
  const items = tabPayload?.items || [];

  switch (state.selectedTab) {
    case 'observations':
      elements.tabFilters.innerHTML = `
        <div class="filter-row">
          <label class="field">
            <span>Freshness</span>
            <select data-filter-name="freshness">
              ${selectOptions(['', 'fresh', 'seen', 'unidentified'], state.tabFilters.observations.freshness, 'All')}
            </select>
          </label>
          <label class="field">
            <span>Search</span>
            <input data-filter-name="query" type="search" value="${escapeHtml(state.tabFilters.observations.query)}" placeholder="body, author, neighborhood">
          </label>
        </div>
      `;
      break;
    case 'jobs':
      elements.tabFilters.innerHTML = `
        <div class="filter-row">
          <label class="field">
            <span>Job status</span>
            <select data-filter-name="status">
              ${selectOptions(['', 'pending', 'processing', 'processed', 'retryable', 'failed'], state.tabFilters.jobs.status, 'All')}
            </select>
          </label>
          <label class="field">
            <span>Search</span>
            <input data-filter-name="query" type="search" value="${escapeHtml(state.tabFilters.jobs.query)}" placeholder="body, author, neighborhood">
          </label>
        </div>
      `;
      break;
    case 'listings': {
      const extractorVersions = ['', ...new Set(items.map((item) => item.extractorVersion).filter(Boolean))];
      elements.tabFilters.innerHTML = `
        <div class="filter-row">
          <label class="field">
            <span>Extractor</span>
            <select data-filter-name="extractorVersion">
              ${selectOptions(extractorVersions, state.tabFilters.listings.extractorVersion, 'All')}
            </select>
          </label>
          <label class="field">
            <span>Search</span>
            <input data-filter-name="query" type="search" value="${escapeHtml(state.tabFilters.listings.query)}" placeholder="body, neighborhood, ambiguities">
          </label>
        </div>
      `;
      break;
    }
    case 'runSteps':
      elements.tabFilters.innerHTML = `
        <div class="filter-row">
          <label class="field">
            <span>Search</span>
            <input data-filter-name="query" type="search" value="${escapeHtml(state.tabFilters.runSteps.query)}" placeholder="step index or stop reason">
          </label>
        </div>
      `;
      break;
    case 'artifacts': {
      const artifactKinds = ['', ...new Set(items.map((item) => item.artifactKind).filter(Boolean))];
      elements.tabFilters.innerHTML = `
        <div class="filter-row">
          <label class="field">
            <span>Artifact kind</span>
            <select data-filter-name="artifactKind">
              ${selectOptions(artifactKinds, state.tabFilters.artifacts.artifactKind, 'All')}
            </select>
          </label>
          <label class="field">
            <span>Search</span>
            <input data-filter-name="query" type="search" value="${escapeHtml(state.tabFilters.artifacts.query)}" placeholder="path, post ID, observation">
          </label>
        </div>
      `;
      break;
    }
    default:
      elements.tabFilters.innerHTML = '';
  }

  elements.tabFilters.querySelectorAll('[data-filter-name]').forEach((input) => {
    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      const filters = state.tabFilters[state.selectedTab];
      filters[input.dataset.filterName] = input.value;
      renderTabContent();
    });
  });
}

function renderTabContent() {
  const run = getSelectedRun();

  if (!run) {
    elements.tabContent.className = 'tab-content empty-state';
    elements.tabContent.textContent = 'Run details will appear here.';
    return;
  }

  if (state.selectedTab === 'summary') {
    renderSummaryTab(run);
    return;
  }

  const cache = ensureRunCache(run.id);
  const tabKey = state.selectedTab;
  const tabPayload = cache.tabs[tabKey];
  const isLoading = state.loading.tabs.has(`${run.id}:${tabKey}`);

  if (isLoading && !tabPayload) {
    elements.tabContent.className = 'tab-content loading-state';
    elements.tabContent.textContent = 'Loading...';
    return;
  }

  if (tabPayload?.error) {
    elements.tabContent.className = 'tab-content empty-state';
    elements.tabContent.textContent = tabPayload.error;
    return;
  }

  const items = getFilteredTabItems(run.id, tabKey);

  if (items.length === 0) {
    elements.tabContent.className = 'tab-content empty-state';
    elements.tabContent.textContent = 'No records match the current filters.';
    return;
  }

  elements.tabContent.className = 'tab-content';

  switch (tabKey) {
    case 'observations':
      elements.tabContent.innerHTML = items.map(renderObservationCard).join('');
      break;
    case 'jobs':
      elements.tabContent.innerHTML = items.map(renderJobCard).join('');
      break;
    case 'listings':
      elements.tabContent.innerHTML = items.map(renderListingCard).join('');
      break;
    case 'runSteps':
      elements.tabContent.innerHTML = renderRunStepsTable(items);
      break;
    case 'artifacts':
      elements.tabContent.innerHTML = renderArtifactsTable(items);
      break;
    default:
      elements.tabContent.innerHTML = '<div class="empty-state">Unknown tab.</div>';
  }
}

function renderSummaryTab(run) {
  const cache = ensureRunCache(run.id);
  const validation = cache.overview?.validation;
  const issues = validation?.issues || [];

  elements.tabContent.className = 'tab-content';
  elements.tabContent.innerHTML = `
    <section class="validation-card">
      <h3>Current Storage Counts</h3>
      ${validation ? `
        <div class="metric-grid">
          ${summaryTerm('Observations', validation.counts.observations)}
          ${summaryTerm('Fresh', validation.counts.freshObservations)}
          ${summaryTerm('Seen', validation.counts.seenObservations)}
          ${summaryTerm('Unknown', validation.counts.unidentifiedObservations)}
          ${summaryTerm('Listings', validation.counts.listings)}
          ${summaryTerm('Steps', validation.counts.runSteps)}
          ${summaryTerm('Artifacts', validation.counts.artifacts)}
          ${summaryTerm('Raw artifacts', validation.counts.rawArtifacts)}
        </div>
      ` : '<div class="loading-state">Validation still loading.</div>'}
    </section>
    <section class="validation-card">
      <h3>Validation Issues</h3>
      ${issues.length ? `<ul class="issue-list">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : '<p class="subtle">This run currently validates without issues.</p>'}
    </section>
    <section class="validation-card">
      <h3>Operator Notes</h3>
      <ul class="issue-list">
        <li>Run summary counts come from the original crawl summary JSON.</li>
        <li>Current listing counts come from SQLite and can diverge after later queue processing.</li>
        <li>Use the Listings tab to inspect mixed extractor provenance via <span class="mono">extractorVersion</span>.</li>
      </ul>
    </section>
  `;
}

function getFilteredRuns() {
  const query = state.runsFilter.query.trim().toLowerCase();

  return state.runs.filter((run) => {
    if (query) {
      const haystack = [
        run.id,
        run.sourceKey,
        run.sourceDisplayName,
        run.runKind,
        run.status,
        run.summary?.sourceKey,
      ].filter(Boolean).join(' ').toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    return true;
  });
}

function getFilteredTabItems(runId, tabKey) {
  const cache = ensureRunCache(runId);
  const items = cache.tabs[tabKey]?.items || [];

  switch (tabKey) {
    case 'observations':
      return items.filter((item) => filterObservation(item, state.tabFilters.observations));
    case 'jobs':
      return items.filter((item) => filterJob(item, state.tabFilters.jobs));
    case 'listings':
      return items.filter((item) => filterListing(item, state.tabFilters.listings));
    case 'runSteps':
      return items.filter((item) => filterRunStep(item, state.tabFilters.runSteps));
    case 'artifacts':
      return items.filter((item) => filterArtifact(item, state.tabFilters.artifacts));
    default:
      return items;
  }
}

function filterObservation(item, filters) {
  if (filters.freshness && item.freshness !== filters.freshness) {
    return false;
  }

  return matchesQuery(filters.query, [
    item.authorName,
    item.bodyText,
    item.bodyTextPreview,
    item.postUrl,
    item.platformPostId,
    item.derivedLocation?.neighborhood,
    item.derivedLocation?.borough,
    item.rawArtifactPath,
  ]);
}

function filterJob(item, filters) {
  if (filters.status && item.status !== filters.status) {
    return false;
  }

  const extractedListings = item.processedPayload?.extracted?.listings || [];
  const processedText = extractedListings.map((listing) => [
    listing.location?.neighborhood,
    listing.location?.borough,
    listing.notes?.summary,
    ...(listing.notes?.ambiguities || []),
  ].filter(Boolean).join(' ')).join(' ');

  return matchesQuery(filters.query, [
    item.authorName,
    item.postUrl,
    item.platformPostId,
    item.observationPayload?.bodyText,
    processedText,
    item.processedPayload?.processing?.status,
  ]);
}

function filterListing(item, filters) {
  if (filters.extractorVersion && item.extractorVersion !== filters.extractorVersion) {
    return false;
  }

  return matchesQuery(filters.query, [
    item.authorName,
    item.postUrl,
    item.listingType,
    item.postIntent,
    item.borough,
    item.neighborhood,
    item.payload?.notes?.summary,
    ...(item.payload?.notes?.ambiguities || []),
    item.payload?.location?.rawText,
  ]);
}

function filterRunStep(item, filters) {
  return matchesQuery(filters.query, [
    item.stepIndex,
    item.stoppedReason,
    item.scrollY,
    item.bodyHeight,
  ]);
}

function filterArtifact(item, filters) {
  if (filters.artifactKind && item.artifactKind !== filters.artifactKind) {
    return false;
  }

  return matchesQuery(filters.query, [
    item.relativePath,
    item.platformPostId,
    item.observationId,
    item.artifactKind,
    item.observationFreshness,
  ]);
}

function matchesQuery(query, values) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return values
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase()
    .includes(normalized);
}

function renderObservationCard(item) {
  return `
    <article class="record-card">
      <div class="record-header">
        <div>
          <h4>${escapeHtml(item.authorName || 'Unknown author')}</h4>
          <p class="record-subtitle">${escapeHtml(item.postedAtText || 'No relative time')} · ${escapeHtml(item.freshness)} · ${escapeHtml(item.platformPostId || item.id)}</p>
        </div>
        <div class="badge-row">
          ${renderBadge(item.freshness, observationBadgeTone(item.freshness))}
          ${item.stablePostTimesSeen ? renderBadge(`${item.stablePostTimesSeen}x seen`, 'accent') : ''}
        </div>
      </div>
      <div class="stack">
        <p class="body-text">${escapeHtml(item.bodyText || item.bodyTextPreview || 'No body text captured.')}</p>
        <div class="kv-list">
          ${kvItem('Post URL', renderLink(item.postUrl))}
          ${kvItem('Raw artifact', item.rawArtifactPath ? `<a href="/artifact-file?path=${encodeURIComponent(item.rawArtifactPath)}" target="_blank" rel="noreferrer">${escapeHtml(item.rawArtifactPath)}</a>` : 'n/a')}
          ${kvItem('Captured at', escapeHtml(formatDateTime(item.capturedAt)))}
          ${kvItem('Neighborhood', escapeHtml(formatNeighborhood(item.derivedLocation)))}
        </div>
      </div>
      <details class="json-block">
        <summary>Observation JSON</summary>
        <pre>${renderJson(item)}</pre>
      </details>
    </article>
  `;
}

function renderJobCard(item) {
  const listings = item.processedPayload?.extracted?.listings || [];
  const overallAmbiguities = item.processedPayload?.extracted?.structuredData?.overallAmbiguities
    || item.processedPayload?.extracted?.overallAmbiguities
    || [];

  return `
    <article class="record-card">
      <div class="record-header">
        <div>
          <h4>${escapeHtml(item.authorName || item.observationId)}</h4>
          <p class="record-subtitle">${escapeHtml(item.status)} · ${escapeHtml(item.observationId)} · ${escapeHtml(item.processedListingCount ?? 0)} listing(s)</p>
        </div>
        <div class="badge-row">
          ${renderStatusBadge(item.status)}
          ${renderBadge(item.processorVersion, 'accent')}
          ${renderBadge(item.schemaVersion, 'accent')}
          ${renderBadge(item.modelName, 'accent')}
        </div>
      </div>
      <div class="comparison-grid">
        <section class="comparison-pane">
          <h4>Observation Input</h4>
          <div class="stack">
            <div class="kv-list">
              ${kvItem('Post URL', renderLink(item.postUrl))}
              ${kvItem('Captured at', escapeHtml(formatDateTime(item.capturedAt)))}
              ${kvItem('Posted at text', escapeHtml(item.postedAtText || 'n/a'))}
              ${kvItem('Raw artifact', item.observationPayload?.rawArtifactPath ? `<a href="/artifact-file?path=${encodeURIComponent(item.observationPayload.rawArtifactPath)}" target="_blank" rel="noreferrer">${escapeHtml(item.observationPayload.rawArtifactPath)}</a>` : 'n/a')}
            </div>
            <p class="body-text">${escapeHtml(item.observationPayload?.bodyText || 'No observation body available.')}</p>
          </div>
        </section>
        <section class="comparison-pane">
          <h4>Processed Output</h4>
          ${item.processedPayload ? `
            <div class="stack">
              <div class="kv-list">
                ${kvItem('Processed at', escapeHtml(formatDateTime(item.processedAt)))}
                ${kvItem('Listing count', escapeHtml(item.processedListingCount ?? 0))}
                ${kvItem('Latency', escapeHtml(formatMilliseconds(item.processedPayload.processing?.latencyMs)))}
                ${kvItem('Claimed by', escapeHtml(item.processedPayload.processing?.claimedBy || item.claimedBy || 'n/a'))}
              </div>
              ${listings.length ? `<div class="stack">${listings.map(renderMiniListing).join('')}</div>` : '<p class="subtle">No extracted listings stored for this job.</p>'}
              ${overallAmbiguities.length ? `<ul class="issue-list">${overallAmbiguities.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
            </div>
          ` : '<p class="subtle">This job has no processed payload yet.</p>'}
        </section>
      </div>
      <details class="json-block">
        <summary>Job JSON</summary>
        <pre>${renderJson(item)}</pre>
      </details>
    </article>
  `;
}

function renderListingCard(item) {
  const payload = item.payload || {};
  const ambiguities = payload.notes?.ambiguities || [];

  return `
    <article class="record-card">
      <div class="record-header">
        <div>
          <h4>${escapeHtml(item.listingType)} · ${escapeHtml(item.postIntent)}</h4>
          <p class="record-subtitle">${escapeHtml(item.authorName || item.observationId)} · ${escapeHtml(item.neighborhood || item.borough || 'Unknown area')}</p>
        </div>
        <div class="badge-row">
          ${renderBadge(item.extractorVersion || 'unknown extractor', item.extractorVersion?.includes('gemini') ? 'good' : 'warn')}
          ${renderBadge(`confidence ${item.confidenceOverall ?? 0}`, 'accent')}
          ${renderBadge(`ordinal ${item.ordinal}`, 'accent')}
        </div>
      </div>
      <div class="fact-grid">
        ${summaryTerm('Price', formatPrice(item.priceAmount, item.pricePeriod))}
        ${summaryTerm('Rooms', formatRooms(payload.rooms))}
        ${summaryTerm('Dates', formatDates(payload.dates))}
        ${summaryTerm('Neighborhood', item.neighborhood || item.borough || 'n/a')}
      </div>
      <p class="body-preview">${escapeHtml(payload.notes?.summary || 'No summary available.')}</p>
      ${ambiguities.length ? `<ul class="issue-list">${ambiguities.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
      <div class="link-row">
        ${renderLink(item.postUrl)}
        ${payload.source?.rawArtifactPath ? `<a href="/artifact-file?path=${encodeURIComponent(payload.source.rawArtifactPath)}" target="_blank" rel="noreferrer">Raw artifact</a>` : ''}
      </div>
      <details class="json-block">
        <summary>Listing JSON</summary>
        <pre>${renderJson(item)}</pre>
      </details>
    </article>
  `;
}

function renderRunStepsTable(items) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Visible</th>
            <th>Added</th>
            <th>Fresh</th>
            <th>Seen</th>
            <th>Unknown</th>
            <th>Cumulative</th>
            <th>Scroll Y</th>
            <th>Body Height</th>
            <th>Stopped</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td class="mono">${escapeHtml(item.stepIndex)}</td>
              <td>${escapeHtml(item.visiblePosts ?? 'n/a')}</td>
              <td>${escapeHtml(item.addedCount ?? 'n/a')}</td>
              <td>${escapeHtml(item.freshCount ?? 'n/a')}</td>
              <td>${escapeHtml(item.seenCount ?? 'n/a')}</td>
              <td>${escapeHtml(item.unidentifiedCount ?? 'n/a')}</td>
              <td class="mono">${escapeHtml(`${item.freshCollected ?? 0}/${item.seenCollected ?? 0}/${item.unidentifiedCollected ?? 0}`)}</td>
              <td class="mono">${escapeHtml(item.scrollY ?? 'n/a')}</td>
              <td class="mono">${escapeHtml(item.bodyHeight ?? 'n/a')}</td>
              <td>${escapeHtml(item.stoppedReason || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderArtifactsTable(items) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Freshness</th>
            <th>Observation</th>
            <th>Post ID</th>
            <th>Path</th>
            <th>Size</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.artifactKind)}</td>
              <td>${escapeHtml(item.observationFreshness || '')}</td>
              <td class="mono">${escapeHtml(item.observationId || '')}</td>
              <td class="mono">${escapeHtml(item.platformPostId || '')}</td>
              <td><a href="/artifact-file?path=${encodeURIComponent(item.relativePath)}" target="_blank" rel="noreferrer">${escapeHtml(item.relativePath)}</a></td>
              <td class="mono">${escapeHtml(formatBytes(item.byteSize))}</td>
              <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMiniListing(listing) {
  return `
    <div class="info-card">
      <h3>${escapeHtml(listing.listingType || 'unknown')} · ${escapeHtml(listing.postIntent || 'unknown')}</h3>
      <div class="fact-grid">
        ${summaryTerm('Location', listing.location?.neighborhood || listing.location?.borough || listing.location?.rawText || 'n/a')}
        ${summaryTerm('Price', formatPrice(listing.pricing?.amount, listing.pricing?.period))}
        ${summaryTerm('Dates', formatDates(listing.dates))}
        ${summaryTerm('Confidence', listing.confidence?.overall ?? 'n/a')}
      </div>
      <p class="body-preview">${escapeHtml(listing.notes?.summary || 'No summary available.')}</p>
    </div>
  `;
}

function renderStatusBadge(status) {
  return renderBadge(status, `status-${status}`);
}

function renderBadge(text, tone) {
  return `<span class="badge ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function summaryTerm(label, value) {
  return `
    <div>
      <div class="summary-term">${escapeHtml(label)}</div>
      <div class="summary-value">${escapeHtml(String(value ?? 'n/a'))}</div>
    </div>
  `;
}

function metricChip(label, value) {
  return `
    <div class="metric-chip">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? 0))}</strong>
    </div>
  `;
}

function kvItem(label, valueHtml) {
  return `
    <dl class="kv-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${valueHtml || 'n/a'}</dd>
    </dl>
  `;
}

function renderLink(url) {
  if (!url) {
    return 'n/a';
  }

  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
}

function renderJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function formatDateTime(value) {
  if (!value) {
    return 'n/a';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return 'n/a';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatMilliseconds(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value}ms`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPrice(amount, period) {
  if (!Number.isFinite(amount)) {
    return period ? `n/a / ${period}` : 'n/a';
  }

  return `$${amount}${period ? ` / ${period}` : ''}`;
}

function formatRooms(rooms) {
  if (!rooms) {
    return 'n/a';
  }

  const pieces = [];
  if (Number.isFinite(rooms.roomsAvailable)) {
    pieces.push(`${rooms.roomsAvailable} avail`);
  }
  if (Number.isFinite(rooms.totalBedrooms)) {
    pieces.push(`${rooms.totalBedrooms} bed`);
  }
  if (Number.isFinite(rooms.bathrooms)) {
    pieces.push(`${rooms.bathrooms} bath`);
  }

  return pieces.length ? pieces.join(' · ') : 'n/a';
}

function formatDates(dates) {
  if (!dates) {
    return 'n/a';
  }

  const pieces = [dates.availableFrom, dates.availableTo].filter(Boolean);
  if (pieces.length) {
    return pieces.join(' -> ');
  }

  return dates.leaseTermText || 'n/a';
}

function formatNeighborhood(derivedLocation) {
  if (!derivedLocation) {
    return 'n/a';
  }

  return [derivedLocation.neighborhood, derivedLocation.borough].filter(Boolean).join(', ') || 'n/a';
}

function getSelectedRun() {
  return state.runs.find((run) => run.id === state.selectedRunId) || null;
}

function observationBadgeTone(freshness) {
  switch (freshness) {
    case 'fresh':
      return 'good';
    case 'seen':
      return 'accent';
    case 'unidentified':
      return 'warn';
    default:
      return 'accent';
  }
}

function selectOptions(values, currentValue, emptyLabel) {
  return values.map((value) => {
    const label = value || emptyLabel;
    const selected = value === currentValue ? ' selected' : '';
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

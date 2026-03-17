import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useDashboardShellSlots } from '../../app/shell-context.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import {
  FilterBar,
  FilterField,
  FilterInput,
  FilterSelect,
  FilterToggle,
} from '../../components/FilterControls.jsx';
import { JsonDetails } from '../../components/JsonDetails.jsx';
import { RoutePagination } from '../../components/RoutePagination.jsx';
import { RouteScaffold } from '../../components/RouteScaffold.jsx';
import { ErrorState, LoadingState } from '../../components/StateViews.jsx';
import {
  formatAbsoluteTime,
  formatCompactCount,
  formatConfidence,
  formatCount,
  formatLabel,
  formatPrice,
  formatRelativeTime,
  formatRoomCount,
} from '../../lib/formatters.js';
import { useUrlQueryState } from '../../lib/use-url-query-state.js';
import {
  POSTED_WITHIN_OPTIONS,
  buildApiUrl,
  useDashboardSourceOptions,
  useJsonResource,
} from '../shared/route-support.jsx';

const LISTINGS_QUERY_SCHEMA = {
  bathsMin: { defaultValue: null, type: 'number' },
  bedsMin: { defaultValue: null, type: 'number' },
  borough: { defaultValue: '' },
  detail: { defaultValue: 'open' },
  freshness: { defaultValue: '' },
  hasAmbiguities: { defaultValue: '' },
  listingId: { defaultValue: '' },
  listingType: { defaultValue: '' },
  minConfidence: { defaultValue: null, type: 'number' },
  neighborhood: { defaultValue: '' },
  page: { defaultValue: 1, type: 'number' },
  pageSize: { defaultValue: 25, type: 'number' },
  postedWithinHours: { defaultValue: null, type: 'number' },
  priceMax: { defaultValue: null, type: 'number' },
  priceMin: { defaultValue: null, type: 'number' },
  q: { defaultValue: '' },
  sort: { defaultValue: 'newest' },
  sourceKey: { defaultValue: '' },
};

const LISTING_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'confidence-desc', label: 'Confidence: high to low' },
  { value: 'confidence-asc', label: 'Confidence: low to high' },
];

const LISTING_TYPE_OPTIONS = [
  '',
  'entire_apartment',
  'lease_takeover',
  'room_in_shared',
  'roommate_search',
  'short_term',
  'sublet',
  'unknown',
];

const BOROUGH_OPTIONS = ['', 'Brooklyn', 'Queens', 'Manhattan'];
const MIN_CONFIDENCE_OPTIONS = [
  { value: '', label: 'Any confidence' },
  { value: '0.5', label: '50% or higher' },
  { value: '0.75', label: '75% or higher' },
  { value: '0.9', label: '90% or higher' },
];

const DEFAULT_LISTINGS_QUERY_PATCH = Object.freeze({
  bathsMin: null,
  bedsMin: null,
  borough: '',
  freshness: '',
  hasAmbiguities: '',
  listingId: '',
  listingType: '',
  minConfidence: null,
  neighborhood: '',
  page: 1,
  pageSize: 25,
  postedWithinHours: null,
  priceMax: null,
  priceMin: null,
  q: '',
  sort: 'newest',
  sourceKey: '',
});

const columnHelper = createColumnHelper();

function buildListingsColumns(lowConfidenceThreshold) {
  return [
    columnHelper.accessor('postedAt', {
      cell: ({ getValue, row }) => {
        const postedLabel = row.original.postedAtText
          ? `${formatAbsoluteTime(getValue())} · ${row.original.postedAtText}`
          : formatAbsoluteTime(getValue());

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="cell-primary-truncate">{formatRelativeTime(getValue())}</strong>
            <span className="cell-meta cell-meta-truncate" title={postedLabel}>
              {postedLabel}
            </span>
          </div>
        );
      },
      header: 'Posted',
      meta: { className: 'column-tight listings-column-posted' },
    }),
    columnHelper.accessor('listingSummary', {
      cell: ({ getValue, row }) => {
        const summary = String(getValue() || '').trim() || 'No summary captured';
        const listingMeta = buildListingSubline(row.original);

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="listings-title-clamp" title={summary}>
              {summary}
            </strong>
            {listingMeta ? (
              <span className="cell-meta cell-meta-truncate" title={listingMeta}>
                {listingMeta}
              </span>
            ) : null}
          </div>
        );
      },
      header: 'Listing',
      meta: { className: 'listings-column-listing' },
    }),
    columnHelper.display({
      cell: ({ row }) => {
        const priceMeta = buildPriceSubline(row.original);

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="cell-primary-truncate">{formatListingPrice(row.original)}</strong>
            {priceMeta ? (
              <span className="cell-meta cell-meta-truncate" title={priceMeta}>
                {priceMeta}
              </span>
            ) : null}
          </div>
        );
      },
      header: 'Price',
      id: 'price',
      meta: { className: 'column-tight listings-column-price' },
    }),
    columnHelper.display({
      cell: ({ row }) => {
        const roomMeta = buildRoomSubline(row.original);

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="cell-primary-truncate">{formatListingRooms(row.original)}</strong>
            {roomMeta ? (
              <span className="cell-meta cell-meta-truncate" title={roomMeta}>
                {roomMeta}
              </span>
            ) : null}
          </div>
        );
      },
      header: 'Rooms',
      id: 'rooms',
      meta: { className: 'column-tight listings-column-rooms' },
    }),
    columnHelper.display({
      cell: ({ row }) => {
        const location = formatListingLocation(row.original);
        const locationMeta = buildLocationSubline(row.original);

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="cell-primary-truncate" title={location}>{location}</strong>
            {locationMeta ? (
              <span className="cell-meta cell-meta-truncate" title={locationMeta}>
                {locationMeta}
              </span>
            ) : null}
          </div>
        );
      },
      header: 'Location',
      id: 'location',
      meta: { className: 'column-tight listings-column-location' },
    }),
    columnHelper.accessor('sourceDisplayName', {
      cell: ({ getValue, row }) => {
        const sourceLabel = getValue() || row.original.sourceKey;
        const authorLabel = row.original.authorName || 'Unknown author';

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className="cell-primary-truncate" title={sourceLabel}>{sourceLabel}</strong>
            <span className="cell-meta cell-meta-truncate" title={authorLabel}>
              {authorLabel}
            </span>
          </div>
        );
      },
      header: 'Source',
      meta: { className: 'listings-column-source' },
    }),
    columnHelper.display({
      cell: ({ row }) => {
        const review = describeListingReview(row.original, lowConfidenceThreshold);

        return (
          <div className="cell-stack cell-stack-dense">
            <strong className={`cell-status ${review.toneClass}`}>{review.label}</strong>
            <span className="cell-meta cell-meta-truncate" title={review.meta}>
              {review.meta}
            </span>
          </div>
        );
      },
      header: 'Review',
      id: 'review',
      meta: { className: 'column-tight listings-column-review' },
    }),
  ];
}

export function ListingsRoute() {
  const [queryState, setQueryState] = useUrlQueryState(LISTINGS_QUERY_SCHEMA);
  const [searchDraft, setSearchDraft] = useState(queryState.q);
  const [showMoreFilters, setShowMoreFilters] = useState(() => hasActiveAdvancedFilters(queryState));
  const queryActions = useMemo(
    () => createListingsQueryActions(setQueryState),
    [setQueryState],
  );

  useEffect(() => {
    setSearchDraft(queryState.q);
  }, [queryState.q]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (searchDraft === queryState.q) {
        return;
      }

      queryActions.updateFilters({ q: searchDraft });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [queryActions, queryState.q, searchDraft]);

  const listingsState = useJsonResource(buildListingsListUrl(queryState));
  const { sourceOptions } = useDashboardSourceOptions();
  const sourceOptionsSignature = useMemo(
    () => sourceOptions.map((option) => `${option.value}:${option.label}`).join('|'),
    [sourceOptions],
  );
  const reviewState = useJsonResource(buildReviewSummaryUrl(queryState));

  const listingsResponse = listingsState.data;
  const listItems = listingsResponse?.items || [];
  const selectedRow = listItems.find((row) => row.listingId === queryState.listingId) || null;
  const listingDetailState = useJsonResource(
    queryState.listingId ? buildListingDetailUrl(queryState.listingId) : null,
  );
  const selectedDetail = listingDetailState.data?.selectedVariantId === queryState.listingId
    ? listingDetailState.data
    : null;
  const selectedListing = selectedDetail?.listing || selectedRow || null;
  const selectedObservation = selectedDetail?.observation || selectedRow || null;
  const selectedListingOffPage = Boolean(queryState.listingId && !selectedRow && selectedDetail);
  const lowConfidenceThreshold = reviewState.data?.thresholds?.lowConfidence || 0.75;
  const pageLabel = getSortLabel(queryState.sort);
  const columns = useMemo(
    () => buildListingsColumns(lowConfidenceThreshold),
    [lowConfidenceThreshold],
  );
  const advancedFilterCount = countActiveAdvancedFilters(queryState);
  const resultsSummary = useMemo(() => buildListingsResultsSummary({
    error: listingsState.error,
    isRefreshing: listingsState.isLoading,
    pagination: listingsResponse?.pagination,
    sortLabel: pageLabel,
  }), [
    listingsResponse?.pagination?.page,
    listingsResponse?.pagination?.totalItems,
    listingsResponse?.pagination?.totalPages,
    listingsState.error?.message,
    listingsState.isLoading,
    pageLabel,
  ]);

  useEffect(() => {
    if (!listItems.length || queryState.listingId) {
      return;
    }

    queryActions.syncSelectedListing(listItems[0].listingId, { replace: true });
  }, [listItems, queryActions, queryState.listingId]);

  useEffect(() => {
    const totalPages = listingsResponse?.pagination?.totalPages || 0;

    if (!totalPages || queryState.page <= totalPages) {
      return;
    }

    queryActions.clampPage(totalPages, { replace: true });
  }, [listingsResponse, queryActions, queryState.page]);

  useEffect(() => {
    if (advancedFilterCount > 0) {
      setShowMoreFilters(true);
    }
  }, [advancedFilterCount]);

  const toolbar = useMemo(() => {
    const toolbarActiveFilterChips = buildActiveFilterChips(queryState, sourceOptions);

    return (
      <div className="listings-toolbar">
        <div className="listings-filter-row">
          <FilterBar>
            <FilterField grow label="Search">
              <FilterInput
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Summary, author, neighborhood, or source"
                type="search"
                value={searchDraft}
              />
            </FilterField>

            <FilterField label="Source">
              <FilterSelect
                onChange={(event) =>
                  queryActions.updateFilters({ sourceKey: event.target.value })
                }
                value={queryState.sourceKey}
              >
                <option value="">All groups</option>
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>

            <FilterField label="Posted">
              <FilterSelect
                onChange={(event) =>
                  queryActions.updateFilters({
                    postedWithinHours: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
                value={queryState.postedWithinHours ?? ''}
              >
                {POSTED_WITHIN_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>

            <FilterField label="Price">
              <div className="listings-filter-pair">
                <FilterInput
                  inputMode="numeric"
                  onChange={(event) =>
                    queryActions.updateFilters({
                      priceMin: event.target.value.trim()
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  placeholder="Min"
                  type="number"
                  value={queryState.priceMin ?? ''}
                />
                <FilterInput
                  inputMode="numeric"
                  onChange={(event) =>
                    queryActions.updateFilters({
                      priceMax: event.target.value.trim()
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  placeholder="Max"
                  type="number"
                  value={queryState.priceMax ?? ''}
                />
              </div>
            </FilterField>

            <FilterField label="Beds">
              <FilterInput
                inputMode="numeric"
                onChange={(event) =>
                  queryActions.updateFilters({
                    bedsMin: event.target.value.trim()
                      ? Number(event.target.value)
                      : null,
                  })
                }
                placeholder="Any"
                type="number"
                value={queryState.bedsMin ?? ''}
              />
            </FilterField>

            <FilterField label="Neighborhood">
              <FilterInput
                onChange={(event) =>
                  queryActions.updateFilters({ neighborhood: event.target.value })
                }
                placeholder="Williamsburg"
                type="search"
                value={queryState.neighborhood}
              />
            </FilterField>

            <FilterField label="Sort">
              <FilterSelect
                onChange={(event) =>
                  queryActions.updateFilters({ sort: event.target.value })
                }
                value={queryState.sort}
              >
                {LISTING_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>

            <div className="listings-filter-actions">
              <button
                aria-controls="listings-more-filters"
                aria-expanded={showMoreFilters}
                className="shell-button shell-button-quiet listings-filter-toggle-button"
                onClick={() => setShowMoreFilters((currentValue) => !currentValue)}
                type="button"
              >
                {showMoreFilters ? 'Hide extra filters' : 'More filters'}
              </button>
              <button
                className="shell-button shell-button-quiet listings-filter-clear-button"
                onClick={() => {
                  setSearchDraft('');
                  setShowMoreFilters(false);
                  queryActions.clearFilters();
                }}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </FilterBar>
        </div>

        <div className="listings-active-filters">
          <p className="listings-active-filters-copy">
            {toolbarActiveFilterChips.length
              ? `${formatCount(toolbarActiveFilterChips.length, 'active filter')} · ${pageLabel}`
              : `Default scope · ${pageLabel}`}
          </p>

          {toolbarActiveFilterChips.length ? (
            <div className="listings-filter-chip-list" aria-label="Active listing filters">
              {toolbarActiveFilterChips.map((chip) => (
                <button
                  className="listings-filter-chip"
                  key={chip.key}
                  onClick={() => queryActions.updateFilters(chip.clearState)}
                  type="button"
                >
                  <span>{chip.label}</span>
                  <span aria-hidden="true" className="listings-filter-chip-dismiss">×</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {showMoreFilters ? (
          <div className="listings-filter-row listings-filter-row-advanced" id="listings-more-filters">
            <FilterBar>
              <FilterField label="Borough">
                <FilterSelect
                  onChange={(event) =>
                    queryActions.updateFilters({ borough: event.target.value })
                  }
                  value={queryState.borough}
                >
                  {BOROUGH_OPTIONS.map((value) => (
                    <option key={value || 'all'} value={value}>
                      {value || 'All boroughs'}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>

              <FilterField label="Listing type">
                <FilterSelect
                  onChange={(event) =>
                    queryActions.updateFilters({ listingType: event.target.value })
                  }
                  value={queryState.listingType}
                >
                  {LISTING_TYPE_OPTIONS.map((value) => (
                    <option key={value || 'all'} value={value}>
                      {value ? formatLabel(value) : 'All types'}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>

              <FilterField label="Freshness">
                <FilterSelect
                  onChange={(event) =>
                    queryActions.updateFilters({ freshness: event.target.value })
                  }
                  value={queryState.freshness}
                >
                  <option value="">Any freshness</option>
                  <option value="fresh">Fresh</option>
                  <option value="seen">Seen</option>
                </FilterSelect>
              </FilterField>

              <FilterField label="Min confidence">
                <FilterSelect
                  onChange={(event) =>
                    queryActions.updateFilters({
                      minConfidence: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  value={queryState.minConfidence ?? ''}
                >
                  {MIN_CONFIDENCE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FilterSelect>
              </FilterField>

              <FilterField label="Baths">
                <FilterInput
                  inputMode="numeric"
                  onChange={(event) =>
                    queryActions.updateFilters({
                      bathsMin: event.target.value.trim()
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  placeholder="Any"
                  type="number"
                  value={queryState.bathsMin ?? ''}
                />
              </FilterField>

              <div className="listings-filter-toggle-wrap">
                <FilterToggle
                  checked={queryState.hasAmbiguities === 'true'}
                  label="Needs review"
                  onChange={(checked) =>
                    queryActions.updateFilters({
                      hasAmbiguities: checked ? 'true' : '',
                    })
                  }
                />
              </div>
            </FilterBar>
          </div>
        ) : null}
      </div>
    );
  }, [
    pageLabel,
    queryState.bathsMin,
    queryState.bedsMin,
    queryState.borough,
    queryState.freshness,
    queryState.hasAmbiguities,
    queryState.listingType,
    queryState.minConfidence,
    queryState.neighborhood,
    queryState.postedWithinHours,
    queryState.priceMax,
    queryState.priceMin,
    queryState.q,
    queryState.sort,
    queryState.sourceKey,
    searchDraft,
    queryActions,
    showMoreFilters,
    sourceOptionsSignature,
  ]);

  const detailContent = useMemo(() => {
    if (!queryState.listingId) {
      return null;
    }

    if (selectedDetail) {
      return <ListingsDetail detail={selectedDetail} />;
    }

    if (listingDetailState.isLoading) {
      return (
        <LoadingState
          message="Loading the selected listing, source preview, and review handoffs."
          title="Loading listing detail"
        />
      );
    }

    if (listingDetailState.error) {
      return (
        <ErrorState
          message={listingDetailState.error.message}
          title="Could not load this listing"
        />
      );
    }

    return null;
  }, [
    listingDetailState.error,
    listingDetailState.isLoading,
    queryState.listingId,
    selectedDetail,
  ]);

  const shellState = useMemo(() => {
    const reviewLinkHref = selectedListing?.reviewLinkTarget
      ? buildReviewLinkTargetUrl(selectedListing.reviewLinkTarget)
      : null;
    const sourceLabel = selectedObservation?.sourceDisplayName || selectedObservation?.sourceKey || '';
    const authorLabel = selectedObservation?.authorName || 'Unknown author';
    const postedAt = selectedObservation?.postedAt || selectedListing?.postedAt || null;

    return {
      description: 'Scan recent cross-group listings, keep source context close, and jump into evidence or Review when a row needs a second pass. Corrections stay in Review so Listings remains read-only.',
      detailActions: selectedObservation ? (
        <>
          {selectedListing?.postUrl ? (
            <a href={selectedListing.postUrl} rel="noreferrer" target="_blank">
              View Facebook post
            </a>
          ) : null}
          <Link to={`/posts?observationId=${encodeURIComponent(selectedObservation.observationId)}&detail=open`}>
            Open post evidence view
          </Link>
          {reviewLinkHref ? (
            <Link to={reviewLinkHref}>Open related review queue</Link>
          ) : null}
        </>
      ) : null,
      detailContent,
      detailEmptyMessage: queryState.listingId
        ? 'The selected listing is outside the current page or no longer matches this scope.'
        : 'Select a listing row to inspect normalized facts, source context, and review handoffs.',
      detailEmptyTitle: 'Select a listing',
      detailMeta: selectedObservation ? (
        <div className="detail-meta-list">
          {sourceLabel ? <span className="detail-meta-item">{sourceLabel}</span> : null}
          <span className="detail-meta-item">{authorLabel}</span>
          <span
            className="detail-meta-item"
            title={postedAt ? formatAbsoluteTime(postedAt) : 'Posted time unavailable'}
          >
            {postedAt ? `Posted ${formatRelativeTime(postedAt)}` : 'Posted time unknown'}
          </span>
          {selectedListingOffPage ? (
            <span className="detail-meta-item detail-meta-item-warning">Outside current page</span>
          ) : null}
        </div>
      ) : null,
      detailTitle: selectedListing?.listingSummary || 'Listing detail',
      eyebrow: 'Listings workspace',
      title: 'Listings',
      toolbar,
    };
  }, [
    detailContent,
    queryState.listingId,
    selectedListing,
    selectedListingOffPage,
    selectedObservation,
    toolbar,
  ]);

  useDashboardShellSlots(shellState);

  return (
    <RouteScaffold
      footer={selectedListingOffPage ? 'Open detail is outside this page.' : null}
    >
      {listingsState.isLoading && !listingsResponse ? (
        <LoadingState
          message="Loading the newest cross-group listings and current filter scope."
          title="Loading listings"
        />
      ) : null}

      {listingsState.error && !listingsResponse ? (
        <ErrorState
          message={listingsState.error.message}
          title="Could not load listings"
        />
      ) : null}

      {listingsResponse ? (
        <>
          <div className="listings-results-bar">
            <p aria-live="polite" className="listings-results-copy">{resultsSummary}</p>
          </div>

          <DataTable
            ariaLabel="Listings table"
            className="listings-table-shell"
            columns={columns}
            data={listItems}
            emptyMessage="No listings matched the current filters. Widen the search or clear one of the tighter constraints."
            emptyTitle="No matching listings"
            getRowId={(row) => row.listingId}
            isLoading={listingsState.isLoading}
            onRowSelect={(row) => queryActions.openDetail(row.listingId)}
            selectedRowId={queryState.listingId}
          />

          <RoutePagination
            className="listings-pagination-compact"
            count={listItems.length}
            isRefreshing={listingsState.isLoading}
            onNext={() => queryActions.setPage(queryState.page + 1)}
            onPageSizeChange={(nextPageSize) =>
              queryActions.setPageSize(nextPageSize)
            }
            onPrevious={() =>
              queryActions.setPage(Math.max(1, queryState.page - 1))
            }
            pagination={listingsResponse.pagination}
          />
        </>
      ) : null}
    </RouteScaffold>
  );
}

function ListingsDetail({ detail }) {
  const listing = detail.listing;
  const observation = detail.observation;

  return (
    <article className="detail-stack">
      <section className="detail-section">
        <h3>Listing facts</h3>
        <p className="detail-body-text">{listing.listingSummary || 'No normalized summary captured.'}</p>
        <dl className="detail-facts">
          <div>
            <dt>Price</dt>
            <dd>{formatListingPrice(listing)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{formatListingLocation(listing)}</dd>
          </div>
          <div>
            <dt>Rooms</dt>
            <dd>
              {formatRoomCount(resolveBeds(listing), 'bed')}
              {' · '}
              {listing.baths === null || listing.baths === undefined
                ? 'Baths not stated'
                : formatRoomCount(listing.baths, 'bath')}
            </dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{listing.availableFrom || 'Not stated'}</dd>
          </div>
          <div>
            <dt>Listing type</dt>
            <dd>{formatLabel(listing.listingType)}</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{formatLabel(listing.intent)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(listing.confidenceOverall)}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{formatLabel(listing.freshness)}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{formatAbsoluteTime(listing.postedAt)}</dd>
          </div>
          <div>
            <dt>Extractor</dt>
            <dd>{listing.extractorVersion || 'Unknown extractor'}</dd>
          </div>
        </dl>

      {listing.ambiguities.length ? (
          <ul className="detail-pill-list" aria-label="Extractor ambiguities">
            {listing.ambiguities.map((ambiguity) => (
              <li className="detail-pill" key={ambiguity}>{ambiguity}</li>
            ))}
          </ul>
        ) : (
          <p className="detail-note">This selected variant has no extractor ambiguity notes.</p>
        )}
      </section>

      {listing.locationFieldStates?.length ? (
        <section className="detail-section">
          <h3>Layered location values</h3>
          <p className="detail-note">{formatLocationResolutionSummary(listing.locationResolutionSummary)}</p>
          <div className="detail-card-grid">
            {listing.locationFieldStates.map((fieldState) => (
              <article className="detail-card" key={fieldState.fieldPath}>
                <p className="detail-card-title">{fieldState.label}</p>
                <p className="detail-card-copy">{formatFieldStateWinningLine(fieldState)}</p>
                <p className="detail-card-copy">{formatFieldStateResolvedLine(fieldState)}</p>
                <p className="detail-card-copy">{formatFieldStateRawLine(fieldState)}</p>
                <p className="detail-card-copy">{formatFieldStateManualLine(fieldState)}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h3>Source post preview</h3>
        <p className="detail-body-text">{observation.bodyText || observation.bodyPreview || 'No post text captured.'}</p>
      </section>

      {detail.variants.length > 1 ? (
        <section className="detail-section">
          <h3>Extractor variants</h3>
          <div className="detail-card-grid">
            {detail.variants.map((variant) => (
              <article
                className={`detail-card ${variant.listingId === detail.selectedVariantId ? 'is-selected' : ''}`}
                key={variant.listingId}
              >
                <p className="detail-card-title">
                  {variant.extractorVersion || 'Unknown extractor'}
                </p>
                <p className="detail-card-copy">
                  {formatConfidence(variant.confidenceOverall)}
                  {' · '}
                  {variant.ambiguityCount === 0
                    ? 'No ambiguities'
                    : formatCount(variant.ambiguityCount, 'ambiguity')}
                </p>
                <p className="detail-card-copy">{summarizeText(variant.listingSummary, 140)}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {detail.jobs.length ? (
        <section className="detail-section">
          <h3>Recent extraction runs</h3>
          <div className="detail-card-grid">
            {detail.jobs.map((job) => (
              <article className="detail-card" key={job.jobId || `${job.processingStatus}-${job.updatedAt || job.claimedAt || 'job'}`}>
                <p className="detail-card-title">{formatLabel(job.processingStatus)}</p>
                <p className="detail-card-copy">
                  {job.processorVersion || 'processor'}
                  {' · '}
                  {job.modelName || 'unknown model'}
                </p>
                <p className="detail-card-copy">
                  Updated {formatAbsoluteTime(job.updatedAt || job.processedAt || job.claimedAt)}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h3>Technical record</h3>
        <dl className="detail-facts">
          <div>
            <dt>Observation ID</dt>
            <dd className="detail-code">{detail.provenance.observationId}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd className="detail-code">{detail.provenance.runId}</dd>
          </div>
          <div>
            <dt>Listing ID</dt>
            <dd className="detail-code">{detail.provenance.listingId}</dd>
          </div>
          <div>
            <dt>Stable post</dt>
            <dd className="detail-code">{detail.provenance.stablePostId || 'Not linked'}</dd>
          </div>
          <div>
            <dt>Seen count</dt>
            <dd>{detail.listing.stablePostTimesSeen || 1}</dd>
          </div>
          <div>
            <dt>Artifact path</dt>
            <dd className="detail-code">{detail.provenance.rawArtifactPath || 'Not captured'}</dd>
          </div>
        </dl>

        <div className="detail-link-row">
          <Link to={`/debug/runs/${encodeURIComponent(detail.provenance.runId)}?detail=open`}>
            Open debug run
          </Link>
          {detail.provenance.rawArtifactPath ? (
            <a
              href={`/artifact-file?path=${encodeURIComponent(detail.provenance.rawArtifactPath)}`}
              rel="noreferrer"
              target="_blank"
            >
              Inspect raw artifact
            </a>
          ) : null}
        </div>
      </section>

      <section className="detail-section">
        <h3>Raw JSON</h3>
        <JsonDetails summary="Normalized listing payload" value={detail.selectedVariant.payload} />
        <JsonDetails summary="Observed post payload" value={observation.payload} />
      </section>
    </article>
  );
}

function buildListingDetailUrl(listingId) {
  return `/api/dashboard/listings/${encodeURIComponent(listingId)}`;
}

function buildListingsListUrl(queryState) {
  return buildApiUrl('/api/dashboard/listings', {
    bathsMin: queryState.bathsMin,
    bedsMin: queryState.bedsMin,
    borough: queryState.borough,
    freshness: queryState.freshness,
    hasAmbiguities: queryState.hasAmbiguities,
    listingType: queryState.listingType,
    minConfidence: queryState.minConfidence,
    neighborhood: queryState.neighborhood,
    page: queryState.page,
    pageSize: queryState.pageSize,
    postedWithinHours: queryState.postedWithinHours,
    priceMax: queryState.priceMax,
    priceMin: queryState.priceMin,
    q: queryState.q,
    sort: queryState.sort,
    sourceKey: queryState.sourceKey,
  });
}

function buildReviewSummaryUrl(queryState) {
  return buildApiUrl('/api/dashboard/review', {
    page: 1,
    pageSize: 1,
    postedWithinHours: queryState.postedWithinHours,
    sourceKey: queryState.sourceKey,
  });
}

function buildReviewLinkTargetUrl(reviewLinkTarget) {
  const searchParams = new URLSearchParams();

  if (reviewLinkTarget?.queue) {
    searchParams.set('queue', reviewLinkTarget.queue);
  }

  if (reviewLinkTarget?.reviewId) {
    searchParams.set('detail', 'open');
    searchParams.set('reviewId', reviewLinkTarget.reviewId);
  }

  const query = searchParams.toString();
  return query ? `/review?${query}` : '/review';
}

function createListingsQueryActions(setQueryState) {
  return {
    clampPage(page, options) {
      setQueryState({ page }, options);
    },
    clearFilters() {
      setQueryState(DEFAULT_LISTINGS_QUERY_PATCH);
    },
    openDetail(listingId) {
      setQueryState({
        detail: 'open',
        listingId,
      });
    },
    setPage(page) {
      setQueryState({
        listingId: '',
        page,
      });
    },
    setPageSize(pageSize) {
      setQueryState({
        listingId: '',
        page: 1,
        pageSize,
      });
    },
    syncSelectedListing(listingId, options) {
      setQueryState({ listingId }, options);
    },
    updateFilters(patch) {
      setQueryState({
        ...patch,
        listingId: '',
        page: 1,
      });
    },
  };
}

function formatListingLocation(listing) {
  if (listing.neighborhood && listing.borough) {
    return `${listing.neighborhood}, ${listing.borough}`;
  }

  if (listing.neighborhood) {
    return listing.neighborhood;
  }

  if (listing.borough) {
    return listing.borough;
  }

  return 'Location unclear';
}

function formatListingPrice(listing) {
  return formatPrice(listing.priceAmount, {
    period: listing.pricePeriod === 'unknown' ? '' : listing.pricePeriod,
  });
}

function buildListingSubline(listing) {
  const parts = [];

  if (listing.listingType && listing.listingType !== 'unknown') {
    parts.push(formatLabel(listing.listingType));
  }

  if (listing.intent && listing.intent !== 'unknown') {
    parts.push(formatLabel(listing.intent));
  }

  if (listing.variantCount > 1) {
    parts.push(formatCount(listing.variantCount, 'variant'));
  }

  return parts.join(' · ');
}

function buildPriceSubline(listing) {
  if (listing.availableFrom) {
    return `Available ${listing.availableFrom}`;
  }

  if (listing.priceAmount === null || listing.priceAmount === undefined) {
    return 'Price not locked';
  }

  return '';
}

function formatListingRooms(listing) {
  if (Number.isFinite(Number(listing.roomsAvailable))) {
    return formatRoomCount(listing.roomsAvailable, 'room');
  }

  return formatRoomCount(resolveBeds(listing), 'bed');
}

function buildRoomSubline(listing) {
  const parts = [];

  if (Number.isFinite(Number(listing.roomsAvailable)) && Number.isFinite(Number(listing.beds))) {
    parts.push(`${formatRoomCount(listing.beds, 'bed')} home`);
  }

  if (Number.isFinite(Number(listing.baths))) {
    parts.push(formatRoomCount(listing.baths, 'bath'));
  }

  return parts.join(' · ');
}

function buildLocationSubline(listing) {
  if (listing.locationResolutionSummary?.ambiguousCount > 0) {
    return `${formatCount(listing.locationResolutionSummary.ambiguousCount, 'resolved ambiguity')} in location layer`;
  }

  if (listing.locationResolutionSummary?.candidateCount > 0) {
    return 'Resolver candidate pending';
  }

  if (listing.locationResolutionSummary?.unresolvedCount > 0 && (!listing.neighborhood && !listing.borough)) {
    return 'Resolver could not confirm location';
  }

  if (listing.neighborhood || listing.borough) {
    return '';
  }

  return 'Location unresolved';
}

function describeListingReview(listing, lowConfidenceThreshold) {
  const freshnessLabel = formatLabel(listing.freshness);
  const confidenceLabel = `${formatConfidence(listing.confidenceOverall)} confidence`;
  const threshold = Number(lowConfidenceThreshold || 0.75);
  const confidenceValue = Number(listing.confidenceOverall);
  const reviewAmbiguityCount = Number(listing.reviewAmbiguityCount ?? listing.ambiguityCount ?? 0);

  if (reviewAmbiguityCount > 0) {
    return {
      label: 'Needs review',
      meta: `${formatCount(reviewAmbiguityCount, 'ambiguity')} · ${confidenceLabel} · ${freshnessLabel}`,
      toneClass: 'cell-status-warning',
    };
  }

  if (Number.isFinite(confidenceValue) && confidenceValue < threshold) {
    return {
      label: 'Low confidence',
      meta: `${confidenceLabel} · ${freshnessLabel}`,
      toneClass: 'cell-status-warning',
    };
  }

  if (listing.priceAmount === null || (!listing.neighborhood && !listing.borough)) {
    return {
      label: 'Check fields',
      meta: `${buildIncompleteFieldSummary(listing)} · ${freshnessLabel}`,
      toneClass: 'cell-status-muted',
    };
  }

  return {
    label: 'Ready',
    meta: `${confidenceLabel} · ${freshnessLabel}`,
    toneClass: 'cell-status-accent',
  };
}

function buildIncompleteFieldSummary(listing) {
  const parts = [];

  if (listing.priceAmount === null || listing.priceAmount === undefined) {
    parts.push('Price missing');
  }

  if (!listing.neighborhood && !listing.borough) {
    parts.push(listing.locationResolutionSummary?.unresolvedCount
      ? 'Location unresolved'
      : 'Location missing');
  } else if (
    Number(listing.locationResolutionSummary?.candidateCount || 0) > 0
    || Number(listing.locationResolutionSummary?.unresolvedCount || 0) > 0
  ) {
    parts.push('Location resolver pending');
  }

  return parts.join(' · ') || 'Needs a closer pass';
}

function formatLocationResolutionSummary(summary) {
  if (!summary) {
    return 'No resolved location rows are present yet.';
  }

  const parts = [];

  if (summary.acceptedCount) {
    parts.push(`${summary.acceptedCount} accepted`);
  }
  if (summary.ambiguousCount) {
    parts.push(`${summary.ambiguousCount} ambiguous`);
  }
  if (summary.candidateCount) {
    parts.push(`${summary.candidateCount} candidate`);
  }
  if (summary.unresolvedCount) {
    parts.push(`${summary.unresolvedCount} unresolved`);
  }
  if (summary.manualCount) {
    parts.push(`${summary.manualCount} manual`);
  }

  return parts.length
    ? `Current location layering: ${parts.join(' · ')}.`
    : 'No resolved or manual location rows are present yet.';
}

function formatFieldStateWinningLine(fieldState) {
  return `${formatFieldStateValue(fieldState.effectiveValue)} · effective ${formatLabel(fieldState.effectiveLayer)}`;
}

function formatFieldStateResolvedLine(fieldState) {
  const resolvedField = fieldState?.layers?.resolvedField;

  if (!resolvedField) {
    return 'Resolved row: none';
  }

  return `Resolved row: ${formatLabel(resolvedField.status)} · ${formatFieldStateValue(resolvedField.value)}`;
}

function formatFieldStateRawLine(fieldState) {
  const parts = [];

  if (fieldState?.layers?.rawExtracted?.isPresent) {
    parts.push(`Raw extracted: ${formatFieldStateValue(fieldState.layers.rawExtracted.value)}`);
  }

  if (fieldState?.layers?.rawObservation?.isPresent) {
    parts.push(`Observation fallback: ${formatFieldStateValue(fieldState.layers.rawObservation.value)}`);
  }

  return parts.join(' · ') || 'No raw value recorded';
}

function formatFieldStateManualLine(fieldState) {
  const manualOverride = fieldState?.layers?.manualOverride;

  if (!manualOverride) {
    return 'Manual row: none';
  }

  return `Manual row: ${formatLabel(manualOverride.status)} · ${formatFieldStateValue(manualOverride.value)}`;
}

function formatFieldStateValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'No value';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

function hasActiveAdvancedFilters(queryState) {
  return countActiveAdvancedFilters(queryState) > 0;
}

function countActiveAdvancedFilters(queryState) {
  return [
    queryState.bathsMin !== null,
    Boolean(queryState.borough),
    Boolean(queryState.freshness),
    queryState.hasAmbiguities === 'true',
    Boolean(queryState.listingType),
    queryState.minConfidence !== null,
  ].filter(Boolean).length;
}

function buildActiveFilterChips(queryState, sourceOptions) {
  const chips = [];

  if (queryState.q) {
    chips.push({
      clearState: { q: '' },
      key: 'q',
      label: `Search: ${queryState.q}`,
    });
  }

  if (queryState.sourceKey) {
    chips.push({
      clearState: { sourceKey: '' },
      key: 'sourceKey',
      label: `Source: ${findOptionLabel(sourceOptions, queryState.sourceKey, queryState.sourceKey)}`,
    });
  }

  if (queryState.postedWithinHours !== null) {
    chips.push({
      clearState: { postedWithinHours: null },
      key: 'postedWithinHours',
      label: `Posted: ${findOptionLabel(POSTED_WITHIN_OPTIONS, String(queryState.postedWithinHours), `${queryState.postedWithinHours}h`)}`,
    });
  }

  if (queryState.priceMin !== null || queryState.priceMax !== null) {
    chips.push({
      clearState: { priceMax: null, priceMin: null },
      key: 'price',
      label: buildPriceRangeLabel(queryState.priceMin, queryState.priceMax),
    });
  }

  if (queryState.bedsMin !== null) {
    chips.push({
      clearState: { bedsMin: null },
      key: 'bedsMin',
      label: `${queryState.bedsMin}+ beds`,
    });
  }

  if (queryState.neighborhood) {
    chips.push({
      clearState: { neighborhood: '' },
      key: 'neighborhood',
      label: `Neighborhood: ${queryState.neighborhood}`,
    });
  }

  if (queryState.borough) {
    chips.push({
      clearState: { borough: '' },
      key: 'borough',
      label: `Borough: ${queryState.borough}`,
    });
  }

  if (queryState.listingType) {
    chips.push({
      clearState: { listingType: '' },
      key: 'listingType',
      label: `Type: ${formatLabel(queryState.listingType)}`,
    });
  }

  if (queryState.freshness) {
    chips.push({
      clearState: { freshness: '' },
      key: 'freshness',
      label: `Freshness: ${formatLabel(queryState.freshness)}`,
    });
  }

  if (queryState.minConfidence !== null) {
    chips.push({
      clearState: { minConfidence: null },
      key: 'minConfidence',
      label: `Confidence: ${findOptionLabel(MIN_CONFIDENCE_OPTIONS, String(queryState.minConfidence), `${Math.round(queryState.minConfidence * 100)}%+`)}`,
    });
  }

  if (queryState.bathsMin !== null) {
    chips.push({
      clearState: { bathsMin: null },
      key: 'bathsMin',
      label: `${queryState.bathsMin}+ baths`,
    });
  }

  if (queryState.hasAmbiguities === 'true') {
    chips.push({
      clearState: { hasAmbiguities: '' },
      key: 'hasAmbiguities',
      label: 'Needs review',
    });
  }

  return chips;
}

function findOptionLabel(options, value, fallback) {
  return options.find((option) => String(option.value) === String(value))?.label || fallback;
}

function buildPriceRangeLabel(priceMin, priceMax) {
  const minimum = priceMin === null || priceMin === undefined
    ? null
    : formatPrice(priceMin);
  const maximum = priceMax === null || priceMax === undefined
    ? null
    : formatPrice(priceMax);

  if (minimum && maximum) {
    return `Price: ${minimum} to ${maximum}`;
  }

  if (minimum) {
    return `Price: ${minimum}+`;
  }

  return `Price: up to ${maximum}`;
}

function buildListingsResultsSummary({ error, isRefreshing, pagination, sortLabel }) {
  if (!pagination) {
    return '';
  }

  const totalItems = pagination.totalItems || 0;
  const parts = [
    totalItems ? `${formatCompactCount(totalItems)} listings` : 'No matching listings',
  ];

  if (sortLabel) {
    parts.push(sortLabel);
  }

  if (pagination.totalPages > 1 && totalItems) {
    parts.push(`page ${pagination.page} of ${pagination.totalPages}`);
  }

  if (error?.message) {
    parts.push(`Refresh failed: ${error.message}`);
  } else if (isRefreshing) {
    parts.push('Refreshing');
  }

  return parts.join(' · ');
}

function getSortLabel(value) {
  return LISTING_SORT_OPTIONS.find((option) => option.value === value)?.label || 'Newest first';
}

function resolveBeds(listing) {
  return listing.beds ?? listing.roomsAvailable ?? null;
}

function summarizeText(value, maxLength = 96) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return 'No summary captured';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

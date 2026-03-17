import { useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useDashboardShellSlots } from "../../app/shell-context.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import {
  FilterBar,
  FilterField,
  FilterSelect,
} from "../../components/FilterControls.jsx";
import { RoutePagination } from "../../components/RoutePagination.jsx";
import { RouteScaffold } from "../../components/RouteScaffold.jsx";
import { ErrorState, LoadingState } from "../../components/StateViews.jsx";
import {
  formatAbsoluteTime,
  formatConfidence,
  formatCount,
  formatLabel,
  formatRelativeTime,
} from "../../lib/formatters.js";
import { useUrlQueryState } from "../../lib/use-url-query-state.js";
import {
  POSTED_WITHIN_OPTIONS,
  buildApiUrl,
  requestJson,
  useDashboardSourceOptions,
  useJsonResource,
} from "../shared/route-support.jsx";

const REVIEW_QUERY_SCHEMA = {
  detail: { defaultValue: "open" },
  page: { defaultValue: 1, type: "number" },
  pageSize: { defaultValue: 50, type: "number" },
  postedWithinHours: { defaultValue: null, type: "number" },
  queue: { defaultValue: "" },
  reviewId: { defaultValue: "" },
  sort: { defaultValue: "newest" },
  sourceKey: { defaultValue: "" },
};

const REVIEW_QUEUE_OPTIONS = [
  { label: "All queues", value: "" },
  { label: "Ambiguous", value: "ambiguous" },
  { label: "Low confidence", value: "low-confidence" },
  { label: "Incomplete", value: "incomplete" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
];

const REVIEW_SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
];

const EMPTY_MANUAL_OVERRIDE_STATE = Object.freeze({
  error: null,
  fieldPath: "",
  isSaving: false,
  result: null,
  reviewId: "",
});

const columnHelper = createColumnHelper();

const REVIEW_COLUMNS = [
  columnHelper.accessor("postedAt", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatRelativeTime(getValue())}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatAbsoluteTime(getValue())}
          {row.original.postedAtText ? ` · ${row.original.postedAtText}` : ""}
        </span>
      </div>
    ),
    header: "Posted",
    meta: { className: "column-tight" },
  }),
  columnHelper.accessor("reviewType", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatLabel(getValue())}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatLabel(row.original.processingStatus)}
        </span>
      </div>
    ),
    header: "Needs review",
    meta: { className: "column-tight review-column-status" },
  }),
  columnHelper.accessor("sourceDisplayName", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate" title={getValue()}>
          {getValue()}
        </strong>
        <span
          className="cell-meta cell-meta-truncate"
          title={row.original.authorName || "Unknown author"}
        >
          {row.original.authorName || "Unknown author"}
        </span>
      </div>
    ),
    header: "Source",
    meta: { className: "review-column-source" },
  }),
  columnHelper.accessor("reasonSummary", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate" title={getValue()}>
          {getValue()}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatConfidence(row.original.confidenceOverall)}
          {" · "}
          {formatCount(row.original.ambiguityCount, "ambiguity")}
        </span>
      </div>
    ),
    header: "Why now",
  }),
  columnHelper.accessor("summaryText", {
    cell: ({ getValue }) => (
      <span className="body-preview-cell body-preview-cell-compact">
        {getValue() || "No source summary captured yet."}
      </span>
    ),
    header: "Evidence",
    meta: { className: "review-column-evidence" },
  }),
];

export function ReviewRoute() {
  const [queryState, setQueryState] = useUrlQueryState(REVIEW_QUERY_SCHEMA);
  const [refreshKey, setRefreshKey] = useState(0);
  const [manualOverrideState, setManualOverrideState] = useState(
    createEmptyManualOverrideState,
  );
  const queryActions = useMemo(
    () => createReviewQueryActions(setQueryState),
    [setQueryState],
  );
  const reviewState = useJsonResource(buildReviewListUrl(queryState, refreshKey));
  const reviewDetailState = useJsonResource(
    queryState.reviewId ? buildReviewDetailUrl(queryState, refreshKey) : null,
  );
  const { sourceOptions } = useDashboardSourceOptions();

  const reviewResponse = reviewState.data;
  const reviewItems = reviewResponse?.items || [];
  const selectedRow =
    reviewItems.find((item) => getReviewItemId(item) === queryState.reviewId) ||
    null;
  const selectedDetail =
    reviewDetailState.data?.item &&
    getReviewItemId(reviewDetailState.data.item) === queryState.reviewId
      ? reviewDetailState.data
      : null;
  const latestManualOverrideResult =
    manualOverrideState.reviewId === queryState.reviewId
      ? manualOverrideState.result
      : null;
  const selectedReviewDetail = useMemo(
    () =>
      buildSelectedReviewDetail({
        actionResult: latestManualOverrideResult,
        reviewThresholds: reviewResponse?.thresholds || null,
        selectedDetail,
        selectedRow,
      }),
    [
      latestManualOverrideResult,
      reviewResponse?.thresholds,
      selectedDetail,
      selectedRow,
    ],
  );
  const selectedItem = selectedReviewDetail?.item || null;
  const selectedItemOffPage = Boolean(
    queryState.reviewId && !selectedRow && selectedItem,
  );
  const lowConfidenceThreshold =
    reviewResponse?.thresholds?.lowConfidence ??
    selectedReviewDetail?.thresholds?.lowConfidence ??
    null;
  const detailError =
    latestManualOverrideResult || selectedDetail ? null : reviewDetailState.error;
  const detailIsLoading = Boolean(
    queryState.reviewId
      && reviewDetailState.isLoading
      && !selectedDetail
      && !latestManualOverrideResult,
  );

  useEffect(() => {
    setManualOverrideState(createEmptyManualOverrideState());
  }, [queryState.reviewId]);

  const toolbar = useMemo(
    () => (
      <FilterBar>
        <FilterField label="Queue">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({ queue: event.target.value })
            }
            value={queryState.queue}
          >
            {REVIEW_QUEUE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        <FilterField label="Source group">
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

        <FilterField label="Posted within">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({
                postedWithinHours: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
            value={queryState.postedWithinHours ?? ""}
          >
            {POSTED_WITHIN_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        <FilterField label="Sort">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({ sort: event.target.value })
            }
            value={queryState.sort}
          >
            {REVIEW_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterBar>
    ),
    [
      queryActions,
      queryState.postedWithinHours,
      queryState.queue,
      queryState.sort,
      queryState.sourceKey,
      sourceOptions,
    ],
  );

  async function handleManualOverrideAction(input) {
    const manualOverrideAction = selectedReviewDetail?.actions?.manualOverride;
    const listingId = selectedItem?.listingId || manualOverrideAction?.targetId;

    if (!manualOverrideAction?.supported || !listingId) {
      setManualOverrideState({
        error: new Error(
          "Manual location correction is unavailable until Review loads a listing-backed location target.",
        ),
        fieldPath: input.fieldPath,
        isSaving: false,
        result: null,
        reviewId: queryState.reviewId,
      });
      return;
    }

    const endpoint = input.action === "clear"
      ? manualOverrideAction.endpoints?.clear
      : manualOverrideAction.endpoints?.set;

    if (!endpoint) {
      setManualOverrideState({
        error: new Error("Review did not provide a manual override endpoint."),
        fieldPath: input.fieldPath,
        isSaving: false,
        result: null,
        reviewId: queryState.reviewId,
      });
      return;
    }

    const payload = {
      fieldPath: input.fieldPath,
      listingId,
      reviewId: queryState.reviewId,
    };

    if (input.reason) {
      payload.reason = input.reason;
    }

    if (input.action !== "clear") {
      payload.value = input.value;
    }

    setManualOverrideState({
      error: null,
      fieldPath: input.fieldPath,
      isSaving: true,
      result: null,
      reviewId: queryState.reviewId,
    });

    try {
      const result = await requestJson(endpoint, {
        body: JSON.stringify(payload),
        method: "POST",
      });

      setManualOverrideState({
        error: null,
        fieldPath: input.fieldPath,
        isSaving: false,
        result,
        reviewId: queryState.reviewId,
      });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setManualOverrideState({
        error,
        fieldPath: input.fieldPath,
        isSaving: false,
        result: null,
        reviewId: queryState.reviewId,
      });
    }
  }

  let detailContent = null;

  if (queryState.reviewId) {
    if (selectedReviewDetail) {
      detailContent = (
        <ReviewDetail
          detail={selectedReviewDetail}
          detailError={detailError}
          detailIsLoading={detailIsLoading}
          lowConfidenceThreshold={lowConfidenceThreshold}
          manualOverrideState={manualOverrideState}
          onManualOverrideAction={handleManualOverrideAction}
        />
      );
    } else if (reviewDetailState.isLoading) {
      detailContent = (
        <LoadingState
          message="Loading the selected review item, location lineage, and correction contract."
          title="Loading review detail"
        />
      );
    } else if (reviewDetailState.error) {
      detailContent = (
        <ErrorState
          message={reviewDetailState.error.message}
          title="Could not load this review item"
        />
      );
    }
  }

  const shellState = useMemo(
    () => ({
      description:
        "Listings that need a closer look because the evidence is ambiguous, incomplete, low-confidence, or still processing. Durable correction actions live here, while Debug stays forensic.",
      detailActions: selectedItem ? (
        <>
          {selectedItem.linkTargets?.listingId ? (
            <Link
              to={`/listings?detail=open&listingId=${encodeURIComponent(selectedItem.linkTargets.listingId)}`}
            >
              Open listing
            </Link>
          ) : null}
          {selectedItem.linkTargets?.observationId ? (
            <Link
              to={`/posts?detail=open&observationId=${encodeURIComponent(selectedItem.linkTargets.observationId)}`}
            >
              View source post
            </Link>
          ) : null}
          {selectedItem.linkTargets?.runId ? (
            <Link
              to={`/debug/runs/${encodeURIComponent(selectedItem.linkTargets.runId)}?detail=open`}
            >
              Run forensics
            </Link>
          ) : null}
          {selectedItem.postUrl ? (
            <a href={selectedItem.postUrl} rel="noreferrer" target="_blank">
              View Facebook post
            </a>
          ) : null}
        </>
      ) : null,
      detailContent,
      detailEmptyMessage: queryState.reviewId
        ? "The selected review item is outside the current page or no longer matches this scope."
        : "Select a review row to inspect layered values and apply corrections from Review.",
      detailEmptyTitle: "Select a review item",
      detailMeta: selectedItem ? (
        <div className="detail-meta-list">
          <span className="detail-meta-item">
            {formatLabel(selectedItem.reviewType)}
          </span>
          <span className="detail-meta-item">
            {selectedItem.sourceDisplayName}
          </span>
          <span
            className="detail-meta-item"
            title={formatAbsoluteTime(selectedItem.postedAt)}
          >
            Posted {formatRelativeTime(selectedItem.postedAt)}
          </span>
          {selectedItemOffPage ? (
            <span className="detail-meta-item detail-meta-item-warning">
              Outside current page
            </span>
          ) : null}
        </div>
      ) : null,
      detailTitle: "Review item",
      eyebrow: "Needs review",
      title: "Review",
      toolbar,
    }),
    [detailContent, queryState.reviewId, selectedItem, selectedItemOffPage, toolbar],
  );

  useDashboardShellSlots(shellState);

  return (
    <RouteScaffold>
      {reviewState.isLoading && !reviewResponse ? (
        <LoadingState
          message="Loading the operator-facing review queues."
          title="Loading review queues"
        />
      ) : null}

      {reviewState.error && !reviewResponse ? (
        <ErrorState
          message={reviewState.error.message}
          title="Could not load review queues"
        />
      ) : null}

      {reviewResponse ? (
        <>
          <DataTable
            ariaLabel="Review queue table"
            caption="Listings that need review"
            className="records-table-shell review-table-shell"
            columns={REVIEW_COLUMNS}
            data={reviewItems}
            emptyMessage="No review rows match the current queue filters."
            emptyTitle="No matching review rows"
            getRowId={getReviewItemId}
            isLoading={reviewState.isLoading}
            onRowSelect={(row) =>
              queryActions.openDetail(getReviewItemId(row))
            }
            selectedRowId={queryState.reviewId}
          />

          <RoutePagination
            className="listings-pagination-compact"
            count={reviewItems.length}
            isRefreshing={reviewState.isLoading}
            onNext={() => queryActions.setPage(queryState.page + 1)}
            onPageSizeChange={(pageSize) => queryActions.setPageSize(pageSize)}
            onPrevious={() =>
              queryActions.setPage(Math.max(1, queryState.page - 1))
            }
            pagination={reviewResponse.pagination}
          />
        </>
      ) : null}
    </RouteScaffold>
  );
}

function ReviewDetail({
  detail,
  detailError,
  detailIsLoading,
  lowConfidenceThreshold,
  manualOverrideState,
  onManualOverrideAction,
}) {
  const item = detail?.item || null;
  const manualOverrideAction = detail?.actions?.manualOverride || {
    supported: false,
  };

  if (!item) {
    return null;
  }

  return (
    <article className="detail-stack">
      {detail.actionBanner ? (
        <section className="detail-section">
          <div className="state-card">
            <div className="state-card-mark state-card-mark-success" />
            <div className="state-card-copy">
              <p className="detail-body-text">{detail.actionBanner.message}</p>
              {detail.actionBanner.reviewLinkTarget?.reviewId ? (
                <div className="detail-link-row">
                  <Link
                    to={buildReviewLinkTargetUrl(
                      detail.actionBanner.reviewLinkTarget,
                    )}
                  >
                    Open the current review step
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h3>Why this needs review</h3>
        <p className="detail-body-text">{item.reasonSummary}</p>
        {detail.retiredReviewItem ? (
          <p className="detail-note">
            This queue row is no longer active after the latest correction. The
            layered state below reflects the listing as it exists now.
          </p>
        ) : null}
        {item.reasons.length ? (
          <ul>
            {item.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="detail-section">
        <h3>Evidence snapshot</h3>
        <p className="detail-note">
          {item.authorName || "Unknown author"}
          {" · "}
          {item.sourceDisplayName}
          {" · "}
          {formatAbsoluteTime(item.postedAt)}
        </p>
        <p className="detail-body-text">
          {item.summaryText || "No summary text was captured for this row."}
        </p>
        <dl className="detail-facts">
          <div>
            <dt>Queue</dt>
            <dd>{formatLabel(item.reviewType)}</dd>
          </div>
          <div>
            <dt>Processing</dt>
            <dd>{formatLabel(item.processingStatus)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(item.confidenceOverall)}</dd>
          </div>
          <div>
            <dt>Ambiguities</dt>
            <dd>{formatCount(item.ambiguityCount, "ambiguity")}</dd>
          </div>
        </dl>
        {item.reviewType === "low-confidence"
        && lowConfidenceThreshold !== null ? (
          <p className="detail-note">
            Low-confidence rows are currently anything below{" "}
            {formatConfidence(lowConfidenceThreshold)}.
          </p>
        ) : null}
      </section>

      <section className="detail-section">
        <h3>Correction workflow</h3>
        {detailIsLoading ? (
          <p className="detail-note">
            Loading manual correction availability and the latest listing-backed
            layer state.
          </p>
        ) : null}
        {detailError ? (
          <div className="state-card state-card-error">
            <div className="state-card-mark state-card-mark-error" />
            <div className="state-card-copy">
              <p className="detail-body-text">{detailError.message}</p>
            </div>
          </div>
        ) : null}
        {!detailIsLoading && !detailError ? (
          <p className="detail-note">
            {manualOverrideAction.supported
              ? "Manual corrections here write durable override and audit rows. Raw listing, extraction, and observation rows stay immutable, and Debug remains forensic."
              : "Manual location correction is unavailable for this queue item until Review has a listing-backed location target for it."}
          </p>
        ) : null}
      </section>

      {item.locationFieldStates?.length ? (
        <section className="detail-section">
          <h3>Layered location values</h3>
          <p className="detail-note">
            {formatLocationResolutionSummary(item.locationResolutionSummary)}
          </p>
          <div className="detail-card-grid">
            {item.locationFieldStates.map((fieldState) => (
              <ReviewLocationFieldCard
                fieldState={fieldState}
                key={fieldState.fieldPath}
                manualOverrideAction={manualOverrideAction}
                manualOverrideState={manualOverrideState}
                onManualOverrideAction={onManualOverrideAction}
              />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function ReviewLocationFieldCard({
  fieldState,
  manualOverrideAction,
  manualOverrideState,
  onManualOverrideAction,
}) {
  const fieldPaths = Array.isArray(manualOverrideAction?.fieldPaths)
    ? manualOverrideAction.fieldPaths
    : [];
  const canEdit =
    manualOverrideAction?.supported && fieldPaths.includes(fieldState.fieldPath);
  const statusBadges = buildFieldStateBadges(fieldState);
  const resolvedAmbiguityLine = formatFieldStateResolvedAmbiguityLine(fieldState);
  const manualMetaLine = formatFieldStateManualMetaLine(fieldState);

  return (
    <article className="detail-card review-location-card">
      <p className="detail-card-title">{fieldState.label}</p>
      {statusBadges.length ? (
        <ul className="detail-pill-list review-layer-pill-list">
          {statusBadges.map((badge) => (
            <li
              className={`detail-pill review-layer-pill review-layer-pill-${badge.tone}`}
              key={badge.label}
            >
              {badge.label}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="detail-card-copy review-layer-copy-strong">
        {formatFieldStateWinningLine(fieldState)}
      </p>
      <p className="detail-card-copy">
        {fieldState?.selected?.reason || "No effective value is currently active."}
      </p>
      <p className="detail-card-copy">{formatFieldStateResolvedLine(fieldState)}</p>
      {resolvedAmbiguityLine ? (
        <p className="detail-card-copy">{resolvedAmbiguityLine}</p>
      ) : null}
      <p className="detail-card-copy">{formatFieldStateRawLine(fieldState)}</p>
      <p className="detail-card-copy">{formatFieldStateManualLine(fieldState)}</p>
      {manualMetaLine ? (
        <p className="detail-card-copy">{manualMetaLine}</p>
      ) : null}
      {canEdit ? (
        <ReviewFieldOverrideForm
          fieldState={fieldState}
          manualOverrideState={manualOverrideState}
          onManualOverrideAction={onManualOverrideAction}
        />
      ) : null}
    </article>
  );
}

function ReviewFieldOverrideForm({
  fieldState,
  manualOverrideState,
  onManualOverrideAction,
}) {
  const activeManualOverride = fieldState?.layers?.activeManualOverride || null;
  const [valueDraft, setValueDraft] = useState(
    activeManualOverride ? toOverrideInputValue(activeManualOverride.value) : "",
  );
  const [reasonDraft, setReasonDraft] = useState(activeManualOverride?.reason || "");
  const isSaving =
    manualOverrideState?.isSaving
    && manualOverrideState?.fieldPath === fieldState.fieldPath;
  const error =
    !isSaving && manualOverrideState?.fieldPath === fieldState.fieldPath
      ? manualOverrideState?.error
      : null;

  useEffect(() => {
    setValueDraft(
      activeManualOverride ? toOverrideInputValue(activeManualOverride.value) : "",
    );
    setReasonDraft(activeManualOverride?.reason || "");
  }, [
    activeManualOverride,
    activeManualOverride?.id,
    activeManualOverride?.reason,
    activeManualOverride?.updatedAt,
    fieldState.fieldPath,
  ]);

  const suggestedValue = formatSuggestedOverrideValue(fieldState);

  function handleSubmit(event) {
    event.preventDefault();
    const normalizedValue = valueDraft.trim();

    if (!normalizedValue) {
      return;
    }

    void onManualOverrideAction({
      action: "set",
      fieldPath: fieldState.fieldPath,
      reason: reasonDraft.trim(),
      value: normalizedValue,
    });
  }

  function handleClear() {
    if (!activeManualOverride) {
      return;
    }

    void onManualOverrideAction({
      action: "clear",
      fieldPath: fieldState.fieldPath,
      reason: reasonDraft.trim(),
    });
  }

  return (
    <form className="review-override-form" onSubmit={handleSubmit}>
      <label className="review-override-field">
        <span className="review-override-label">
          {activeManualOverride ? "Update manual value" : "Set manual value"}
        </span>
        <input
          className="review-override-input"
          onChange={(event) => setValueDraft(event.target.value)}
          placeholder={suggestedValue}
          type="text"
          value={valueDraft}
        />
      </label>
      <label className="review-override-field">
        <span className="review-override-label">Operator note</span>
        <textarea
          className="review-override-textarea"
          onChange={(event) => setReasonDraft(event.target.value)}
          placeholder="Optional note for the audit trail."
          rows={2}
          value={reasonDraft}
        />
      </label>
      <p className="review-override-help">
        Current effective value: {formatFieldStateValue(fieldState.effectiveValue)}
      </p>
      <div className="detail-link-row">
        <button disabled={isSaving || !valueDraft.trim()} type="submit">
          {isSaving
            ? "Saving..."
            : activeManualOverride
              ? "Update manual value"
              : "Save manual value"}
        </button>
        <button
          disabled={isSaving || !activeManualOverride}
          onClick={handleClear}
          type="button"
        >
          Clear manual override
        </button>
      </div>
      {error ? (
        <p className="detail-card-copy review-override-error">
          {error.message}
        </p>
      ) : null}
    </form>
  );
}

function getReviewItemId(item) {
  return `${item.reviewType}:${item.primaryId}`;
}

function createReviewQueryActions(setQueryState) {
  return {
    openDetail(reviewId) {
      setQueryState({
        detail: "open",
        reviewId,
      });
    },
    setPage(page) {
      setQueryState({
        page,
        reviewId: "",
      });
    },
    setPageSize(pageSize) {
      setQueryState({
        page: 1,
        pageSize,
        reviewId: "",
      });
    },
    updateFilters(patch) {
      setQueryState({
        ...patch,
        page: 1,
        reviewId: "",
      });
    },
  };
}

function buildReviewListUrl(queryState, refreshKey) {
  return buildApiUrl("/api/dashboard/review", {
    page: queryState.page,
    pageSize: queryState.pageSize,
    postedWithinHours: queryState.postedWithinHours,
    queue: queryState.queue,
    refreshKey,
    sort: queryState.sort,
    sourceKey: queryState.sourceKey,
  });
}

function buildReviewDetailUrl(queryState, refreshKey) {
  return buildApiUrl(
    `/api/dashboard/review/${encodeURIComponent(queryState.reviewId)}`,
    {
      postedWithinHours: queryState.postedWithinHours,
      queue: queryState.queue,
      refreshKey,
      sourceKey: queryState.sourceKey,
    },
  );
}

function buildReviewLinkTargetUrl(reviewLinkTarget) {
  const searchParams = new URLSearchParams();

  if (reviewLinkTarget?.queue) {
    searchParams.set("queue", reviewLinkTarget.queue);
  }

  if (reviewLinkTarget?.reviewId) {
    searchParams.set("detail", "open");
    searchParams.set("reviewId", reviewLinkTarget.reviewId);
  }

  const query = searchParams.toString();
  return query ? `/review?${query}` : "/review";
}

function buildSelectedReviewDetail(input) {
  const baseDetail =
    input.selectedDetail
    || buildFallbackReviewDetail(input.selectedRow, input.reviewThresholds);
  const actionResult = input.actionResult || null;

  if (!actionResult) {
    return baseDetail;
  }

  const actionBanner = buildReviewActionBanner(actionResult, baseDetail?.item);

  if (actionResult.review?.item) {
    return {
      ...actionResult.review,
      actionBanner,
    };
  }

  const retiredItem = buildRetiredReviewItem(baseDetail?.item, actionResult.listing);

  if (!retiredItem) {
    return baseDetail;
  }

  return {
    actions:
      baseDetail?.actions || buildReviewActionsFromListing(actionResult.listing),
    actionBanner,
    item: retiredItem,
    retiredReviewItem: true,
    thresholds: baseDetail?.thresholds || input.reviewThresholds || null,
  };
}

function buildFallbackReviewDetail(selectedRow, reviewThresholds) {
  if (!selectedRow) {
    return null;
  }

  return {
    actions: {
      manualOverride: {
        supported: false,
      },
    },
    item: selectedRow,
    thresholds: reviewThresholds || null,
  };
}

function buildRetiredReviewItem(baseItem, listing) {
  if (!baseItem && !listing) {
    return null;
  }

  return {
    ...(baseItem || {}),
    address: listing?.address ?? baseItem?.address ?? null,
    borough: listing?.borough ?? baseItem?.borough ?? null,
    city: listing?.city ?? baseItem?.city ?? null,
    listingId: listing?.listingId ?? baseItem?.listingId ?? null,
    locationFieldStates:
      listing?.locationFieldStates || baseItem?.locationFieldStates || [],
    locationResolutionSummary:
      listing?.locationResolutionSummary
      || baseItem?.locationResolutionSummary
      || null,
    neighborhood: listing?.neighborhood ?? baseItem?.neighborhood ?? null,
    primaryId: baseItem?.primaryId || listing?.listingId || null,
    state: listing?.state ?? baseItem?.state ?? null,
  };
}

function buildReviewActionsFromListing(listing) {
  const fieldPaths = Array.isArray(listing?.locationFieldStates)
    ? listing.locationFieldStates
      .map((fieldState) => String(fieldState?.fieldPath || "").trim())
      .filter(Boolean)
    : [];

  if (!listing?.listingId || !fieldPaths.length) {
    return {
      manualOverride: {
        supported: false,
      },
    };
  }

  return {
    manualOverride: {
      endpoints: {
        clear: "/api/dashboard/review/manual-overrides/clear",
        set: "/api/dashboard/review/manual-overrides",
      },
      fieldPaths,
      supported: true,
      targetId: listing.listingId,
      targetKind: "listing_record",
    },
  };
}

function buildReviewActionBanner(actionResult, baseItem) {
  const fieldLabel =
    actionResult?.fieldState?.label
    || baseItem?.locationFieldStates?.find(
      (fieldState) => fieldState.fieldPath === actionResult?.fieldPath,
    )?.label
    || formatLabel(actionResult?.fieldPath || "field");

  const prefix = actionResult.action === "cleared"
    ? `Cleared the manual override for ${fieldLabel}.`
    : actionResult.action === "updated"
      ? `Updated the manual override for ${fieldLabel}.`
      : `Saved a manual override for ${fieldLabel}.`;

  if (!actionResult.review) {
    if (actionResult.reviewLinkTarget?.queue) {
      return {
        message: `${prefix} This listing now sits in ${formatLabel(actionResult.reviewLinkTarget.queue)} review.`,
        reviewLinkTarget: actionResult.reviewLinkTarget,
      };
    }

    return {
      message: `${prefix} This listing no longer needs review right now.`,
      reviewLinkTarget: null,
    };
  }

  return {
    message: prefix,
    reviewLinkTarget: actionResult.reviewLinkTarget || null,
  };
}

function buildFieldStateBadges(fieldState) {
  const badges = [
    {
      label: `Effective ${formatLabel(fieldState.effectiveLayer)}`,
      tone: fieldState.effectiveLayer === "manual_override"
        ? "accent"
        : fieldState.effectiveLayer === "resolved_field"
          ? "info"
          : fieldState.effectiveLayer === "missing"
            ? "muted"
            : "neutral",
    },
  ];
  const resolvedField = fieldState?.layers?.resolvedField;
  const activeManualOverride = fieldState?.layers?.activeManualOverride;

  if (resolvedField?.status) {
    badges.push({
      label: `Resolved ${formatLabel(resolvedField.status)}`,
      tone: resolvedField.status === "accepted"
        ? "accent"
        : resolvedField.status === "ambiguous"
          ? "warning"
          : resolvedField.status === "candidate"
            ? "info"
            : "muted",
    });
  }

  if (activeManualOverride) {
    badges.push({
      label: "Manual active",
      tone: "accent",
    });
  }

  return badges;
}

function formatLocationResolutionSummary(summary) {
  if (!summary) {
    return "No resolved location rows are present yet.";
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
    ? `Current location layering: ${parts.join(" · ")}.`
    : "No resolved or manual location rows are present yet.";
}

function formatFieldStateWinningLine(fieldState) {
  return `Effective value: ${formatFieldStateValue(fieldState.effectiveValue)} · ${formatLabel(fieldState.effectiveLayer)}`;
}

function formatFieldStateResolvedLine(fieldState) {
  const resolvedField = fieldState?.layers?.resolvedField;

  if (!resolvedField) {
    return "Resolved row: none";
  }

  const parts = [
    `Resolved row: ${formatLabel(resolvedField.status)}`,
    formatFieldStateValue(resolvedField.value),
  ];

  if (resolvedField.confidence !== null && resolvedField.confidence !== undefined) {
    parts.push(`${formatConfidence(resolvedField.confidence)} confidence`);
  }

  if (Array.isArray(resolvedField.supportingFragmentIds)
    && resolvedField.supportingFragmentIds.length) {
    parts.push(
      formatCount(resolvedField.supportingFragmentIds.length, "supporting fragment"),
    );
  }

  return parts.join(" · ");
}

function formatFieldStateResolvedAmbiguityLine(fieldState) {
  const ambiguity = fieldState?.layers?.resolvedField?.ambiguity;

  if (!ambiguity || isEmptyObject(ambiguity)) {
    return null;
  }

  return `Ambiguity payload: ${formatFieldStateValue(ambiguity)}`;
}

function formatFieldStateRawLine(fieldState) {
  const parts = [];

  if (fieldState?.layers?.rawExtracted?.isPresent) {
    parts.push(
      `Raw extracted (${fieldState.layers.rawExtracted.source}): ${formatFieldStateValue(fieldState.layers.rawExtracted.value)}`,
    );
  }

  if (fieldState?.layers?.rawObservation?.isPresent) {
    parts.push(
      `Observation fallback (${fieldState.layers.rawObservation.source}): ${formatFieldStateValue(fieldState.layers.rawObservation.value)}`,
    );
  }

  return parts.join(" · ") || "No raw value recorded";
}

function formatFieldStateManualLine(fieldState) {
  const manualOverride = fieldState?.layers?.manualOverride;

  if (!manualOverride) {
    return "Manual row: none";
  }

  return `Manual row: ${formatLabel(manualOverride.status)} · ${formatFieldStateValue(manualOverride.value)}`;
}

function formatFieldStateManualMetaLine(fieldState) {
  const manualOverride = fieldState?.layers?.manualOverride;

  if (!manualOverride) {
    return null;
  }

  const parts = [];

  if (manualOverride.reason) {
    parts.push(`Reason: ${manualOverride.reason}`);
  }

  if (manualOverride.operatorId) {
    parts.push(`Operator: ${manualOverride.operatorId}`);
  }

  if (manualOverride.updatedAt) {
    parts.push(`Updated ${formatAbsoluteTime(manualOverride.updatedAt)}`);
  }

  return parts.join(" · ") || null;
}

function formatSuggestedOverrideValue(fieldState) {
  if (
    fieldState?.effectiveValue !== null
    && fieldState?.effectiveValue !== undefined
    && fieldState?.effectiveValue !== ""
  ) {
    return toOverrideInputValue(fieldState.effectiveValue);
  }

  if (fieldState?.layers?.resolvedField?.value) {
    return toOverrideInputValue(fieldState.layers.resolvedField.value);
  }

  if (fieldState?.layers?.rawExtracted?.isPresent) {
    return toOverrideInputValue(fieldState.layers.rawExtracted.value);
  }

  if (fieldState?.layers?.rawObservation?.isPresent) {
    return toOverrideInputValue(fieldState.layers.rawObservation.value);
  }

  return "Enter a corrected value";
}

function formatFieldStateValue(value) {
  if (value === null || value === undefined || value === "") {
    return "No value";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function toOverrideInputValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isEmptyObject(value) {
  return typeof value === "object"
    && !Array.isArray(value)
    && value !== null
    && Object.keys(value).length === 0;
}

function createEmptyManualOverrideState() {
  return {
    ...EMPTY_MANUAL_OVERRIDE_STATE,
  };
}

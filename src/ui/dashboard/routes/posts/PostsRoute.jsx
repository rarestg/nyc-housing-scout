import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useDashboardShellSlots } from "../../app/shell-context.jsx";
import { RoutePagination } from "../../components/RoutePagination.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import {
  FilterBar,
  FilterField,
  FilterInput,
  FilterSelect,
} from "../../components/FilterControls.jsx";
import { RouteScaffold } from "../../components/RouteScaffold.jsx";
import { ErrorState, LoadingState } from "../../components/StateViews.jsx";
import {
  formatAbsoluteTime,
  formatConfidence,
  formatCount,
  formatLabel,
  formatPrice,
  formatRelativeTime,
} from "../../lib/formatters.js";
import { useUrlQueryState } from "../../lib/use-url-query-state.js";
import {
  POSTED_WITHIN_OPTIONS,
  buildApiUrl,
  useDashboardSourceOptions,
  useJsonResource,
} from "../shared/route-support.jsx";

const POSTS_QUERY_SCHEMA = {
  detail: { defaultValue: "open" },
  freshness: { defaultValue: "" },
  observationId: { defaultValue: "" },
  page: { defaultValue: 1, type: "number" },
  pageSize: { defaultValue: 50, type: "number" },
  postedWithinHours: { defaultValue: null, type: "number" },
  processingStatus: { defaultValue: "" },
  q: { defaultValue: "" },
  sort: { defaultValue: "newest" },
  sourceKey: { defaultValue: "" },
};

const POSTS_SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
];

const POSTS_FRESHNESS_OPTIONS = [
  { label: "Any freshness", value: "" },
  { label: "Fresh", value: "fresh" },
  { label: "Seen", value: "seen" },
  { label: "Unidentified", value: "unidentified" },
];

const POSTS_STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Unprocessed", value: "unprocessed" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Processed", value: "processed" },
  { label: "Retryable", value: "retryable" },
  { label: "Failed", value: "failed" },
];

const columnHelper = createColumnHelper();

const POSTS_COLUMNS = [
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
  columnHelper.display({
    cell: ({ row }) => {
      const sourceLabel =
        row.original.sourceDisplayName || row.original.sourceKey;
      const sourceMeta = row.original.authorName
        ? `${row.original.authorName} · ${row.original.sourceKey}`
        : row.original.sourceKey;

      return (
        <div className="cell-stack cell-stack-dense">
          <strong className="cell-primary-truncate" title={sourceLabel}>
            {sourceLabel}
          </strong>
          <span className="cell-meta cell-meta-truncate" title={sourceMeta}>
            {sourceMeta || "Unknown author"}
          </span>
        </div>
      );
    },
    header: "Source",
    id: "source",
    meta: { className: "posts-column-source" },
  }),
  columnHelper.accessor("bodyPreview", {
    cell: ({ getValue }) => (
      <span className="body-preview-cell body-preview-cell-compact">
        {getValue() || "No source preview captured yet."}
      </span>
    ),
    header: "Evidence",
    meta: { className: "posts-column-evidence" },
  }),
  columnHelper.display({
    cell: ({ row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatLabel(row.original.freshness)}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatLabel(row.original.processingStatus)}
        </span>
      </div>
    ),
    header: "Status",
    id: "status",
    meta: { className: "column-tight posts-column-status" },
  }),
  columnHelper.accessor("linkedListingCount", {
    cell: ({ getValue }) => formatCount(getValue(), "listing"),
    header: "Linked",
    meta: { className: "column-tight" },
  }),
];

export function PostsRoute() {
  const [queryState, setQueryState] = useUrlQueryState(POSTS_QUERY_SCHEMA);
  const queryActions = useMemo(
    () => createPostsQueryActions(setQueryState),
    [setQueryState],
  );
  const postsState = useJsonResource(
    buildApiUrl("/api/dashboard/posts", {
      freshness: queryState.freshness,
      page: queryState.page,
      pageSize: queryState.pageSize,
      postedWithinHours: queryState.postedWithinHours,
      processingStatus: queryState.processingStatus,
      q: queryState.q,
      sort: queryState.sort,
      sourceKey: queryState.sourceKey,
    }),
  );
  const { sourceOptions } = useDashboardSourceOptions();
  const postDetailState = useJsonResource(
    queryState.observationId
      ? `/api/dashboard/posts/${encodeURIComponent(queryState.observationId)}`
      : null,
  );

  const postsResponse = postsState.data;
  const postItems = postsResponse?.items || [];
  const selectedRow =
    postItems.find((row) => row.observationId === queryState.observationId) ||
    null;
  const selectedPost =
    postDetailState.data?.post?.observationId === queryState.observationId
      ? postDetailState.data
      : null;
  const selectedPostOffPage = Boolean(
    queryState.observationId && !selectedRow && selectedPost,
  );

  const toolbar = useMemo(
    () => (
      <FilterBar>
        <FilterField grow label="Search">
          <FilterInput
            onChange={(event) =>
              queryActions.updateFilters({ q: event.target.value })
            }
            placeholder="Author, text, URL, or source"
            type="search"
            value={queryState.q}
          />
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

        <FilterField label="Freshness">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({ freshness: event.target.value })
            }
            value={queryState.freshness}
          >
            {POSTS_FRESHNESS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        <FilterField label="Processing">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({
                processingStatus: event.target.value,
              })
            }
            value={queryState.processingStatus}
          >
            {POSTS_STATUS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
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
            {POSTS_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterBar>
    ),
    [
      queryState.freshness,
      queryState.postedWithinHours,
      queryState.processingStatus,
      queryState.q,
      queryState.sort,
      queryState.sourceKey,
      queryActions,
      sourceOptions,
    ],
  );

  const detailContent = useMemo(() => {
    if (!queryState.observationId) {
      return null;
    }

    if (postDetailState.isLoading && !selectedPost) {
      return (
        <LoadingState
          message="Pulling the selected post, linked listings, and provenance."
          title="Loading post detail"
        />
      );
    }

    if (postDetailState.error && !selectedPost) {
      return (
        <ErrorState
          message={postDetailState.error.message}
          title="Could not load this post"
        />
      );
    }

    if (!selectedPost) {
      return null;
    }

    return <PostDetail detail={selectedPost} />;
  }, [
    postDetailState.error,
    postDetailState.isLoading,
    queryState.observationId,
    selectedPost,
  ]);

  const shellState = useMemo(
    () => ({
      description:
        "Read the source posts behind the listings view, with linked listings and capture details kept nearby.",
      detailActions: selectedPost ? (
        <>
          {selectedPost.post.postUrl ? (
            <a
              href={selectedPost.post.postUrl}
              rel="noreferrer"
              target="_blank"
            >
              View Facebook post
            </a>
          ) : null}
          <Link
            to={`/debug/runs/${encodeURIComponent(selectedPost.post.runId)}?detail=open`}
          >
            Run forensics
          </Link>
        </>
      ) : null,
      detailContent,
      detailEmptyMessage: queryState.observationId
        ? "The selected post is outside the current page or no longer matches this scope."
        : "Select a source post to read the original text and see which listings came from it.",
      detailEmptyTitle: "Select a source post",
      detailMeta: selectedPost ? (
        <div className="detail-meta-list">
          <span className="detail-meta-item">
            {selectedPost.post.sourceDisplayName}
          </span>
          <span className="detail-meta-item">
            {selectedPost.post.authorName || "Unknown author"}
          </span>
          <span
            className="detail-meta-item"
            title={formatAbsoluteTime(selectedPost.post.postedAt)}
          >
            Posted {formatRelativeTime(selectedPost.post.postedAt)}
          </span>
          {selectedPostOffPage ? (
            <span className="detail-meta-item detail-meta-item-warning">
              Outside current page
            </span>
          ) : null}
        </div>
      ) : null,
      detailTitle: "Source post",
      eyebrow: "Source evidence",
      title: "Posts",
      toolbar,
    }),
    [detailContent, queryState.observationId, selectedPost, selectedPostOffPage, toolbar],
  );

  useDashboardShellSlots(shellState);

  return (
    <RouteScaffold>
      {postsState.isLoading && !postsResponse ? (
        <LoadingState
          message="Loading the cross-group evidence feed."
          title="Loading posts"
        />
      ) : null}

      {postsState.error && !postsResponse ? (
        <ErrorState
          message={postsState.error.message}
          title="Could not load posts"
        />
      ) : null}

      {postsResponse ? (
        <>
          <DataTable
            ariaLabel="Posts table"
            caption="Source posts across tracked Facebook groups"
            className="records-table-shell posts-table-shell"
            columns={POSTS_COLUMNS}
            data={postItems}
            emptyMessage="No posts match the current evidence filters."
            emptyTitle="No matching posts"
            getRowId={(row) => row.observationId}
            isLoading={postsState.isLoading}
            onRowSelect={(row) => queryActions.openDetail(row.observationId)}
            selectedRowId={queryState.observationId}
          />

          <RoutePagination
            className="listings-pagination-compact"
            count={postItems.length}
            isRefreshing={postsState.isLoading}
            onNext={() => queryActions.setPage(queryState.page + 1)}
            onPageSizeChange={(pageSize) => queryActions.setPageSize(pageSize)}
            onPrevious={() =>
              queryActions.setPage(Math.max(1, queryState.page - 1))
            }
            pagination={postsResponse.pagination}
          />
        </>
      ) : null}
    </RouteScaffold>
  );
}

function PostDetail({ detail }) {
  const latestJob = detail.jobs[0] || null;

  return (
    <article className="detail-stack">
      <section className="detail-section">
        <h3>Source post</h3>
        <p className="detail-note">
          {detail.post.authorName || "Unknown author"}
          {" · "}
          {detail.post.sourceDisplayName}
          {" · "}
          {formatAbsoluteTime(detail.post.postedAt)}
        </p>
        <p className="detail-body-text">
          {detail.post.bodyText ||
            detail.post.bodyPreview ||
            "No post body was captured."}
        </p>
        <dl className="detail-facts">
          <div>
            <dt>Freshness</dt>
            <dd>{formatLabel(detail.post.freshness)}</dd>
          </div>
          <div>
            <dt>Media</dt>
            <dd>{formatCount(detail.post.mediaCount, "asset")}</dd>
          </div>
          <div>
            <dt>Comments</dt>
            <dd>{formatCount(detail.post.commentCount, "comment")}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>{formatAbsoluteTime(detail.post.capturedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="detail-section">
        <h3>What came out of it</h3>
        <dl className="detail-facts">
          <div>
            <dt>Latest status</dt>
            <dd>{formatLabel(latestJob?.processingStatus || "unprocessed")}</dd>
          </div>
          <div>
            <dt>Linked listings</dt>
            <dd>{formatCount(detail.linkedListings.length, "listing")}</dd>
          </div>
          <div>
            <dt>Processed payload</dt>
            <dd>{latestJob?.processedPayloadId || "Not created yet"}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{latestJob?.modelName || "No model run yet"}</dd>
          </div>
          <div>
            <dt>Attempts</dt>
            <dd>
              {latestJob
                ? `${latestJob.attemptCount}/${latestJob.maxAttempts}`
                : "0/0"}
            </dd>
          </div>
          <div>
            <dt>Seen count</dt>
            <dd>{detail.provenance.stablePostTimesSeen ?? 1}</dd>
          </div>
        </dl>
        {latestJob?.lastError ? (
          <p className="detail-note">{latestJob.lastError}</p>
        ) : null}
      </section>

      <section className="detail-section">
        <h3>Linked listings</h3>
        {detail.linkedListings.length ? (
          <div className="detail-card-grid">
            {detail.linkedListings.map((listing) => (
              <article className="detail-card" key={listing.listingId}>
                <p className="detail-card-title">{listing.listingSummary}</p>
                <p className="detail-card-copy">
                  {formatPrice(listing.priceAmount, {
                    period: listing.pricePeriod,
                  })}
                  {" · "}
                  {listing.neighborhood ||
                    listing.borough ||
                    "Unknown location"}
                </p>
                <p className="detail-card-copy">
                  {formatConfidence(listing.confidenceOverall)}
                  {" · "}
                  {formatCount(listing.ambiguityCount, "ambiguity")}
                </p>
                <div className="detail-link-row">
                  <Link
                    to={`/listings?detail=open&listingId=${encodeURIComponent(listing.listingId)}`}
                  >
                    Open listing
                  </Link>
                  <Link to={buildReviewLink(listing)}>Review this listing</Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="detail-note">
            No extracted listings are linked to this observation yet.
          </p>
        )}
      </section>

      <section className="detail-section">
        <h3>Capture details</h3>
        <dl className="detail-facts">
          <div>
            <dt>Observation ID</dt>
            <dd className="detail-code">{detail.post.observationId}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd className="detail-code">{detail.post.runId}</dd>
          </div>
          <div>
            <dt>Stable post</dt>
            <dd className="detail-code">
              {detail.provenance.stablePostId || "Not linked"}
            </dd>
          </div>
          <div>
            <dt>Artifact path</dt>
            <dd className="detail-code">
              {detail.provenance.rawArtifactPath || "Not captured"}
            </dd>
          </div>
        </dl>
      </section>
    </article>
  );
}

function buildReviewLink(listing) {
  const searchParams = new URLSearchParams();

  if (listing?.reviewLinkTarget?.queue) {
    searchParams.set("queue", listing.reviewLinkTarget.queue);
  }

  if (listing?.reviewLinkTarget?.reviewId) {
    searchParams.set("detail", "open");
    searchParams.set("reviewId", listing.reviewLinkTarget.reviewId);
  }

  const query = searchParams.toString();
  return query ? `/review?${query}` : "/review";
}

function createPostsQueryActions(setQueryState) {
  return {
    openDetail(observationId) {
      setQueryState({
        detail: "open",
        observationId,
      });
    },
    setPage(page) {
      setQueryState({
        observationId: "",
        page,
      });
    },
    setPageSize(pageSize) {
      setQueryState({
        observationId: "",
        page: 1,
        pageSize,
      });
    },
    updateFilters(patch) {
      setQueryState({
        ...patch,
        observationId: "",
        page: 1,
      });
    },
  };
}

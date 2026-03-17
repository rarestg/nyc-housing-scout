import { useEffect, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDashboardShellSlots } from "../../app/shell-context.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { JsonDetails } from "../../components/JsonDetails.jsx";
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
  formatCount,
  formatLabel,
  formatRelativeTime,
} from "../../lib/formatters.js";
import { useUrlQueryState } from "../../lib/use-url-query-state.js";
import {
  buildApiUrl,
  buildInspectorHref,
  useDashboardSourceOptions,
  useJsonResource,
} from "../shared/route-support.jsx";

const DEBUG_QUERY_SCHEMA = {
  detail: { defaultValue: "open" },
  page: { defaultValue: 1, type: "number" },
  pageSize: { defaultValue: 50, type: "number" },
  runKind: { defaultValue: "" },
  sourceKey: { defaultValue: "" },
  status: { defaultValue: "" },
};

const DEBUG_STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Running", value: "running" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

const DEBUG_RUN_KIND_OPTIONS = [
  { label: "Any run kind", value: "" },
  { label: "Crawl", value: "crawl" },
];

const columnHelper = createColumnHelper();

const DEBUG_COLUMNS = [
  columnHelper.accessor("startedAt", {
    cell: ({ getValue }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatRelativeTime(getValue())}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatAbsoluteTime(getValue())}
        </span>
      </div>
    ),
    header: "Started",
    meta: { className: "column-tight" },
  }),
  columnHelper.accessor("sourceDisplayName", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate" title={getValue()}>
          {getValue()}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {formatLabel(row.original.runKind)}
        </span>
      </div>
    ),
    header: "Source",
    meta: { className: "debug-column-source" },
  }),
  columnHelper.accessor("status", {
    cell: ({ getValue, row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatLabel(getValue())}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {row.original.captureMethod || "unknown capture"}
        </span>
      </div>
    ),
    header: "Status",
    meta: { className: "column-tight debug-column-status" },
  }),
  columnHelper.display({
    cell: ({ row }) => (
      <div className="cell-stack cell-stack-dense">
        <strong className="cell-primary-truncate">
          {formatCount(row.original.observationCount, "observation")}
        </strong>
        <span className="cell-meta cell-meta-truncate">
          {row.original.freshObservationCount} fresh ·{" "}
          {row.original.seenObservationCount} seen
        </span>
      </div>
    ),
    header: "Coverage",
    id: "observations",
  }),
  columnHelper.accessor("listingCount", {
    cell: ({ getValue }) => formatCount(getValue(), "listing"),
    header: "Listings",
    meta: { className: "column-tight" },
  }),
  columnHelper.accessor("artifactCount", {
    cell: ({ getValue }) => formatCount(getValue(), "artifact"),
    header: "Artifacts",
    meta: { className: "column-tight" },
  }),
  columnHelper.accessor("id", {
    cell: ({ getValue }) => <span className="mono-cell">{getValue()}</span>,
    header: "Run ID",
  }),
];

export function DebugRoute() {
  const [queryState, setQueryState, searchParams] =
    useUrlQueryState(DEBUG_QUERY_SCHEMA);
  const params = useParams();
  const navigate = useNavigate();
  const queryActions = useMemo(
    () =>
      createDebugQueryActions({
        navigate,
        searchParams,
        setQueryState,
      }),
    [navigate, searchParams, setQueryState],
  );
  const runsState = useJsonResource(
    buildApiUrl("/api/dashboard/debug/runs", {
      page: queryState.page,
      pageSize: queryState.pageSize,
      runKind: queryState.runKind,
      sourceKey: queryState.sourceKey,
      status: queryState.status,
    }),
  );
  const { sourceOptions } = useDashboardSourceOptions();
  const selectedRunId = params.runId || "";
  const runDetailState = useJsonResource(
    selectedRunId
      ? `/api/dashboard/debug/runs/${encodeURIComponent(selectedRunId)}`
      : null,
  );

  const runsResponse = runsState.data;
  const runItems = runsResponse?.items || [];
  const selectedRow = runItems.find((row) => row.id === selectedRunId) || null;
  const selectedRun =
    runDetailState.data?.run?.id === selectedRunId ? runDetailState.data : null;
  const selectedRunOffPage = Boolean(selectedRunId && !selectedRow && selectedRun);

  useEffect(() => {
    if (!searchParams.has("runId")) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("runId");

    navigate(
      {
        pathname: params.runId
          ? `/debug/runs/${encodeURIComponent(params.runId)}`
          : "/debug",
        search: nextSearchParams.toString()
          ? `?${nextSearchParams.toString()}`
          : "",
      },
      { replace: true },
    );
  }, [navigate, params.runId, searchParams]);

  const toolbar = useMemo(
    () => (
      <FilterBar>
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

        <FilterField label="Status">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({ status: event.target.value })
            }
            value={queryState.status}
          >
            {DEBUG_STATUS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        <FilterField label="Run kind">
          <FilterSelect
            onChange={(event) =>
              queryActions.updateFilters({ runKind: event.target.value })
            }
            value={queryState.runKind}
          >
            {DEBUG_RUN_KIND_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterBar>
    ),
    [
      queryState.runKind,
      queryState.sourceKey,
      queryState.status,
      queryActions,
      sourceOptions,
    ],
  );

  const detailContent = useMemo(() => {
    if (!selectedRunId) {
      return null;
    }

    if (runDetailState.isLoading && !selectedRun) {
      return (
        <LoadingState
          message="Loading run detail and validation so the legacy inspector stays a secondary fallback."
          title="Loading run detail"
        />
      );
    }

    if (runDetailState.error && !selectedRun) {
      return (
        <ErrorState
          message={runDetailState.error.message}
          title="Could not load this run"
        />
      );
    }

    if (!selectedRun) {
      return null;
    }

    return <DebugDetail detail={selectedRun} />;
  }, [
    runDetailState.error,
    runDetailState.isLoading,
    selectedRun,
    selectedRunId,
  ]);

  const shellState = useMemo(
    () => ({
      description:
        "Advanced run forensics, validation, and artifact trails live here when listings, posts, and Review are not enough. Correction actions stay in Review so Debug remains forensic.",
      detailActions: selectedRun ? (
        <>
          <a
            href={buildInspectorHref(selectedRun.run.id)}
            rel="noreferrer"
            target="_blank"
          >
            Open full inspector
          </a>
          <a
            href={buildInspectorHref(selectedRun.run.id, "jobs")}
            rel="noreferrer"
            target="_blank"
          >
            Jobs inspector
          </a>
          <a
            href={buildInspectorHref(selectedRun.run.id, "artifacts")}
            rel="noreferrer"
            target="_blank"
          >
            Artifact inspector
          </a>
          {selectedRun.run.collectedExportPath ? (
            <a
              href={`/artifact-file?path=${encodeURIComponent(selectedRun.run.collectedExportPath)}`}
              rel="noreferrer"
              target="_blank"
            >
              Collected export
            </a>
          ) : null}
          {selectedRun.run.listingsExportPath ? (
            <a
              href={`/artifact-file?path=${encodeURIComponent(selectedRun.run.listingsExportPath)}`}
              rel="noreferrer"
              target="_blank"
            >
              Listings export
            </a>
          ) : null}
          <Link
            to={`/posts?sourceKey=${encodeURIComponent(selectedRun.run.sourceKey)}`}
          >
            Posts from source
          </Link>
          <Link
            to={`/listings?sourceKey=${encodeURIComponent(selectedRun.run.sourceKey)}`}
          >
            Listings from source
          </Link>
        </>
      ) : null,
      detailContent,
      detailEmptyMessage: selectedRunId
        ? "The selected run is outside the current page or no longer matches this scope."
        : "Select a run to inspect validation, exports, and deeper inspector handoffs.",
      detailEmptyTitle: "Select a run",
      detailMeta: selectedRun ? (
        <div className="detail-meta-list">
          <span className="detail-meta-item">
            {selectedRun.run.sourceDisplayName}
          </span>
          <span className="detail-meta-item">
            {formatLabel(selectedRun.run.status)}
          </span>
          <span
            className="detail-meta-item"
            title={formatAbsoluteTime(selectedRun.run.startedAt)}
          >
            Started {formatRelativeTime(selectedRun.run.startedAt)}
          </span>
          {selectedRunOffPage ? (
            <span className="detail-meta-item detail-meta-item-warning">
              Outside current page
            </span>
          ) : null}
        </div>
      ) : null,
      detailTitle: "Run detail",
      eyebrow: "Forensics",
      title: "Debug",
      toolbar,
    }),
    [detailContent, selectedRun, selectedRunId, selectedRunOffPage, toolbar],
  );

  useDashboardShellSlots(shellState);

  return (
    <RouteScaffold>
      {runsState.isLoading && !runsResponse ? (
        <LoadingState
          message="Loading the secondary debug surface."
          title="Loading runs"
        />
      ) : null}

      {runsState.error && !runsResponse ? (
        <ErrorState
          message={runsState.error.message}
          title="Could not load runs"
        />
      ) : null}

      {runsResponse ? (
        <>
          <DataTable
            ariaLabel="Debug runs table"
            caption="Run history and validation"
            className="records-table-shell debug-table-shell"
            columns={DEBUG_COLUMNS}
            data={runItems}
            emptyMessage="No runs match the current debug filters."
            emptyTitle="No matching runs"
            getRowId={(row) => row.id}
            isLoading={runsState.isLoading}
            onRowSelect={(row) => queryActions.openRun(row.id)}
            selectedRowId={selectedRunId}
          />

          <RoutePagination
            className="listings-pagination-compact"
            count={runItems.length}
            isRefreshing={runsState.isLoading}
            onNext={() => queryActions.setPage(queryState.page + 1)}
            onPageSizeChange={(pageSize) => queryActions.setPageSize(pageSize)}
            onPrevious={() =>
              queryActions.setPage(Math.max(1, queryState.page - 1))
            }
            pagination={runsResponse.pagination}
          />
        </>
      ) : null}
    </RouteScaffold>
  );
}

function DebugDetail({ detail }) {
  const run = detail.run;
  const validation = detail.validation;

  return (
    <article className="detail-stack">
      <section className="detail-section">
        <h3>Run summary</h3>
        <dl className="detail-facts">
          <div>
            <dt>Status</dt>
            <dd>{formatLabel(run.status)}</dd>
          </div>
          <div>
            <dt>Run kind</dt>
            <dd>{formatLabel(run.runKind)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatAbsoluteTime(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>
              {run.finishedAt
                ? formatAbsoluteTime(run.finishedAt)
                : "Still running"}
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDurationSeconds(run.durationSeconds)}</dd>
          </div>
          <div>
            <dt>Capture</dt>
            <dd>
              {run.captureMethod || "unknown"} ·{" "}
              {run.browserProfile || "unknown profile"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="detail-section">
        <h3>Validation</h3>
        <dl className="detail-facts">
          <div>
            <dt>Healthy</dt>
            <dd>{validation.isHealthy ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Observations</dt>
            <dd>
              {formatCount(validation.counts.observations, "observation")}
            </dd>
          </div>
          <div>
            <dt>Listings</dt>
            <dd>{formatCount(validation.counts.listings, "listing")}</dd>
          </div>
          <div>
            <dt>Run steps</dt>
            <dd>{formatCount(validation.counts.runSteps, "step")}</dd>
          </div>
          <div>
            <dt>Artifacts</dt>
            <dd>{formatCount(validation.counts.artifacts, "artifact")}</dd>
          </div>
          <div>
            <dt>Raw artifacts</dt>
            <dd>{formatCount(validation.counts.rawArtifacts, "artifact")}</dd>
          </div>
        </dl>
        {validation.issues.length ? (
          <ul>
            {validation.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="detail-note">
            No validation issues were reported for this run.
          </p>
        )}
      </section>

      <section className="detail-section">
        <h3>Raw payloads</h3>
        <JsonDetails summary="Run JSON" value={run} />
        <JsonDetails summary="Validation JSON" value={validation} />
      </section>
    </article>
  );
}

function createDebugQueryActions({ navigate, searchParams, setQueryState }) {
  return {
    openRun(runId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("runId");
      nextSearchParams.delete("detail");

      navigate({
        pathname: `/debug/runs/${encodeURIComponent(runId)}`,
        search: nextSearchParams.toString()
          ? `?${nextSearchParams.toString()}`
          : "",
      });
    },
    setPage(page) {
      setQueryState({ page });
    },
    setPageSize(pageSize) {
      setQueryState({
        page: 1,
        pageSize,
      });
    },
    updateFilters(patch) {
      setQueryState({
        ...patch,
        page: 1,
      });
    },
  };
}

function formatDurationSeconds(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return "Unknown";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }

  return `${remainder}s`;
}

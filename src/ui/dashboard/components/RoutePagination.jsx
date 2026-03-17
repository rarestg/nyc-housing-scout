import { FilterSelect } from "./FilterControls.jsx";

const PAGE_SIZE_OPTIONS = Object.freeze([25, 50, 100]);

export function RoutePagination({
  className = "",
  count,
  isRefreshing,
  onNext,
  onPageSizeChange,
  onPrevious,
  pagination,
}) {
  if (!pagination) {
    return null;
  }

  const { page, pageEnd, pageSize, pageStart, totalItems } =
    getPaginationWindow(pagination, count);

  return (
    <div className={`listings-pagination ${className}`.trim()}>
      <p aria-live="polite" className="listings-pagination-meta">
        {totalItems
          ? `Page ${page} of ${pagination.totalPages} · rows ${pageStart}-${pageEnd}`
          : "No matching rows"}
        {isRefreshing ? " · refreshing results" : ""}
      </p>

      <div className="listings-pagination-actions">
        <label className="listings-pagination-size">
          <span>Page size</span>
          <FilterSelect
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </FilterSelect>
        </label>

        <button
          className="shell-button shell-button-quiet"
          disabled={!pagination.hasPreviousPage}
          onClick={onPrevious}
          type="button"
        >
          Previous page
        </button>
        <button
          className="shell-button"
          disabled={!pagination.hasNextPage}
          onClick={onNext}
          type="button"
        >
          Next page
        </button>
      </div>
    </div>
  );
}

function getPaginationWindow(pagination, count) {
  if (!pagination) {
    return {
      page: 1,
      pageEnd: 0,
      pageSize: PAGE_SIZE_OPTIONS[1],
      pageStart: 0,
      totalItems: 0,
    };
  }

  const page = pagination.page || 1;
  const pageSize = pagination.pageSize || PAGE_SIZE_OPTIONS[1];
  const totalItems = pagination.totalItems || 0;
  const pageStart = totalItems ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = totalItems ? pageStart + count - 1 : 0;

  return {
    page,
    pageEnd,
    pageSize,
    pageStart,
    totalItems,
  };
}

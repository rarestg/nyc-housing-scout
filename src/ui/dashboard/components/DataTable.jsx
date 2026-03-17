import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { EmptyState } from './StateViews.jsx';

export function DataTable({
  ariaLabel,
  caption,
  className = '',
  columns,
  data,
  emptyMessage,
  emptyTitle,
  enableSorting = false,
  getRowId,
  initialSorting = [],
  isLoading = false,
  onRowSelect,
  selectedRowId = '',
}) {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    initialState: {
      sorting: initialSorting,
    },
  });

  if (!data.length) {
    return <EmptyState message={emptyMessage} title={emptyTitle} />;
  }

  return (
    <div aria-busy={isLoading} className={`table-shell ${className}`.trim()}>
      <table aria-label={ariaLabel} className="data-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = enableSorting && header.column.getCanSort();
                const sortDirection = header.column.getIsSorted();

                return (
                  <th
                    className={header.column.columnDef.meta?.className || ''}
                    key={header.id}
                    scope="col"
                  >
                    {header.isPlaceholder ? null : (
                      canSort ? (
                        <button
                          className="table-sort-button"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span className="table-sort-indicator" aria-hidden="true">
                            {sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '·'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const isSelected = row.id === selectedRowId;

            return (
              <tr
                aria-selected={isSelected}
                className={isSelected ? 'is-selected' : ''}
                key={row.id}
                onClick={() => onRowSelect?.(row.original)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowSelect?.(row.original);
                    return;
                  }

                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.currentTarget.nextElementSibling?.focus();
                    return;
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.currentTarget.previousElementSibling?.focus();
                  }
                }}
                tabIndex={onRowSelect ? 0 : -1}
              >
                {row.getVisibleCells().map((cell) => (
                  <td className={cell.column.columnDef.meta?.className || ''} key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

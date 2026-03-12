'use client';

import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkeletonTable } from './Skeleton';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface BulkAction {
  label: string;
  action: string;
  variant?: 'danger' | 'default';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  pageSizeOptions?: number[];
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  loading?: boolean;
  selectable?: boolean;
  bulkActions?: BulkAction[];
  onBulkAction?: (selectedIds: string[], action: string) => void;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [10, 25, 50],
  emptyMessage = 'No data found',
  emptyState,
  loading = false,
  selectable = false,
  bulkActions = [],
  onBulkAction,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const getRowId = (item: T, idx: number): string =>
    (item.id as string) ?? String(idx);

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null || bVal == null) return 0;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = sortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const paginatedIds = paginatedData.map((item, idx) => getRowId(item, (currentPage - 1) * pageSize + idx));
  const allSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));
  const someSelected = paginatedIds.some(id => selectedIds.has(id));

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const effectiveCols = selectable ? columns.length + 1 : columns.length;

  return (
    <div className="w-full">
      {/* Bulk action bar */}
      {selectable && selectedIds.size > 0 && bulkActions.length > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 rounded-lg bg-muted border border-border">
          <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            {bulkActions.map(ba => (
              <button
                key={ba.action}
                onClick={() => onBulkAction?.(Array.from(selectedIds), ba.action)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  ba.variant === 'danger'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-[#D4AF37] hover:bg-[#c9a832] text-black'
                )}
              >
                {ba.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
        {loading ? (
          <SkeletonTable rows={5} cols={effectiveCols} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                {selectable && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      className="rounded border-border"
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-left font-semibold text-[hsl(var(--muted-foreground))] whitespace-nowrap',
                      col.sortable && 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]',
                      col.className
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && sortKey === col.key && (
                        sortDir === 'asc' ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={effectiveCols} className="px-4 py-0 text-center">
                    {emptyState ?? (
                      <p className="py-12 text-[hsl(var(--muted-foreground))]">{emptyMessage}</p>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedData.map((item, idx) => {
                  const rowId = getRowId(item, (currentPage - 1) * pageSize + idx);
                  const isSelected = selectedIds.has(rowId);
                  return (
                    <tr
                      key={idx}
                      className={cn(
                        'border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))] transition-colors',
                        isSelected && 'bg-[hsl(var(--accent))]'
                      )}
                    >
                      {selectable && (
                        <td className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(rowId)}
                            className="rounded border-border"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-4 py-3 text-[hsl(var(--card-foreground))] whitespace-nowrap',
                            col.className
                          )}
                        >
                          {col.render
                            ? col.render(item)
                            : (item[col.key] as React.ReactNode)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && (totalPages > 1 || pageSizeOptions.length > 1) && (
        <div className="flex items-center justify-between mt-4 px-1 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {sortedData.length > 0
                ? `Showing ${(currentPage - 1) * pageSize + 1} to ${Math.min(currentPage * pageSize, sortedData.length)} of ${sortedData.length} entries`
                : '0 entries'}
            </p>
            {pageSizeOptions.length > 1 && (
              <select
                value={pageSize}
                onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="ml-2 text-sm border border-border rounded-lg px-2 py-1 bg-background text-foreground"
              >
                {pageSizeOptions.map(opt => (
                  <option key={opt} value={opt}>{opt} / page</option>
                ))}
              </select>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={cn(
                    'w-9 h-9 rounded-lg text-sm font-medium transition-colors',
                    page === currentPage
                      ? 'bg-brand-gold text-white'
                      : 'hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]'
                  )}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

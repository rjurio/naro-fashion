'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface ServerPagerProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Noun for the summary line, e.g. "orders". */
  itemLabel?: string;
}

/** Prev / next pager for server-side paginated lists. */
export default function ServerPager({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  loading = false,
  itemLabel = 'items',
}: ServerPagerProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn =
    'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-sm hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <p className="text-sm text-[hsl(var(--muted-foreground))] flex items-center gap-2">
        {total > 0 ? `Showing ${from}–${to} of ${total} ${itemLabel}` : `0 ${itemLabel}`}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-gold" />}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>
        <span className="text-sm text-[hsl(var(--muted-foreground))] whitespace-nowrap">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button type="button" className={btn} disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

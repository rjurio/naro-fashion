'use client';

import { CloudUpload, AlertTriangle } from 'lucide-react';
import { pendingStateOf, type PendingSyncState } from '@/lib/offline/pending-overlay';

interface Props {
  /** A record returned through the pending overlay (reads `__pending` / `__syncState`)… */
  record?: unknown;
  /** …or an explicit state. */
  state?: PendingSyncState | null;
  className?: string;
}

/**
 * Small pill for rows/details that carry changes saved on this device and not
 * yet on the server: "Pending sync" (waiting) or "Needs review" (the sync
 * failed or conflicted — open the sync panel). Renders nothing otherwise.
 */
export default function PendingSyncPill({ record, state, className = '' }: Props) {
  const s = state ?? pendingStateOf(record);
  if (!s) return null;
  if (s === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 ring-1 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800 whitespace-nowrap ${className}`}
        title="Saved on this device — will sync when online"
      >
        <CloudUpload className="w-3 h-3" aria-hidden />
        Pending sync
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800 whitespace-nowrap ${className}`}
      title={s === 'conflict' ? 'Changed online since you edited it — review it in the sync panel' : "Couldn't sync — review it in the sync panel"}
    >
      <AlertTriangle className="w-3 h-3" aria-hidden />
      Needs review
    </span>
  );
}

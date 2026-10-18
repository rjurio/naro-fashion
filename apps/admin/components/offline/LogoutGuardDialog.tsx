'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, LogOut, UploadCloud, X } from 'lucide-react';
import { useSyncStatus } from '@/contexts/SyncContext';
import { countUnsynced } from '@/lib/offline/outbox';
import { currentSyncScope } from '@/lib/offline/sync-engine';

/** Number of this user's offline changes that haven't synced (pending, failed or conflict). */
export function countUnsyncedForCurrentUser(): Promise<number> {
  return countUnsynced(currentSyncScope());
}

interface Props {
  /** Unsynced count when the dialog opened. */
  initialCount: number;
  onCancel: () => void;
  onLogout: () => void;
}

/**
 * Shown before logging out when this user has unsynced offline changes.
 * They are NOT deleted on logout — they stay on the device (scoped to this
 * user) and sync the next time the same user signs in.
 */
export default function LogoutGuardDialog({ initialCount, onCancel, onLogout }: Props) {
  const status = useSyncStatus();
  const [count, setCount] = useState(initialCount);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !syncing) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, syncing]);

  const doSync = async () => {
    setSyncing(true);
    setNote(null);
    try {
      await status.syncNow();
      const left = await countUnsyncedForCurrentUser();
      setCount(left);
      if (left === 0) {
        onLogout();
        return;
      }
      setNote(`${left} ${left === 1 ? 'change still needs' : 'changes still need'} attention (failed, conflict or waiting).`);
    } finally {
      setSyncing(false);
    }
  };

  if (typeof document === 'undefined') return null;
  const canSync = status.online && !status.needsLogin;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !syncing && onCancel()} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-guard-title"
        aria-describedby="logout-guard-desc"
        className="relative w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-[hsl(var(--card-foreground))] shadow-2xl outline-none"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 id="logout-guard-title" className="text-lg font-semibold text-[hsl(var(--foreground))]">
              Unsynced changes
            </h3>
            <p id="logout-guard-desc" className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {count} {count === 1 ? "change hasn't" : "changes haven't"} synced yet. They&apos;ll stay on this device and sync
              next time you sign in.
            </p>
            {note && (
              <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {note}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={syncing}
            aria-label="Cancel"
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={syncing}
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onLogout}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4" />
            Log out anyway
          </button>
          {canSync && (
            <button
              type="button"
              onClick={() => void doSync()}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

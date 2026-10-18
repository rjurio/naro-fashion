'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  LogIn,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSyncStatus } from '@/contexts/SyncContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeBlocked,
  discard,
  listOutbox,
  offlineReceiptNumber,
  retry,
  subscribe as subscribeOutbox,
  type OutboxEntry,
} from '@/lib/offline/outbox';
import { currentSyncScope } from '@/lib/offline/sync-engine';
import ConflictReviewModal from './ConflictReviewModal';
import { formatClock, formatRelative } from './SyncStatusBadge';

interface Props {
  open: boolean;
  onClose: () => void;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        <span>{title}</span>
        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--foreground))]">{count}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * Right-side drawer listing this user's offline changes: waiting to sync,
 * need review (failed + conflicts) and recently synced. Opened from the
 * sync status badge.
 */
export default function SyncDrawer({ open, onClose }: Props) {
  const status = useSyncStatus();
  const { logout } = useAuth();
  const now = useNow();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [reviewEntry, setReviewEntry] = useState<OutboxEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const scope = currentSyncScope();
    setEntries(scope ? await listOutbox(scope) : []);
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
    const unsub = subscribeOutbox(() => void reload());
    return unsub;
  }, [open, reload]);

  // Reload when the engine finishes a run.
  useEffect(() => {
    if (open && !status.syncing) void reload();
  }, [open, status.syncing, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !reviewEntry) onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, reviewEntry]);

  const blocked = useMemo(() => computeBlocked(entries), [entries]);
  const waiting = entries.filter((e) => e.status === 'pending' || e.status === 'syncing');
  const failed = entries.filter((e) => e.status === 'failed');
  const conflicts = entries.filter((e) => e.status === 'conflict');
  const done = entries
    .filter((e) => e.status === 'done')
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  const doSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await status.syncNow();
      if (r.skipped === 'locked') setMessage('Another tab is syncing — this list updates when it finishes.');
      else if (r.skipped === 'offline') setMessage("You're offline — changes will sync when the connection is back.");
      else if (r.synced || r.failed || r.conflicts) {
        const parts = [
          r.synced ? `${r.synced} synced` : '',
          r.failed ? `${r.failed} failed` : '',
          r.conflicts ? `${r.conflicts} need review` : '',
        ].filter(Boolean);
        setMessage(parts.join(' · '));
      }
    } finally {
      setSyncing(false);
      void reload();
    }
  };

  const doRetry = async (id: string) => {
    setBusyId(id);
    try {
      await retry(id);
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const doDiscard = async (e: OutboxEntry) => {
    // POS sales: the cash was already taken — require an explicit second click.
    if (e.kind === 'pos.sale' && confirmDiscardId !== e.id) {
      setConfirmDiscardId(e.id);
      return;
    }
    setBusyId(e.id);
    try {
      await discard(e.id);
      setConfirmDiscardId(null);
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const canSync = status.online && !status.needsLogin;

  // Portal: the TopBar's backdrop-filter would otherwise trap `position: fixed`.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-drawer-title"
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
          <div>
            <h2 id="sync-drawer-title" className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Changes on this device
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {status.online ? 'Online' : 'Offline'} · last synced {formatRelative(status.lastSyncAt, now).toLowerCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {status.needsLogin && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
              <LogIn className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-medium">
                  Sign in again to sync {status.pendingCount} {status.pendingCount === 1 ? 'change' : 'changes'}.
                </p>
                <p className="mt-0.5">Your session expired. Changes stay on this device until you sign in.</p>
                <button
                  type="button"
                  onClick={logout}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  <LogIn className="h-3.5 w-3.5" /> Sign in again
                </button>
              </div>
            </div>
          )}

          {message && (
            <p role="status" className="rounded-md bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--foreground))]">
              {message}
            </p>
          )}

          <Section title="Waiting to sync" count={waiting.length}>
            {waiting.length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing waiting.</p>
            ) : (
              <ul className="space-y-1.5">
                {waiting.map((e) => (
                  <li key={e.id} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2">
                    <div className="flex items-start gap-2">
                      {e.status === 'syncing' ? (
                        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" aria-hidden="true" />
                      ) : (
                        <UploadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]" title={e.label}>
                          {e.label}
                        </p>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {e.kind === 'pos.sale' ? `${offlineReceiptNumber(e.id)} · ` : ''}
                          {formatRelative(e.createdAt, now)}
                          {e.status === 'syncing' ? ' · syncing…' : ''}
                        </p>
                        {blocked.has(e.id) && (
                          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                            Blocked by an earlier change to the same record — resolve it below first.
                          </p>
                        )}
                        {!blocked.has(e.id) && e.lastError && e.nextAttemptAt > now && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {e.lastError.message} Retrying at {formatClock(e.nextAttemptAt)}.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Need review" count={failed.length + conflicts.length}>
            {failed.length + conflicts.length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing needs review.</p>
            ) : (
              <ul className="space-y-1.5">
                {conflicts.map((e) => (
                  <li key={e.id} className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]" title={e.label}>
                          {e.label}
                        </p>
                        <p className="text-[11px] text-amber-800 dark:text-amber-300">
                          Conflict — changed online since you edited it.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReviewEntry(e)}
                        className="shrink-0 rounded-md bg-brand-gold px-2.5 py-1 text-[11px] font-medium text-black hover:opacity-90"
                      >
                        Review
                      </button>
                    </div>
                  </li>
                ))}
                {failed.map((e) => {
                  const confirming = confirmDiscardId === e.id;
                  return (
                    <li key={e.id} className="rounded-lg border border-red-300 bg-red-50/60 px-3 py-2 dark:border-red-800 dark:bg-red-950/30">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]" title={e.label}>
                            {e.label}
                          </p>
                          <p className="break-words text-[11px] text-red-700 dark:text-red-300">
                            Failed: {e.lastError?.message ?? 'The server refused this change.'}
                          </p>
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                            {e.kind === 'pos.sale' ? `${offlineReceiptNumber(e.id)} · ` : ''}
                            {formatRelative(e.createdAt, now)}
                          </p>
                        </div>
                      </div>
                      {confirming && (
                        <p role="alert" className="mt-2 rounded-md bg-red-100 px-2 py-1.5 text-[11px] text-red-800 dark:bg-red-900/50 dark:text-red-200">
                          Cash was already taken for this sale. Discarding removes it from this device and it will never
                          reach the server — record it another way first. Click “Discard sale” again to confirm.
                        </p>
                      )}
                      <div className="mt-2 flex justify-end gap-2">
                        {confirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmDiscardId(null)}
                            className="rounded-md border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void doDiscard(e)}
                          disabled={busyId === e.id}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-60',
                            confirming
                              ? 'bg-red-600 text-white hover:bg-red-700'
                              : 'border border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40',
                          )}
                        >
                          {busyId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          {e.kind === 'pos.sale' ? 'Discard sale' : 'Discard'}
                        </button>
                        {!confirming && (
                          <button
                            type="button"
                            onClick={() => void doRetry(e.id)}
                            disabled={busyId === e.id}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-gold px-2.5 py-1 text-[11px] font-medium text-black hover:opacity-90 disabled:opacity-60"
                          >
                            {busyId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Retry
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Recently synced" count={done.length}>
            {done.length === 0 ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing synced from this device yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {done.map((e) => {
                  const orderNumber =
                    e.kind === 'pos.sale' && e.result && typeof e.result === 'object'
                      ? ((e.result as { order?: { orderNumber?: string } }).order?.orderNumber ?? null)
                      : null;
                  return (
                    <li key={e.id} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2">
                      <div className="flex items-start gap-2">
                        {e.warning ? (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]" title={e.label}>
                            {e.label}
                          </p>
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                            {orderNumber ? `${offlineReceiptNumber(e.id)} → ${orderNumber} · ` : ''}
                            synced {formatRelative(e.doneAt ?? null, now).toLowerCase()}
                          </p>
                          {e.warning && (
                            <p className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">{e.warning}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="border-t border-[hsl(var(--border))] px-4 py-3">
          <button
            type="button"
            onClick={() => void doSync()}
            disabled={syncing || status.syncing || !canSync}
            title={!status.online ? 'Reconnect to sync' : status.needsLogin ? 'Sign in again to sync' : undefined}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-gold px-3 py-2 text-sm font-medium text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing || status.syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {syncing || status.syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {!status.online && (
            <p className="mt-1.5 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
              Offline — changes sync automatically when the connection is back.
            </p>
          )}
        </div>
      </div>

      {reviewEntry && (
        <ConflictReviewModal
          entry={reviewEntry}
          onClose={() => setReviewEntry(null)}
          onResolved={(choice) => {
            setReviewEntry(null);
            setMessage(choice === 'mine' ? 'Your change was queued again on top of the online version.' : 'Kept the online version.');
            void reload();
          }}
        />
      )}
    </>,
    document.body,
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, ListChecks, Loader2, LogIn, RefreshCw, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSyncStatus, type SyncStatus } from '@/contexts/SyncContext';
import SyncDrawer from './SyncDrawer';

type BadgeState = 'offline' | 'login' | 'review' | 'syncing' | 'pending' | 'remote' | 'ok';

export function badgeState(s: SyncStatus): BadgeState {
  if (!s.online) return 'offline';
  if (s.needsLogin) return 'login';
  if (s.conflictCount + s.failedCount > 0) return 'review';
  if (s.syncing) return 'syncing';
  if (s.pendingCount > 0) return 'pending';
  if (s.remoteChanges && s.remoteChanges.total > 0) return 'remote';
  return 'ok';
}

export function formatClock(ms: number | null): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/** "just now", "2 min ago", "3 h ago", or a date for older values. */
export function formatRelative(ms: number | null, now: number): string {
  if (!ms) return 'Never';
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  try {
    return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${Math.floor(h / 24)} d ago`;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function labels(state: BadgeState, s: SyncStatus): { long: string; short: string } {
  switch (state) {
    case 'offline':
      return s.pendingCount > 0
        ? { long: `Offline · ${plural(s.pendingCount, 'change')} saved`, short: 'Offline' }
        : { long: 'Offline', short: 'Offline' };
    case 'login':
      return {
        long: s.pendingCount > 0 ? `Sign in again to sync ${plural(s.pendingCount, 'change')}` : 'Sign in again to sync',
        short: 'Sign in',
      };
    case 'review': {
      const n = s.conflictCount + s.failedCount;
      return { long: `${n} need review`, short: `${n} review` };
    }
    case 'syncing':
      return { long: 'Syncing…', short: 'Syncing' };
    case 'pending':
      return { long: `${s.pendingCount} waiting to sync`, short: `${s.pendingCount} waiting` };
    case 'remote':
      return { long: 'Newer data online', short: 'Update' };
    default:
      return { long: 'Online · Up to date', short: 'Online' };
  }
}

const STATE_STYLES: Record<BadgeState, { pill: string; dot: string }> = {
  offline: {
    pill: 'border-zinc-400/50 bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600',
    dot: 'bg-zinc-500',
  },
  login: {
    pill: 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
    dot: 'bg-red-500',
  },
  review: {
    pill: 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
    dot: 'bg-red-500',
  },
  syncing: {
    pill: 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
    dot: 'bg-blue-500',
  },
  pending: {
    pill: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    dot: 'bg-amber-500',
  },
  remote: {
    pill: 'border-brand-gold/40 bg-brand-gold/10 text-[hsl(var(--foreground))]',
    dot: 'bg-brand-gold',
  },
  ok: {
    pill: 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 dark:border-green-800',
    dot: 'bg-green-500',
  },
};

function StateIcon({ state, className }: { state: BadgeState; className?: string }) {
  switch (state) {
    case 'offline':
      return <CloudOff className={className} aria-hidden="true" />;
    case 'login':
      return <LogIn className={className} aria-hidden="true" />;
    case 'review':
      return <AlertTriangle className={className} aria-hidden="true" />;
    case 'syncing':
      return <Loader2 className={cn(className, 'animate-spin')} aria-hidden="true" />;
    case 'pending':
      return <UploadCloud className={className} aria-hidden="true" />;
    case 'remote':
      return <RefreshCw className={className} aria-hidden="true" />;
    default:
      return <CheckCircle2 className={className} aria-hidden="true" />;
  }
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

interface SyncStatusBadgeProps {
  /** `compact` = dot + short label on every viewport (POS header). */
  compact?: boolean;
  /** Panel alignment relative to the badge. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Online/offline + sync status pill with a details panel.
 * Priority: Offline → need review → Syncing → waiting to sync → Newer data online → Up to date.
 */
export default function SyncStatusBadge({ compact = false, align = 'right', className }: SyncStatusBadgeProps) {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const now = useNow();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Render the neutral "online" pill until mounted, so SSR and first client render match.
  const state: BadgeState = mounted ? badgeState(status) : 'ok';
  const { long, short } = labels(state, status);
  const styles = STATE_STYLES[state];

  const doRefresh = () => {
    setRefreshing(true);
    status.refresh();
  };

  const rc = status.remoteChanges;
  const rcRows = rc
    ? ([
        ['Products', rc.products],
        ['Categories', rc.categories],
        ['Orders', rc.orders],
        ['Rentals', rc.rentals],
        ['Expenses', rc.expenses],
      ] as const).filter(([, n]) => n > 0)
    : [];

  return (
    <div className={cn('relative inline-flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Connection status: ${long}. Show sync details`}
        title={long}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90',
          styles.pill,
        )}
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {(state === 'syncing' || state === 'remote') && (
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', styles.dot)} />
          )}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', styles.dot)} />
        </span>
        <StateIcon state={state} className={cn('h-3.5 w-3.5', compact ? 'hidden' : 'hidden md:inline')} />
        {compact ? (
          <span>{short}</span>
        ) : (
          <>
            <span className="md:hidden">{short}</span>
            <span className="hidden md:inline">{long}</span>
          </>
        )}
      </button>

      {state === 'remote' && (
        <button
          type="button"
          onClick={doRefresh}
          disabled={refreshing}
          aria-label="Refresh to load newer data"
          title="Refresh to load newer data"
          className="inline-flex items-center gap-1 rounded-full bg-brand-gold px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
          <span className={compact ? 'sr-only' : 'hidden lg:inline'}>Refresh</span>
        </button>
      )}

      {/* Polite live region: announces status changes without stealing focus. */}
      <span className="sr-only" role="status" aria-live="polite">
        {mounted ? long : ''}
      </span>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Sync status"
            className={cn(
              'absolute top-full mt-2 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-lg',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Sync status</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <StateIcon state={state} className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium text-[hsl(var(--foreground))]">{long}</p>
                  {state === 'offline' && (
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      {status.browserOnline
                        ? "Your device is connected, but the server can't be reached."
                        : 'Your device has no internet connection.'}{' '}
                      Working offline. Showing data saved on this device
                      {status.showingCachedSince || status.lastSyncAt
                        ? ` (from ${formatClock(status.showingCachedSince ?? status.lastSyncAt)})`
                        : ''}
                      . POS sales are saved here and sync automatically; most other changes need internet.
                    </p>
                  )}
                  {state === 'login' && (
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Your session expired. Queued changes stay on this device and sync after you sign in again.
                    </p>
                  )}
                  {state !== 'offline' && status.showingCachedSince && (
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      This page is showing data saved at {formatClock(status.showingCachedSince)}. Refresh to load the latest.
                    </p>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-[hsl(var(--muted-foreground))]">Connection</dt>
                <dd className="text-right text-[hsl(var(--foreground))]">
                  {!status.browserOnline ? 'No internet' : status.serverReachable ? 'Connected' : 'Server unreachable'}
                </dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Last synced</dt>
                <dd className="text-right text-[hsl(var(--foreground))]" title={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : undefined}>
                  {formatRelative(status.lastSyncAt, now)}
                </dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Waiting to sync</dt>
                <dd className="text-right text-[hsl(var(--foreground))]">{status.pendingCount}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Need review</dt>
                <dd className={cn('text-right', status.conflictCount + status.failedCount > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-[hsl(var(--foreground))]')}>
                  {status.conflictCount + status.failedCount}
                </dd>
              </dl>

              {state === 'offline' && status.pendingCount > 0 && (
                <p className="rounded-md bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--foreground))]">
                  {plural(status.pendingCount, 'change')} saved on this device.
                </p>
              )}

              {rcRows.length > 0 && (
                <div className="rounded-md border border-brand-gold/30 bg-brand-gold/5 px-3 py-2">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))]">Changed online since this page loaded</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {rcRows.map(([label, n]) => (
                      <li key={label} className="flex justify-between">
                        <span>{label}</span>
                        <span className="text-[hsl(var(--foreground))]">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="border-t border-[hsl(var(--border))] px-4 pt-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setDrawerOpen(true);
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <ListChecks className="h-3.5 w-3.5" />
                Changes on this device
                {status.pendingCount + status.failedCount + status.conflictCount > 0 &&
                  ` (${status.pendingCount + status.failedCount + status.conflictCount})`}
              </button>
            </div>

            <div className="flex gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => void status.checkNow()}
                disabled={status.checking}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status.checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {status.checking ? 'Checking…' : 'Check now'}
              </button>
              <button
                type="button"
                onClick={doRefresh}
                disabled={refreshing || !status.online}
                title={!status.online ? 'Reconnect to load the latest data' : undefined}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </>
      )}

      <SyncDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

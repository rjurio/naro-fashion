'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatTzs,
  getConflict,
  keepMine,
  keepOnline,
  type ConflictRecord,
  type OutboxEntry,
} from '@/lib/offline/outbox';

/** Request-only keys that aren't record fields. */
const META_KEYS = new Set(['id', 'expectedUpdatedAt', 'expectedStatus', 'offline', 'clientCreatedAt', 'sessionId']);

const MONEY_KEY = /(price|amount|total|cost|fee|deposit|basePrice|subtotal)$/i;
const DATE_KEY = /(At|Date)$/;

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function formatConflictValue(key: string, v: unknown): string {
  if (v === undefined) return '—';
  if (v === null || v === '') return 'Empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (key === 'status' && typeof v === 'string') {
    return v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
  if (MONEY_KEY.test(key) && (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))))) {
    return formatTzs(Number(v));
  }
  if (DATE_KEY.test(key) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) {
    try {
      return new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return v;
    }
  }
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'item' : 'items'}`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

interface Props {
  entry: OutboxEntry;
  onClose: () => void;
  /** Called after a resolution was stored (the caller reloads / syncs). */
  onResolved: (choice: 'mine' | 'online') => void;
}

/**
 * "Your change" vs "Online now" for a 409 CONFLICT. Keep mine re-queues the
 * change on top of the current version (new idempotency key); Keep online
 * drops the queued change.
 */
export default function ConflictReviewModal({ entry, onClose, onResolved }: Props) {
  const [record, setRecord] = useState<ConflictRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'mine' | 'online' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getConflict(entry.id).then((r) => {
      if (cancelled) return;
      setRecord(r);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const mine = record?.mine ?? entry.body;
  const current = (record?.current ?? null) as Record<string, unknown> | null;

  const rows = useMemo(() => {
    const keys = Object.keys(mine).filter((k) => !META_KEYS.has(k));
    return keys.map((k) => ({
      key: k,
      label: humanize(k),
      mine: mine[k],
      online: current ? current[k] : undefined,
      differs: !current || !same(mine[k], current[k]),
    }));
  }, [mine, current]);

  const differing = rows.filter((r) => r.differs);
  const unchanged = rows.filter((r) => !r.differs);
  const visible = showSame ? rows : differing;

  const resolve = async (choice: 'mine' | 'online') => {
    setBusy(choice);
    setError(null);
    try {
      const ok = choice === 'mine' ? await keepMine(entry.id) : await keepOnline(entry.id);
      if (!ok) throw new Error('Could not save your choice on this device.');
      onResolved(choice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const onlineUpdated =
    current && typeof current.updatedAt === 'string' ? formatConflictValue('updatedAt', current.updatedAt) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-desc"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/60">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            </div>
            <div>
              <h2 id="conflict-title" className="text-base font-semibold text-[hsl(var(--foreground))]">
                Review conflict
              </h2>
              <p id="conflict-desc" className="text-xs text-[hsl(var(--muted-foreground))]">
                {entry.label} — this record was changed online after you edited it
                {onlineUpdated ? ` (online version from ${onlineUpdated})` : ''}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {!loaded ? (
            <p className="flex items-center gap-2 py-6 text-sm text-[hsl(var(--muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              {!current && (
                <p className="mb-3 rounded-md bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--foreground))]">
                  The server didn&apos;t send its current version (the record may have been deleted). Keep online discards your
                  change; Keep mine sends it again.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Your change compared with the online version</caption>
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Field
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Your change
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Online now
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-[hsl(var(--muted-foreground))]">
                          No differing fields — the record changed in other fields only.
                        </td>
                      </tr>
                    )}
                    {visible.map((r) => (
                      <tr key={r.key} className="border-b border-[hsl(var(--border))] align-top last:border-0">
                        <th scope="row" className="py-2 pr-3 font-medium text-[hsl(var(--foreground))]">
                          {r.label}
                        </th>
                        <td
                          className={cn(
                            'py-2 pr-3 break-words',
                            r.differs ? 'font-medium text-blue-700 dark:text-blue-300' : 'text-[hsl(var(--foreground))]',
                          )}
                        >
                          {formatConflictValue(r.key, r.mine)}
                        </td>
                        <td
                          className={cn(
                            'py-2 break-words',
                            r.differs ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-[hsl(var(--foreground))]',
                          )}
                        >
                          {current ? formatConflictValue(r.key, r.online) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unchanged.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSame((v) => !v)}
                  className="mt-2 text-xs text-[hsl(var(--muted-foreground))] underline underline-offset-2 hover:text-[hsl(var(--foreground))]"
                >
                  {showSame ? 'Hide' : 'Show'} {unchanged.length} unchanged {unchanged.length === 1 ? 'field' : 'fields'}
                </button>
              )}
              {error && (
                <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[hsl(var(--border))] px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={() => void resolve('online')}
            disabled={!!busy || !loaded}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === 'online' && <Loader2 className="h-4 w-4 animate-spin" />}
            Keep online
          </button>
          <button
            type="button"
            onClick={() => void resolve('mine')}
            disabled={!!busy || !loaded}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === 'mine' && <Loader2 className="h-4 w-4 animate-spin" />}
            Keep mine
          </button>
        </div>
      </div>
    </div>
  );
}

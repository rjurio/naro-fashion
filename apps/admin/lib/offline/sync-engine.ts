/**
 * Sync engine (admin offline mode, Phase 3): replays the offline outbox.
 *
 * Runs when the API becomes reachable again, every 60 s while online, right
 * after a write is queued, and on "Sync now". One runner across tabs via the
 * Web Locks API (`naro-admin-sync`); without it, an in-tab flag — duplicates
 * across tabs are still harmless because every entry carries its
 * Idempotency-Key.
 *
 * Order: the CURRENT user's entries, strictly by createdAt. When an entry for
 * record X is failed/conflict, later entries for X are held ("blocked by
 * earlier change"); other records continue.
 *
 * Outcomes per entry:
 *   2xx (incl. Idempotency-Replayed)          → done (last 50 kept as "Recently synced")
 *   409 CONFLICT                              → conflict (+ conflicts store: current vs mine)
 *   409 IDEMPOTENCY_IN_PROGRESS               → backoff, that record waits
 *   network / 5xx / 408 / 429                 → backoff, run stops (server trouble)
 *   401 a refresh can't fix                   → engine pauses, `needsLogin`, entries kept
 *   400/403/404/422/409 ID_CONFLICT/other 4xx → failed (message shown, Retry / Discard)
 */
import adminApi, { getAuthToken } from '../api';
import { identityFromToken, scopeFromIdentity } from './response-cache';
import {
  getEntry,
  listOutbox,
  pruneDone,
  saveConflict,
  saveEntry,
  subscribe as subscribeOutbox,
  entityKey,
  type OutboxEntry,
  type OutboxError,
} from './outbox';
import {
  configureCountScope,
  getSnapshot,
  markOwnMutation,
  refreshCounts,
  setNeedsLogin,
  setSyncing,
  subscribe as subscribeStore,
} from './sync-store';

/** Retry delays after consecutive transient failures (then capped at the last one). */
export const SYNC_BACKOFF_MS = [5_000, 15_000, 60_000, 5 * 60_000];
const SYNC_INTERVAL_MS = 60_000;
const LOCK_NAME = 'naro-admin-sync';

export interface SyncRunSummary {
  /** Why nothing (more) ran, if anything stopped the run. */
  skipped?: 'no-session' | 'needs-login' | 'offline' | 'locked' | 'empty';
  synced: number;
  failed: number;
  conflicts: number;
  /** Entries still waiting (incl. blocked / backing off) when the run ended. */
  remaining: number;
}

let started = false;
let paused = false; // needsLogin
let lastScope: string | null = null;
let running: Promise<SyncRunSummary> | null = null;
let rerunRequested = false;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let wakeAt = 0;

/** Outbox partition of the signed-in user (tenant|platform : userId), or null. */
export function currentSyncScope(): string | null {
  return scopeFromIdentity(identityFromToken(getAuthToken()));
}

function isVisible(): boolean {
  try {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  } catch {
    return true;
  }
}

/** Idempotent; call once from a client effect (SyncProvider). */
export function startSyncEngine() {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Count only the signed-in user's entries; keep showing the paused user's
  // count while "Sign in again" is pending (their token may be gone).
  configureCountScope(() => currentSyncScope() ?? (paused ? lastScope : null));
  void refreshCounts();

  let wasOnline = getSnapshot().online;
  subscribeStore(() => {
    const online = getSnapshot().online;
    if (online && !wasOnline) void syncNow();
    wasOnline = online;
  });

  subscribeOutbox((e) => {
    if (e.type === 'enqueued' || e.type === 'requeued') void syncNow();
  });

  intervalTimer = setInterval(() => {
    if (getSnapshot().online && isVisible()) void syncNow();
  }, SYNC_INTERVAL_MS);

  void syncNow();
}

/** A user signed in (or the same user's session was restored): clear needsLogin and sync. */
export function resumeSync() {
  if (paused) {
    paused = false;
    setNeedsLogin(false);
  }
  void refreshCounts();
  void syncNow();
}

/** Explicit logout: forget the paused user; their entries stay in IndexedDB for next time. */
export function resetSyncEngineForLogout() {
  paused = false;
  lastScope = null;
  setNeedsLogin(false);
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  wakeAt = 0;
}

function scheduleWake(at: number) {
  if (wakeTimer && wakeAt && wakeAt <= at) return;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeAt = at;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    wakeAt = 0;
    if (getSnapshot().browserOnline) void syncNow();
  }, Math.max(250, at - Date.now()));
}

/** Drain the outbox now. Concurrent calls share the run (and trigger one follow-up run). */
export function syncNow(): Promise<SyncRunSummary> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  const p = withLock(runOnce).finally(() => {
    running = null;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow();
    }
  });
  running = p;
  return p;
}

type LockManagerLike = {
  request: (
    name: string,
    opts: { ifAvailable: boolean },
    cb: (lock: unknown) => Promise<SyncRunSummary>,
  ) => Promise<SyncRunSummary>;
};

async function withLock(fn: () => Promise<SyncRunSummary>): Promise<SyncRunSummary> {
  // The run itself never throws, so a catch below can only be a Locks API failure.
  const safe = () =>
    fn().catch((): SyncRunSummary => ({ synced: 0, failed: 0, conflicts: 0, remaining: 0 }));
  const locks =
    typeof navigator !== 'undefined' ? ((navigator as unknown as { locks?: LockManagerLike }).locks ?? null) : null;
  if (!locks || typeof locks.request !== 'function') return safe();
  let ran = false;
  try {
    return await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return { skipped: 'locked', synced: 0, failed: 0, conflicts: 0, remaining: 0 };
      ran = true;
      return safe();
    });
  } catch {
    return ran ? { synced: 0, failed: 0, conflicts: 0, remaining: 0 } : safe();
  }
}

function backoffDelay(attempts: number): number {
  return SYNC_BACKOFF_MS[Math.min(Math.max(attempts, 1), SYNC_BACKOFF_MS.length) - 1];
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const m = (data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m) return m;
    const nested = (data as { error?: { message?: unknown } }).error?.message;
    if (typeof nested === 'string' && nested) return nested;
  }
  return fallback;
}

function errorCode(data: unknown): string | undefined {
  const c = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
  return typeof c === 'string' ? c : undefined;
}

type EntryOutcome = 'ok' | 'blocked' | 'abort';

async function runOnce(): Promise<SyncRunSummary> {
  const summary: SyncRunSummary = { synced: 0, failed: 0, conflicts: 0, remaining: 0 };
  const scope = currentSyncScope();
  if (!scope) return { ...summary, skipped: paused ? 'needs-login' : 'no-session' };
  if (paused) return { ...summary, skipped: 'needs-login' };
  lastScope = scope;
  if (!getSnapshot().browserOnline) return { ...summary, skipped: 'offline' };

  const entries = (await listOutbox(scope)).filter((e) => e.status !== 'done');
  if (entries.length === 0) {
    await refreshCounts();
    return { ...summary, skipped: 'empty' };
  }

  setSyncing(true);
  try {
    const held = new Set<string>();
    for (const listed of entries) {
      const key = entityKey(listed);
      if (listed.status === 'failed' || listed.status === 'conflict') {
        held.add(key);
        continue;
      }
      if (held.has(key)) continue;
      // Re-read: another tab / the panel may have discarded or changed it.
      const e = await getEntry(listed.id);
      if (!e || e.scope !== scope) continue;
      if (e.status === 'failed' || e.status === 'conflict') {
        held.add(key);
        continue;
      }
      if (e.status === 'done') continue;
      if (e.nextAttemptAt && e.nextAttemptAt > Date.now()) {
        held.add(key);
        scheduleWake(e.nextAttemptAt);
        continue;
      }
      // Session changed mid-run (logout / other user) — stop.
      if (currentSyncScope() !== scope) break;

      const outcome = await sendEntry(e, summary);
      if (outcome === 'abort') break;
      if (outcome === 'blocked') held.add(key);
    }
  } finally {
    await pruneDone(scope);
    const left = (await listOutbox(scope)).filter((x) => x.status === 'pending' || x.status === 'syncing');
    summary.remaining = left.length;
    setSyncing(false);
    await refreshCounts();
  }
  return summary;
}

async function markBackoff(e: OutboxEntry, err: OutboxError): Promise<void> {
  const attempts = e.attempts + 1;
  const next: OutboxEntry = {
    ...e,
    status: 'pending',
    attempts,
    nextAttemptAt: Date.now() + backoffDelay(attempts),
    lastError: err,
  };
  await saveEntry(next);
  scheduleWake(next.nextAttemptAt);
}

async function sendEntry(e: OutboxEntry, summary: SyncRunSummary): Promise<EntryOutcome> {
  await saveEntry({ ...e, status: 'syncing' }, true);

  let res;
  try {
    res = await adminApi.sendQueued(e.method, e.path, e.body, e.idempotencyKey);
  } catch (err) {
    await markBackoff(e, { status: 0, message: err instanceof Error ? err.message : 'Sync failed' });
    return 'abort';
  }

  if (res.kind === 'network') {
    await markBackoff(e, { status: 0, message: 'No connection to the server.' });
    return 'abort';
  }
  if (res.kind === 'transient') {
    await markBackoff(e, { status: res.status, message: res.message });
    return 'abort';
  }

  const { status, data } = res;
  const code = errorCode(data);

  if (status >= 200 && status < 300) {
    let warning: string | undefined;
    if (e.kind === 'pos.sale' && data && typeof data === 'object' && (data as { oversold?: unknown }).oversold === true) {
      warning = 'Oversold — stock was short when this sale synced. Review the stock for these items.';
    }
    await saveEntry({
      ...e,
      status: 'done',
      result: data,
      doneAt: Date.now(),
      replayed: res.replayed,
      lastError: undefined,
      nextAttemptAt: 0,
      ...(warning ? { warning } : {}),
    });
    markOwnMutation();
    summary.synced += 1;
    return 'ok';
  }

  if (status === 401) {
    // authorizedFetch already tried a refresh; it was definitively refused.
    paused = true;
    lastScope = e.scope;
    setNeedsLogin(true);
    await saveEntry({ ...e, status: 'pending', lastError: { status, code, message: 'Sign in again to sync.' } });
    return 'abort';
  }

  if (status === 409 && code === 'CONFLICT') {
    const now = Date.now();
    const current = data && typeof data === 'object' ? ((data as { current?: unknown }).current ?? null) : null;
    await saveConflict({
      id: e.id,
      outboxId: e.id,
      scope: e.scope,
      kind: e.kind,
      entityType: e.entityType,
      entityId: e.entityId,
      label: e.label,
      current,
      mine: e.body,
      createdAt: now,
    });
    await saveEntry({
      ...e,
      status: 'conflict',
      lastError: { status, code, message: errorMessage(data, 'Changed online since you edited it.') },
    });
    summary.conflicts += 1;
    return 'blocked';
  }

  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') {
    await markBackoff(e, { status, code, message: 'Still being processed by the server — will check again.' });
    return 'blocked';
  }

  if (status === 408 || status === 429 || status >= 500) {
    await markBackoff(e, { status, code, message: errorMessage(data, `Server error (${status}).`) });
    return 'abort';
  }

  // A POS sale queued with an online-shaped body (request failed mid-flight)
  // that the server now refuses (e.g. shift closed / stock moved): the cash was
  // already taken, so resend it as an offline sale. The refused attempt
  // released the idempotency key, so the same key is reused.
  if (status === 400 && e.kind === 'pos.sale' && e.retryAsOffline && e.body.offline !== true) {
    const upgraded: OutboxEntry = {
      ...e,
      retryAsOffline: false,
      body: {
        ...e.body,
        offline: true,
        clientCreatedAt:
          typeof e.body.clientCreatedAt === 'string' ? e.body.clientCreatedAt : new Date(e.createdAt).toISOString(),
      },
    };
    await saveEntry(upgraded, true);
    return sendEntry(upgraded, summary);
  }

  await saveEntry({
    ...e,
    status: 'failed',
    lastError: { status, code, message: errorMessage(data, `Request failed (${status}).`) },
  });
  summary.failed += 1;
  return 'blocked';
}

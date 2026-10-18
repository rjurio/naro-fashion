/**
 * Connectivity + sync status store (framework-agnostic).
 *
 * Consumed through React's useSyncExternalStore (see contexts/SyncContext.tsx)
 * and fed by:
 *   - browser `online`/`offline` events and navigator.onLine
 *   - a reachability probe: GET `${API}/health` every 30s while the tab is visible
 *   - AdminApiClient.request(): real requests report network failure/success,
 *     cache hits, and successful own mutations
 *   - a remote-change poll: GET /sync/changes?since=… every 60s (tenant admins)
 *
 * Phase 3 hooks: `setSyncing()`, `refreshCounts()`, `setNeedsLogin()` and
 * `configureCountScope()` — the outbox (lib/offline/outbox.ts) and the sync
 * engine (lib/offline/sync-engine.ts) drive these.
 *
 * SSR-safe: nothing touches window/navigator/indexedDB until start() runs in
 * the browser; getServerSnapshot() returns a static "online" snapshot.
 */
import { idbGetAll, metaGet, metaSet } from './db';
import { trimResponseCache } from './response-cache';

export interface RemoteChanges {
  products: number;
  categories: number;
  orders: number;
  rentals: number;
  expenses: number;
  total: number;
  /** Epoch ms of the check that produced these numbers. */
  checkedAt: number;
}

export interface SyncSnapshot {
  /** navigator.onLine (true during SSR). */
  browserOnline: boolean;
  /** Last reachability verdict for the API (probe or real request). */
  serverReachable: boolean;
  /** browserOnline && serverReachable */
  online: boolean;
  /** Oldest `savedAt` (epoch ms) of data served from the device cache on the current page, or null. */
  showingCachedSince: number | null;
  /** Last time a GET succeeded from the network (epoch ms), persisted. */
  lastSyncAt: number | null;
  /** Queued offline writes for the signed-in user (outbox status pending/syncing). */
  pendingCount: number;
  /** Writes the server refused with a conflict (outbox status 'conflict'). */
  conflictCount: number;
  /** Writes that failed validation and need a fix/discard (outbox status 'failed'). */
  failedCount: number;
  /** Outbox drain in progress. */
  syncing: boolean;
  /** The session expired and couldn't be renewed — queued changes wait for a new sign-in. */
  needsLogin: boolean;
  /** Newer records on the server since this page's data was loaded. */
  remoteChanges: RemoteChanges | null;
  /** A manual "Check now" is running. */
  checking: boolean;
}

export interface SyncChangesResponse {
  serverTime?: string;
  since?: string;
  changes?: Partial<Record<'products' | 'categories' | 'orders' | 'rentals' | 'expenses', number>>;
  total?: number;
}

/** Injected by SyncProvider so this module does not import the API client (no import cycle). */
export type FetchChanges = (sinceIso: string) => Promise<SyncChangesResponse>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const CHANGES_INTERVAL_MS = 60_000;
const LAST_SYNC_META_KEY = 'lastSyncAt';

const SERVER_SNAPSHOT: SyncSnapshot = Object.freeze({
  browserOnline: true,
  serverReachable: true,
  online: true,
  showingCachedSince: null,
  lastSyncAt: null,
  pendingCount: 0,
  conflictCount: 0,
  failedCount: 0,
  syncing: false,
  needsLogin: false,
  remoteChanges: null,
  checking: false,
}) as SyncSnapshot;

let snapshot: SyncSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

let started = false;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let changesTimer: ReturnType<typeof setInterval> | null = null;
let fetchChanges: FetchChanges | null = null;
let remotePollingWanted = false;
let remotePollingDisabled = false; // endpoint 404 → server not deployed yet
let lastPullAt = 0; // epoch ms (client clock)
let clockOffsetMs = 0; // serverTime - clientNow, from the last /sync/changes answer
let lastSyncPersistedAt = 0;
let probeInFlight: Promise<void> | null = null;

function setState(patch: Partial<SyncSnapshot>) {
  const next = { ...snapshot, ...patch };
  next.online = next.browserOnline && next.serverReachable;
  const changed = (Object.keys(next) as (keyof SyncSnapshot)[]).some((k) => next[k] !== snapshot[k]);
  if (!changed) return;
  snapshot = next;
  listeners.forEach((l) => {
    try { l(); } catch { /* listener errors must not break the store */ }
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): SyncSnapshot {
  return snapshot;
}

export function getServerSnapshot(): SyncSnapshot {
  return SERVER_SNAPSHOT;
}

function browserIsOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

/** True when the browser itself reports no connection (fast path: skip the network). */
export function isBrowserOffline(): boolean {
  return !browserIsOnline();
}

function isVisible(): boolean {
  try {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Reports from the API client
// ---------------------------------------------------------------------------

/** A real request failed at the network level (server unreachable). */
export function reportNetworkFailure() {
  setState({ serverReachable: false, browserOnline: browserIsOnline() });
}

/** A real request got any HTTP answer from the server. */
export function reportServerReachable() {
  const wasOffline = !snapshot.online;
  setState({ serverReachable: true, browserOnline: true });
  if (wasOffline && snapshot.online) void pollRemoteChanges();
}

/** A GET was answered from the network — the device now holds fresh data. */
export function markNetworkSuccess() {
  const now = Date.now();
  setState({ lastSyncAt: now });
  if (now - lastSyncPersistedAt > 10_000) {
    lastSyncPersistedAt = now;
    void metaSet(LAST_SYNC_META_KEY, now);
  }
}

/** Data from the device cache (saved at `savedAt`) is being shown on this page. */
export function noteCachedServed(savedAt: number) {
  const current = snapshot.showingCachedSince;
  setState({ showingCachedSince: current === null ? savedAt : Math.min(current, savedAt) });
  // The screen now reflects the server as of savedAt — anything newer counts as "newer data online".
  if (!lastPullAt || savedAt < lastPullAt) lastPullAt = savedAt;
}

/** The user's own save succeeded — don't report it back as "newer data online". */
export function markOwnMutation() {
  lastPullAt = Date.now();
  if (snapshot.remoteChanges) setState({ remoteChanges: null });
}

/** Route change / full page load: the page is about to (re)load its data. */
export function markPageLoad() {
  lastPullAt = Date.now();
  setState({ showingCachedSince: null, remoteChanges: null });
}

/** The sync engine toggles this while draining the outbox. */
export function setSyncing(syncing: boolean) {
  setState({ syncing });
}

/** The sync engine sets this when a 401 can't be fixed by a token refresh. */
export function setNeedsLogin(needsLogin: boolean) {
  setState({ needsLogin });
}

/**
 * Outbox entries belong to one signed-in user (`tenant|platform:userId`).
 * Counts only include the current user's entries; with no getter configured
 * (or no signed-in user) nothing is counted.
 */
let countScopeGetter: (() => string | null) | null = null;
export function configureCountScope(getter: (() => string | null) | null) {
  countScopeGetter = getter;
}

/** Re-read pending/conflict/failed counts from IndexedDB (call after any outbox change). */
export async function refreshCounts(): Promise<void> {
  const scope = countScopeGetter ? countScopeGetter() : null;
  const outbox = scope ? await idbGetAll<{ status?: string; scope?: string }>('outbox') : [];
  let pending = 0;
  let failed = 0;
  let conflicts = 0;
  for (const item of outbox) {
    if (!item || item.scope !== scope) continue;
    if (item.status === 'failed') failed += 1;
    else if (item.status === 'conflict') conflicts += 1;
    else if (item.status === 'pending' || item.status === 'syncing') pending += 1;
  }
  setState({ pendingCount: pending, failedCount: failed, conflictCount: conflicts });
}

/** Logout: forget everything user-specific held in memory. */
export function resetForLogout() {
  lastPullAt = 0;
  lastSyncPersistedAt = 0;
  setState({
    showingCachedSince: null,
    lastSyncAt: null,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    remoteChanges: null,
    syncing: false,
    needsLogin: false,
  });
}

// ---------------------------------------------------------------------------
// Reachability probe
// ---------------------------------------------------------------------------

export function probe(): Promise<void> {
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    if (!browserIsOnline()) {
      setState({ browserOnline: false });
      return;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller?.signal,
      });
      // 502/503/504 = proxy up, API (or its DB) down → treat as unreachable.
      const reachable = !(res.status >= 502 && res.status <= 504);
      const wasOffline = !snapshot.online;
      setState({ browserOnline: true, serverReachable: reachable });
      if (wasOffline && snapshot.online) void pollRemoteChanges();
    } catch {
      setState({ browserOnline: browserIsOnline(), serverReachable: false });
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    probeInFlight = null;
  });
  return probeInFlight;
}

function startProbeTimer() {
  if (probeTimer) return;
  probeTimer = setInterval(() => {
    if (isVisible()) void probe();
  }, PROBE_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Remote change poll (/sync/changes)
// ---------------------------------------------------------------------------

export function configureRemoteChanges(fetcher: FetchChanges | null, enabled: boolean) {
  fetchChanges = fetcher;
  remotePollingWanted = enabled && !!fetcher;
  if (!remotePollingWanted) {
    if (changesTimer) clearInterval(changesTimer);
    changesTimer = null;
    if (snapshot.remoteChanges) setState({ remoteChanges: null });
    return;
  }
  if (!changesTimer && started) {
    changesTimer = setInterval(() => {
      if (isVisible()) void pollRemoteChanges();
    }, CHANGES_INTERVAL_MS);
  }
}

function errorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    return (err as { status: number }).status;
  }
  return null;
}

export async function pollRemoteChanges(): Promise<void> {
  if (!remotePollingWanted || remotePollingDisabled || !fetchChanges) return;
  if (!snapshot.online || !lastPullAt) return;
  const requestedAt = Date.now();
  const sinceIso = new Date(lastPullAt + clockOffsetMs).toISOString();
  const pullAtWhenAsked = lastPullAt;
  try {
    const res = await fetchChanges(sinceIso);
    if (res?.serverTime) {
      const serverMs = Date.parse(res.serverTime);
      if (!Number.isNaN(serverMs)) clockOffsetMs = serverMs - Math.round((requestedAt + Date.now()) / 2);
    }
    // A route change / own save happened while we were asking — answer is stale.
    if (lastPullAt !== pullAtWhenAsked) return;
    const c = res?.changes ?? {};
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    const products = n(c.products);
    const categories = n(c.categories);
    const orders = n(c.orders);
    const rentals = n(c.rentals);
    const expenses = n(c.expenses);
    const total = n(res?.total) || products + categories + orders + rentals + expenses;
    setState({
      remoteChanges: total > 0 ? { products, categories, orders, rentals, expenses, total, checkedAt: Date.now() } : null,
    });
  } catch (err) {
    const status = errorStatus(err);
    if (status === 404 || status === 405) {
      // Server doesn't have /sync/changes yet — stop polling silently.
      remotePollingDisabled = true;
      if (changesTimer) clearInterval(changesTimer);
      changesTimer = null;
    }
    // Anything else (offline, 401, 5xx): try again next tick.
  }
}

// ---------------------------------------------------------------------------
// Lifecycle + actions
// ---------------------------------------------------------------------------

function onOnline() {
  setState({ browserOnline: true });
  void probe();
}

function onOffline() {
  setState({ browserOnline: false });
}

function onVisibility() {
  if (isVisible()) {
    void probe();
    void pollRemoteChanges();
  }
}

/** Idempotent; call from a client effect. */
export function startSyncStore() {
  if (started || typeof window === 'undefined') return;
  started = true;
  lastPullAt = Date.now();
  setState({ browserOnline: browserIsOnline() });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibility);
  startProbeTimer();
  void probe();
  void metaGet<number>(LAST_SYNC_META_KEY).then((v) => {
    if (typeof v === 'number' && (!snapshot.lastSyncAt || v > snapshot.lastSyncAt)) setState({ lastSyncAt: v });
  });
  void refreshCounts();
  trimResponseCache();
  if (remotePollingWanted) configureRemoteChanges(fetchChanges, true);
}

/** Manual "Check now": probe the server, then look for newer data. */
export async function checkNow(): Promise<void> {
  setState({ checking: true });
  try {
    await probe();
    await Promise.all([pollRemoteChanges(), refreshCounts()]);
  } finally {
    setState({ checking: false });
  }
}

/** Reload the current page's data (a full reload is the simplest correct option). */
export function refresh() {
  if (typeof window !== 'undefined') window.location.reload();
}

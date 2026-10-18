/**
 * Offline outbox (admin offline mode, Phase 3).
 *
 * Writes on the offline allow-list are stored in the IndexedDB `outbox` store
 * when the API can't be reached, and replayed later by the sync engine
 * (lib/offline/sync-engine.ts) with the SAME `Idempotency-Key`, so a write
 * that actually reached the server before the connection dropped is never
 * applied twice (server contract: CLAUDE.md → "Admin Offline Mode + Sync").
 *
 * - `prepareOfflineMutation()` is called by AdminApiClient.request() for every
 *   non-GET: allow-listed writes ALWAYS get an Idempotency-Key (online too),
 *   and creates get a client-generated id when the body has none.
 * - `enqueue()` stores the entry; `optimisticResult()` is what request()
 *   returns instead of throwing (`isQueuedResult(r)` lets pages tell).
 * - Entries are partitioned per signed-in user (`scope` = tenant|platform:userId)
 *   and survive logout; only the owner's session ever replays them.
 *
 * This module must not import the API client (api.ts imports it).
 */
import { idbDelete, idbGet, idbGetAll, idbPut } from './db';
import { findBlobRefs, releaseBlobs } from './blobs';
import { refreshCounts } from './sync-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutboxKind =
  | 'pos.sale'
  | 'product.create'
  | 'product.update'
  | 'category.create'
  | 'category.update'
  | 'expense.create'
  | 'expense.update'
  | 'order.status'
  | 'rental.status';

export type OutboxEntityType = 'posSale' | 'product' | 'category' | 'expense' | 'order' | 'rental';

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'conflict' | 'done';

export interface OutboxError {
  /** HTTP status (0 = network). */
  status: number;
  code?: string;
  message: string;
}

export interface OutboxEntry {
  id: string;
  idempotencyKey: string;
  /** `${tenantId|platform}:${userId}` of the operator who made the change. */
  scope: string;
  kind: OutboxKind;
  method: 'POST' | 'PATCH';
  /** API path without base URL or query, e.g. `/products/abc`. */
  path: string;
  body: Record<string, unknown>;
  entityType: OutboxEntityType;
  /** Target record id (client id for creates; own id for POS sales). */
  entityId: string;
  /** Human-readable, e.g. "POS sale · TZS 45,000 · 3 items". */
  label: string;
  /** Epoch ms. */
  createdAt: number;
  attempts: number;
  /** Epoch ms; 0 = as soon as possible. */
  nextAttemptAt: number;
  status: OutboxStatus;
  lastError?: OutboxError;
  /** Server response body once synced. */
  result?: unknown;
  /** Epoch ms when it synced. */
  doneAt?: number;
  /** The server answered with a stored response (Idempotency-Replayed). */
  replayed?: boolean;
  /** Something about the synced result needs a look (e.g. oversold POS sale). */
  warning?: string;
  /**
   * POS sale queued from an ONLINE-shaped body (the request failed mid-flight):
   * if the replay is refused with a 400, resend it as an offline sale.
   */
  retryAsOffline?: boolean;
  /**
   * Offline photos (`offline-blob://<id>`) this entry referenced before the
   * sync engine replaced them with uploaded URLs — released once it is done.
   */
  blobIds?: string[];
}

export interface ConflictRecord {
  /** Same as the outbox entry id. */
  id: string;
  outboxId: string;
  scope: string;
  kind: OutboxKind;
  entityType: OutboxEntityType;
  entityId: string;
  label: string;
  /** The server's current version of the record (409 `current`). */
  current: unknown;
  /** The queued change (request body). */
  mine: Record<string, unknown>;
  createdAt: number;
}

/** What request() returns for a queued write. */
export type QueuedResult<T = Record<string, unknown>> = T & {
  id: string;
  __offline: true;
  __outboxId: string;
};

// ---------------------------------------------------------------------------
// Allow-list (must match the paths AdminApiClient uses — see lib/api.ts)
// ---------------------------------------------------------------------------

interface OfflineRoute {
  method: 'POST' | 'PATCH';
  pattern: RegExp;
  kind: OutboxKind;
  entityType: OutboxEntityType;
  /** POST create that accepts a client-generated `id`. */
  clientId?: boolean;
}

const OFFLINE_ROUTES: OfflineRoute[] = [
  { method: 'POST', pattern: /^\/pos\/sales$/, kind: 'pos.sale', entityType: 'posSale' },
  { method: 'POST', pattern: /^\/products$/, kind: 'product.create', entityType: 'product', clientId: true },
  { method: 'PATCH', pattern: /^\/products\/([^/]+)$/, kind: 'product.update', entityType: 'product' },
  { method: 'POST', pattern: /^\/categories$/, kind: 'category.create', entityType: 'category', clientId: true },
  { method: 'PATCH', pattern: /^\/categories\/([^/]+)$/, kind: 'category.update', entityType: 'category' },
  { method: 'POST', pattern: /^\/expenses$/, kind: 'expense.create', entityType: 'expense', clientId: true },
  { method: 'PATCH', pattern: /^\/expenses\/([^/]+)$/, kind: 'expense.update', entityType: 'expense' },
  { method: 'PATCH', pattern: /^\/orders\/([^/]+)\/status$/, kind: 'order.status', entityType: 'order' },
  { method: 'PATCH', pattern: /^\/rentals\/([^/]+)\/status$/, kind: 'rental.status', entityType: 'rental' },
];

/** Same rule the API enforces for client ids. */
export const CLIENT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{19,40}$/;

export interface OfflineRouteMatch {
  route: OfflineRoute;
  path: string;
  /** Id captured from the path (updates / status changes). */
  pathId: string | null;
}

export function matchOfflineRoute(method: string, endpoint: string): OfflineRouteMatch | null {
  const m = method.toUpperCase();
  const path = endpoint.split('?')[0];
  for (const route of OFFLINE_ROUTES) {
    if (route.method !== m) continue;
    const hit = route.pattern.exec(path);
    if (hit) return { route, path, pathId: hit[1] ? decodeURIComponent(hit[1]) : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ids / keys
// ---------------------------------------------------------------------------

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  try {
    crypto.getRandomValues(out);
  } catch {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** 25-char lower-case id: `c` + 24 base36 chars (matches CLIENT_ID_REGEX). */
export function generateClientId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  // Rejection sampling keeps the distribution uniform (252 = 7 × 36).
  while (s.length < 25) {
    for (const b of randomBytes(32)) {
      if (b < 252 && s.length < 25) s += alphabet[b % 36];
    }
  }
  return s;
}

export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Prepare (called for every non-GET in request())
// ---------------------------------------------------------------------------

export interface PreparedMutation {
  /** Outbox entry id reserved up front so a mid-flight failure keeps the same identity. */
  localId: string;
  kind: OutboxKind;
  method: 'POST' | 'PATCH';
  path: string;
  entityType: OutboxEntityType;
  entityId: string;
  /** Body to send (client id injected for creates). */
  body: Record<string, unknown>;
  idempotencyKey: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Returns null for writes that aren't offline-capable (they keep today's behaviour). */
export function prepareOfflineMutation(method: string, endpoint: string, data: unknown): PreparedMutation | null {
  const match = matchOfflineRoute(method, endpoint);
  if (!match) return null;
  const body: Record<string, unknown> = isPlainObject(data) ? { ...data } : {};
  const localId = generateClientId();
  let entityId = match.pathId ?? localId;
  if (match.route.clientId) {
    if (body.id === undefined || body.id === null || body.id === '') body.id = generateClientId();
    entityId = String(body.id);
  }
  return {
    localId,
    kind: match.route.kind,
    method: match.route.method,
    path: match.path,
    entityType: match.route.entityType,
    entityId,
    body,
    idempotencyKey: newIdempotencyKey(),
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function formatTzs(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return `TZS ${v.toLocaleString('en-US')}`;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Net total of a POS sale body (mirrors the server's computeSaleTotals). */
export function posSaleTotals(body: Record<string, unknown>): { total: number; itemCount: number } {
  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  let subtotal = 0;
  let itemCount = 0;
  for (const it of items) {
    const q = num(it.quantity);
    itemCount += q;
    subtotal += num(it.unitPrice) * q - num(it.itemDiscount);
  }
  const d = num(body.discount);
  const discountAmount = body.discountType === 'PERCENTAGE' ? subtotal * (d / 100) : d;
  return { total: Math.max(0, subtotal - discountAmount), itemCount };
}

const quote = (s: string) => `“${s}”`;
const shortId = (id: string) => (id.length > 8 ? `#${id.slice(-6)}` : `#${id}`);
const humanStatus = (s: unknown) =>
  typeof s === 'string' && s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '?';

export function defaultLabel(kind: OutboxKind, body: Record<string, unknown>, entityId: string): string {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  switch (kind) {
    case 'pos.sale': {
      const { total, itemCount } = posSaleTotals(body);
      return `POS sale · ${formatTzs(total)} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    }
    case 'product.create':
      return `New product ${name ? quote(name) : shortId(entityId)}`;
    case 'product.update':
      return `Update product ${name ? quote(name) : shortId(entityId)}`;
    case 'category.create':
      return `New category ${name ? quote(name) : shortId(entityId)}`;
    case 'category.update':
      return `Update category ${name ? quote(name) : shortId(entityId)}`;
    case 'expense.create':
    case 'expense.update': {
      const verb = kind === 'expense.create' ? 'New expense' : 'Update expense';
      const desc = typeof body.description === 'string' && body.description.trim() ? ` · ${body.description.trim()}` : '';
      const amt = body.amount !== undefined ? ` · ${formatTzs(num(body.amount))}` : '';
      return amt || desc ? `${verb}${amt}${desc}` : `${verb} ${shortId(entityId)}`;
    }
    case 'order.status':
      return `Order ${shortId(entityId)} → ${humanStatus(body.status)}`;
    case 'rental.status':
      return `Rental ${shortId(entityId)} → ${humanStatus(body.status)}`;
    default:
      return 'Offline change';
  }
}

// ---------------------------------------------------------------------------
// Change notifications (this tab + other tabs)
// ---------------------------------------------------------------------------

export type OutboxEventType = 'enqueued' | 'requeued' | 'changed';
export interface OutboxEvent {
  type: OutboxEventType;
  /** True when the event came from another tab. */
  remote?: boolean;
}

const listeners = new Set<(e: OutboxEvent) => void>();
let channel: BroadcastChannel | null = null;
let channelInit = false;

function getChannel(): BroadcastChannel | null {
  if (channelInit) return channel;
  channelInit = true;
  try {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('naro-admin-outbox');
      channel.onmessage = (msg) => {
        const type = (msg?.data?.type as OutboxEventType) || 'changed';
        emitLocal({ type, remote: true });
      };
    }
  } catch {
    channel = null;
  }
  return channel;
}

function emitLocal(e: OutboxEvent) {
  listeners.forEach((l) => {
    try {
      l(e);
    } catch {
      /* listener errors must not break the outbox */
    }
  });
}

function notify(type: OutboxEventType) {
  void refreshCounts();
  emitLocal({ type });
  try {
    getChannel()?.postMessage({ type });
  } catch {
    /* ignore */
  }
}

/** Listen for outbox changes (also fired for changes made in other tabs). */
export function subscribe(listener: (e: OutboxEvent) => void): () => void {
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  scope: string;
  label?: string;
}

/** Store a prepared write. Returns null if IndexedDB is unavailable (caller falls back to throwing OFFLINE). */
export async function enqueue(prepared: PreparedMutation, opts: EnqueueOptions): Promise<OutboxEntry | null> {
  if (!opts.scope) return null;
  const entry: OutboxEntry = {
    id: prepared.localId,
    idempotencyKey: prepared.idempotencyKey,
    scope: opts.scope,
    kind: prepared.kind,
    method: prepared.method,
    path: prepared.path,
    body: prepared.body,
    entityType: prepared.entityType,
    entityId: prepared.entityId,
    label: opts.label?.trim() || defaultLabel(prepared.kind, prepared.body, prepared.entityId),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    status: 'pending',
    ...(prepared.kind === 'pos.sale' && prepared.body.offline !== true ? { retryAsOffline: true } : {}),
  };
  const ok = await idbPut('outbox', entry);
  if (!ok) return null;
  notify('enqueued');
  return entry;
}

export function optimisticResult(entry: OutboxEntry): QueuedResult {
  return { ...entry.body, id: entry.entityId, __offline: true, __outboxId: entry.id };
}

export function isQueuedResult(r: unknown): r is QueuedResult {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as { __offline?: unknown }).__offline === true &&
    typeof (r as { __outboxId?: unknown }).__outboxId === 'string'
  );
}

function byCreatedAt(a: OutboxEntry, b: OutboxEntry) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Entries (oldest first). Pass a scope to get one user's entries only. */
export async function listOutbox(scope?: string | null): Promise<OutboxEntry[]> {
  const all = await idbGetAll<OutboxEntry>('outbox');
  return all
    .filter((e) => e && typeof e.id === 'string' && (scope === undefined || e.scope === scope))
    .sort(byCreatedAt);
}

export function getEntry(id: string): Promise<OutboxEntry | null> {
  return idbGet<OutboxEntry>('outbox', id);
}

export function getConflict(id: string): Promise<ConflictRecord | null> {
  return idbGet<ConflictRecord>('conflicts', id);
}

/** Engine-side write. `silent` skips the change notification (used for transient 'syncing' marks). */
export async function saveEntry(entry: OutboxEntry, silent = false): Promise<boolean> {
  const ok = await idbPut('outbox', entry);
  if (ok && !silent) notify('changed');
  return ok;
}

export async function saveConflict(record: ConflictRecord): Promise<boolean> {
  return idbPut('conflicts', record);
}

/** Unsynced entries (anything not done) for a scope. */
export async function countUnsynced(scope: string | null): Promise<number> {
  if (!scope) return 0;
  return (await listOutbox(scope)).filter((e) => e.status !== 'done').length;
}

/** Retry a failed entry: back to pending, attempts reset. */
export async function retry(id: string): Promise<boolean> {
  const e = await getEntry(id);
  if (!e || e.status === 'done') return false;
  const next: OutboxEntry = {
    ...e,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: undefined,
    // 422 = the key was already used for a different request; anything else
    // keeps the key so a write that did land is never applied twice.
    idempotencyKey: e.lastError?.code === 'IDEMPOTENCY_KEY_REUSED' ? newIdempotencyKey() : e.idempotencyKey,
  };
  await idbDelete('conflicts', id);
  const ok = await idbPut('outbox', next);
  if (ok) notify('requeued');
  return ok;
}

/** Drop an entry (and its conflict record) for good. Offline photos only it used are deleted too. */
export async function discard(id: string): Promise<boolean> {
  const e = await getEntry(id);
  await idbDelete('conflicts', id);
  const ok = await idbDelete('outbox', id);
  if (ok && e) {
    const ids = new Set<string>([...(e.blobIds ?? []), ...findBlobRefs(e.body)]);
    if (ids.size) await releaseBlobs(ids, await listOutbox());
  }
  if (ok) notify('changed');
  return ok;
}

/**
 * Conflict → "Keep mine": re-queue the change on top of the server's current
 * version (`expectedUpdatedAt = current.updatedAt` for record edits,
 * `expectedStatus = current.status` for status changes) with a NEW
 * idempotency key (it is a new request).
 */
export async function keepMine(id: string): Promise<boolean> {
  const [e, c] = await Promise.all([getEntry(id), getConflict(id)]);
  if (!e) return false;
  const current = (c?.current ?? null) as Record<string, unknown> | null;
  const body: Record<string, unknown> = { ...e.body };
  if (e.kind === 'order.status' || e.kind === 'rental.status') {
    if (current && typeof current.status === 'string') body.expectedStatus = current.status;
    else delete body.expectedStatus;
  } else if (current && current.updatedAt !== undefined && current.updatedAt !== null) {
    body.expectedUpdatedAt =
      typeof current.updatedAt === 'string' ? current.updatedAt : new Date(current.updatedAt as string).toISOString();
  } else {
    delete body.expectedUpdatedAt;
  }
  const next: OutboxEntry = {
    ...e,
    body,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: undefined,
    idempotencyKey: newIdempotencyKey(),
  };
  await idbDelete('conflicts', id);
  const ok = await idbPut('outbox', next);
  if (ok) notify('requeued');
  return ok;
}

/** Conflict → "Keep online": the server version wins, the queued change is dropped. */
export function keepOnline(id: string): Promise<boolean> {
  return discard(id);
}

/** Keep only the newest `keep` done entries of a scope ("Recently synced"). */
export async function pruneDone(scope: string, keep = 50): Promise<number> {
  const done = (await listOutbox(scope))
    .filter((e) => e.status === 'done')
    .sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt));
  const old = done.slice(keep);
  for (const e of old) await idbDelete('outbox', e.id);
  if (old.length) notify('changed');
  return old.length;
}

/** `${entityType}:${entityId}` — entries for the same key replay strictly in order. */
export function entityKey(e: Pick<OutboxEntry, 'entityType' | 'entityId'>): string {
  return `${e.entityType}:${e.entityId}`;
}

/**
 * Ids of pending entries held back because an EARLIER entry for the same
 * record failed or conflicted ("blocked by earlier change").
 */
export function computeBlocked(entries: OutboxEntry[]): Set<string> {
  const stuck = new Set<string>();
  const blocked = new Set<string>();
  for (const e of [...entries].sort(byCreatedAt)) {
    const key = entityKey(e);
    if (e.status === 'failed' || e.status === 'conflict') {
      stuck.add(key);
      continue;
    }
    if ((e.status === 'pending' || e.status === 'syncing') && stuck.has(key)) blocked.add(e.id);
  }
  return blocked;
}

/** Short receipt number for a queued POS sale. */
export function offlineReceiptNumber(outboxId: string): string {
  return `OFFLINE-${outboxId.slice(-6).toUpperCase()}`;
}

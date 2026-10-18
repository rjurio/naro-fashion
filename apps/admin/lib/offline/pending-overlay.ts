/**
 * Pending overlay (admin offline mode, Phase 4) — PURE functions, no I/O.
 *
 * Problem: a write queued in the outbox "succeeds" immediately, but the list
 * and detail pages keep showing the server's (or the cached) data until the
 * queue syncs, so the change looks lost.
 *
 * Fix: AdminApiClient.request() runs every GET response for the offline-
 * writable entities (network OR device cache) through applyPendingOverlay()
 * together with the signed-in user's unsynced outbox entries:
 *
 *   - updates (PATCH by id) → the queued body fields are merged onto the
 *     record with that id (lists, category trees, detail responses);
 *   - status changes        → `status` is set;
 *   - creates               → prepended to the FIRST page of the matching list
 *     when no search/filter param could exclude them (category creates are
 *     placed under their parent in the tree);
 *   - every overlaid record gets `__pending: true` and `__syncState`
 *     ('pending' | 'failed' | 'conflict'); records that exist only on this
 *     device (queued creates) also get `__localOnly: true`.
 *
 * Request bodies use form keys that differ from the response shape in a few
 * places (product `price` → `basePrice`, `published` → `isActive`, image URL
 * strings → `{ url }` objects; category `nameEn`/`nameSw` → `name`/
 * `nameSwahili`). FIELD MAPPERS below translate them; add a mapper when a new
 * offline-writable entity is added (checklist: docs/TECHNICAL_GUIDE.md →
 * "Working offline").
 *
 * Inputs are never mutated; the result is a new value (unchanged branches may
 * be shared).
 */

export type OverlayEntity = 'product' | 'category' | 'expense' | 'order' | 'rental';
export type PendingSyncState = 'pending' | 'failed' | 'conflict';

/** The slice of an outbox entry the overlay needs (keeps this module free of IndexedDB types). */
export interface OverlayEntry {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  body: Record<string, unknown>;
  status: string;
  createdAt: number;
}

export interface OverlayTarget {
  entity: OverlayEntity;
  mode: 'list' | 'detail';
  /** Record id for detail targets. */
  id?: string;
  /** Query params of the GET. */
  params: Record<string, string>;
}

export interface PendingMarks {
  __pending?: true;
  __syncState?: PendingSyncState;
  __localOnly?: true;
}

// ---------------------------------------------------------------------------
// Which GETs are overlaid
// ---------------------------------------------------------------------------

const LIST_PATHS: Record<string, OverlayEntity> = {
  '/products/admin': 'product',
  '/categories': 'category',
  '/expenses': 'expense',
  '/orders/admin': 'order',
  '/rentals/admin': 'rental',
};

/** `/<prefix>/<id>` detail routes; reserved words are other GET routes, not ids. */
const DETAIL_ROUTES: { re: RegExp; entity: OverlayEntity; reserved: string[] }[] = [
  { re: /^\/products\/by-id\/([^/]+)$/, entity: 'product', reserved: [] },
  { re: /^\/expenses\/([^/]+)$/, entity: 'expense', reserved: ['summary'] },
  { re: /^\/orders\/([^/]+)$/, entity: 'order', reserved: ['admin', 'stats', 'my-orders', 'track'] },
  { re: /^\/rentals\/([^/]+)$/, entity: 'rental', reserved: ['admin', 'upcoming-pickups', 'overdue', 'pending-returns', 'my-rentals'] },
];

/** `/products/admin?page=1&limit=20` → target, or null when the GET isn't overlaid. */
export function matchOverlayTarget(pathWithQuery: string): OverlayTarget | null {
  const [rawPath, query = ''] = pathWithQuery.split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const params: Record<string, string> = {};
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      try {
        params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
      } catch {
        params[k] = v;
      }
    }
  }
  const listEntity = LIST_PATHS[path];
  if (listEntity) return { entity: listEntity, mode: 'list', params };
  for (const r of DETAIL_ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    let id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep raw */
    }
    if (r.reserved.includes(id)) return null;
    return { entity: r.entity, mode: 'detail', id, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field mapping: queued request body → response-shaped fields
// ---------------------------------------------------------------------------

/** Request-only keys that must never be shown as record fields. */
const CONTROL_KEYS = new Set(['expectedUpdatedAt', 'expectedStatus', 'returnedAt']);

type Fields = Record<string, unknown>;

function stripControl(body: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(body)) if (!CONTROL_KEYS.has(k) && v !== undefined) out[k] = v;
  return out;
}

const FIELD_MAPPERS: Record<OverlayEntity, (body: Fields) => Fields> = {
  product: (body) => {
    const f = stripControl(body);
    if (f.price !== undefined && f.basePrice === undefined) f.basePrice = f.price;
    if (typeof f.published === 'boolean' && f.isActive === undefined) f.isActive = f.published;
    if (Array.isArray(f.images)) {
      f.images = (f.images as unknown[]).map((img, i) =>
        typeof img === 'string' ? { url: img, isPrimary: i === 0, sortOrder: i } : img,
      );
    }
    return f;
  },
  category: (body) => {
    const f = stripControl(body);
    if (f.nameEn !== undefined) {
      if (f.name === undefined) f.name = f.nameEn;
      delete f.nameEn;
    }
    if (f.nameSw !== undefined) {
      if (f.nameSwahili === undefined) f.nameSwahili = f.nameSw;
      delete f.nameSw;
    }
    return f;
  },
  expense: (body) => stripControl(body),
  order: (body) => stripControl(body),
  rental: (body) => stripControl(body),
};

/** Merge mapped fields onto a record; drops a now-stale embedded relation. */
function mergeFields(entity: OverlayEntity, record: Fields, fields: Fields): Fields {
  const next: Fields = { ...record, ...fields };
  // The embedded relation name no longer matches a changed foreign key —
  // drop it so pages fall back to resolving the name from the id.
  if ((entity === 'product' || entity === 'expense') && fields.categoryId !== undefined) {
    const cat = record.category as { id?: unknown } | undefined;
    if (cat && typeof cat === 'object' && cat.id !== fields.categoryId) delete next.category;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Grouping entries per record
// ---------------------------------------------------------------------------

const UNSYNCED = new Set(['pending', 'syncing', 'failed', 'conflict']);
const STATE_RANK: Record<PendingSyncState, number> = { pending: 0, failed: 1, conflict: 2 };

function entryState(status: string): PendingSyncState {
  if (status === 'conflict') return 'conflict';
  if (status === 'failed') return 'failed';
  return 'pending';
}

interface RecordOverlay {
  id: string;
  /** Mapped fields of the queued create, if the record was created on this device. */
  create: Fields | null;
  /** Mapped fields of all queued updates / status changes, in order, merged. */
  patch: Fields;
  state: PendingSyncState;
  /** createdAt of the first entry (creates are listed newest first). */
  firstAt: number;
}

/** Fold the unsynced entries for `entity` into one overlay per record id (oldest → newest). */
export function groupEntries(entity: OverlayEntity, entries: OverlayEntry[]): Map<string, RecordOverlay> {
  const map = new Map<string, RecordOverlay>();
  const mapper = FIELD_MAPPERS[entity];
  const relevant = entries
    .filter((e) => e && e.entityType === entity && UNSYNCED.has(e.status) && typeof e.entityId === 'string')
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  for (const e of relevant) {
    let o = map.get(e.entityId);
    if (!o) {
      o = { id: e.entityId, create: null, patch: {}, state: 'pending', firstAt: e.createdAt };
      map.set(e.entityId, o);
    }
    const st = entryState(e.status);
    if (STATE_RANK[st] > STATE_RANK[o.state]) o.state = st;
    const body = e.body && typeof e.body === 'object' ? e.body : {};
    const fields = mapper(body);
    if (e.kind.endsWith('.create')) {
      o.create = { ...(o.create ?? {}), ...fields, id: e.entityId };
    } else {
      delete fields.id;
      o.patch = { ...o.patch, ...fields };
    }
  }
  return map;
}

function marks(o: RecordOverlay): PendingMarks {
  return o.create
    ? { __pending: true, __syncState: o.state, __localOnly: true }
    : { __pending: true, __syncState: o.state };
}

/** Defaults so a record created on this device renders like a server row. */
function createDefaults(entity: OverlayEntity, now: string): Fields {
  switch (entity) {
    case 'product':
      return { images: [], variants: [], category: null, isActive: true, availabilityMode: 'PURCHASE_ONLY', createdAt: now };
    case 'category':
      return { children: [], _count: { products: 0 }, parentId: null, createdAt: now };
    case 'expense':
      return { category: null, createdAt: now };
    default:
      return { createdAt: now };
  }
}

/** The full record for a queued create (+ later queued updates). */
function createdRecord(entity: OverlayEntity, o: RecordOverlay): Fields {
  const now = new Date(o.firstAt || Date.now()).toISOString();
  return { ...createDefaults(entity, now), ...(o.create ?? {}), ...o.patch, id: o.id, ...marks(o) };
}

function overlayRecord(entity: OverlayEntity, record: Fields, o: RecordOverlay): Fields {
  // A queued create the server already knows about (sync raced the fetch):
  // the server row is the base, local fields on top.
  const base = o.create ? mergeFields(entity, record, o.create) : record;
  return { ...mergeFields(entity, base, o.patch), ...marks(o) };
}

// ---------------------------------------------------------------------------
// List shapes
// ---------------------------------------------------------------------------

const LIST_KEYS = ['data', 'items', 'products', 'orders', 'rentals', 'expenses'];

/** Locate the record array in a list response: bare array or `{ data | items | … : [] }`. */
function findListArray(data: unknown): { arr: Fields[]; key: string | null } | null {
  if (Array.isArray(data)) return { arr: data as Fields[], key: null };
  if (data && typeof data === 'object') {
    for (const k of LIST_KEYS) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return { arr: v as Fields[], key: k };
    }
  }
  return null;
}

function withListArray(data: unknown, key: string | null, arr: Fields[], added: number): unknown {
  if (key === null) return arr;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>), [key]: arr };
  if (added > 0) {
    if (typeof out.total === 'number') out.total = (out.total as number) + added;
    const meta = out.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object' && typeof meta.total === 'number') {
      out.meta = { ...meta, total: (meta.total as number) + added };
    }
  }
  return out;
}

/** Params that never exclude a freshly created record (paging only). */
const PAGING_PARAMS = new Set(['page', 'limit']);

/**
 * May queued creates be shown in this list request? Only on the first page
 * and only when no search/filter param could exclude them — except the
 * expenses `period` filter (YYYY-MM), which is checked per record.
 */
function createFilter(target: OverlayTarget): ((rec: Fields) => boolean) | null {
  if (target.entity === 'order' || target.entity === 'rental') return null; // never created offline
  const page = target.params.page;
  if (page !== undefined && page !== '' && page !== '1') return null;
  let period: string | null = null;
  for (const [k, v] of Object.entries(target.params)) {
    if (PAGING_PARAMS.has(k) || v === '') continue;
    if (target.entity === 'expense' && k === 'period') {
      period = v;
      continue;
    }
    // Harmless "everything" flags.
    if (k === 'includeDeleted' && v === 'false') continue;
    return null;
  }
  if (period) {
    const p = period;
    return (rec) => typeof rec.expenseDate === 'string' && rec.expenseDate.startsWith(p);
  }
  return () => true;
}

/** Overlay a category tree: updates anywhere in the tree, creates under their parent. */
function overlayCategoryTree(nodes: Fields[], groups: Map<string, RecordOverlay>, allowCreates: boolean): Fields[] {
  const seen = new Set<string>();
  const walk = (list: Fields[]): Fields[] =>
    list.map((n) => {
      const id = typeof n.id === 'string' ? n.id : '';
      seen.add(id);
      const o = groups.get(id);
      let next: Fields = o ? overlayRecord('category', n, o) : n;
      if (Array.isArray(n.children)) {
        const kids = walk(n.children as Fields[]);
        if (kids.some((k, i) => k !== (n.children as Fields[])[i])) next = { ...next, children: kids };
      }
      return next;
    });
  let tree = walk(nodes);
  if (!allowCreates) return tree;

  const creates = [...groups.values()].filter((o) => o.create && !seen.has(o.id)).sort((a, b) => a.firstAt - b.firstAt);
  const insert = (list: Fields[], parentId: string, rec: Fields): { list: Fields[]; done: boolean } => {
    let done = false;
    const out = list.map((n) => {
      if (done) return n;
      if (n.id === parentId) {
        done = true;
        return { ...n, children: [rec, ...((n.children as Fields[]) ?? [])] };
      }
      if (Array.isArray(n.children) && n.children.length) {
        const r = insert(n.children as Fields[], parentId, rec);
        if (r.done) {
          done = true;
          return { ...n, children: r.list };
        }
      }
      return n;
    });
    return { list: out, done };
  };
  for (const o of creates) {
    const rec = createdRecord('category', o);
    const parentId = typeof rec.parentId === 'string' && rec.parentId ? rec.parentId : null;
    if (parentId) {
      const r = insert(tree, parentId, rec);
      if (r.done) {
        tree = r.list;
        continue;
      }
    }
    tree = [rec, ...tree];
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge the user's unsynced outbox entries into a GET response.
 * Returns `data` itself when nothing applies.
 */
export function applyPendingOverlay(target: OverlayTarget, data: unknown, entries: OverlayEntry[]): unknown {
  const groups = groupEntries(target.entity, entries);
  if (groups.size === 0) return data;

  if (target.mode === 'detail') {
    const o = target.id ? groups.get(target.id) : undefined;
    if (!o) return data;
    if (data && typeof data === 'object' && !Array.isArray(data) && (data as Fields).id === target.id) {
      return overlayRecord(target.entity, data as Fields, o);
    }
    return data;
  }

  const found = findListArray(data);
  if (!found) return data;

  if (target.entity === 'category') {
    const tree = overlayCategoryTree(found.arr, groups, createFilter(target) !== null);
    return withListArray(data, found.key, tree, 0);
  }

  const seen = new Set<string>();
  let changed = false;
  const arr = found.arr.map((rec) => {
    const id = rec && typeof rec.id === 'string' ? rec.id : '';
    seen.add(id);
    const o = groups.get(id);
    if (!o) return rec;
    changed = true;
    return overlayRecord(target.entity, rec, o);
  });

  const filter = createFilter(target);
  const created: Fields[] = [];
  if (filter) {
    const creates = [...groups.values()].filter((o) => o.create && !seen.has(o.id)).sort((a, b) => b.firstAt - a.firstAt);
    for (const o of creates) {
      const rec = createdRecord(target.entity, o);
      if (filter(rec)) created.push(rec);
    }
  }
  if (!changed && created.length === 0) return data;
  return withListArray(data, found.key, [...created, ...arr], created.length);
}

/**
 * A detail GET for a record that so far exists only on this device (queued
 * create): build it from the queued body so the edit page can open it — used
 * when the device cache has nothing / the server answers 404.
 */
export function synthesizeDetail(target: OverlayTarget, entries: OverlayEntry[]): Fields | null {
  if (target.mode !== 'detail' || !target.id) return null;
  const o = groupEntries(target.entity, entries).get(target.id);
  if (!o || !o.create) return null;
  return createdRecord(target.entity, o);
}

/** `__syncState` of an overlaid record, or null. */
export function pendingStateOf(record: unknown): PendingSyncState | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as PendingMarks;
  if (!r.__pending) return null;
  return r.__syncState ?? 'pending';
}

/** True for a record that exists only on this device (queued create, not synced yet). */
export function isLocalOnly(record: unknown): boolean {
  return !!record && typeof record === 'object' && (record as PendingMarks).__localOnly === true;
}

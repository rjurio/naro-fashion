/**
 * Tiny promise wrapper around IndexedDB for the admin offline layer.
 *
 * Database `naro-admin-offline` (v1) with four object stores, all created now
 * so later phases never need a version bump:
 *   - responses  keyPath `key`  — last good GET response per scope+path (Phase 1)
 *   - outbox     keyPath `id`   — queued offline writes            (Phase 3)
 *   - conflicts  keyPath `id`   — writes the server refused (409)  (Phase 3)
 *   - meta       keyPath `key`  — small key/value pairs (lastSyncAt, profile…)
 *
 * Every function degrades to a no-op (resolves null / 0 / []) when IndexedDB
 * is unavailable — SSR, Firefox private mode, blocked storage, quota errors.
 * The admin must never break because the offline cache can't be used.
 * Nothing here touches `window`/`indexedDB` at module load time.
 */

export const OFFLINE_DB_NAME = 'naro-admin-offline';
const OFFLINE_DB_VERSION = 1;

export type StoreName = 'responses' | 'outbox' | 'conflicts' | 'meta';

/** Cached GET response (Phase 1). */
export interface CachedResponseRecord {
  /** `${tenantId|platform}:${userId}:${pathWithQuery}` */
  key: string;
  /** Raw JSON text exactly as the API returned it. */
  body: string;
  /** Epoch ms when it was fetched from the network. */
  savedAt: number;
  /** Serialized size (chars) — used for size caps. */
  size: number;
}

export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function idbAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined' && window.indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (!idbAvailable()) return Promise.resolve(null);

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      if (!db) dbPromise = null; // allow a later retry
      resolve(db);
    };
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    } catch {
      done(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('responses')) {
        const s = db.createObjectStore('responses', { keyPath: 'key' });
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const s = db.createObjectStore('outbox', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('conflicts')) {
        const s = db.createObjectStore('conflicts', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema — close so it isn't blocked.
      db.onversionchange = () => {
        try { db.close(); } catch { /* ignore */ }
        dbPromise = null;
      };
      db.onclose = () => { dbPromise = null; };
      done(db);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
    // Some browsers hang open() in private mode — don't wait forever.
    setTimeout(() => done(null), 3000);
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const db = await openDb();
    if (!db) return fallback;
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const r = fn(s);
    const result = r instanceof Promise ? await r : await reqToPromise(r);
    if (mode === 'readwrite') {
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    return result;
  } catch {
    return fallback;
  }
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  return withStore<T | null>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | null>, null).then((v) => v ?? null);
}

export function idbPut<T>(store: StoreName, value: T): Promise<boolean> {
  return withStore<boolean>(
    store,
    'readwrite',
    async (s) => {
      await reqToPromise(s.put(value));
      return true;
    },
    false,
  );
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<boolean> {
  return withStore<boolean>(
    store,
    'readwrite',
    async (s) => {
      await reqToPromise(s.delete(key));
      return true;
    },
    false,
  );
}

export function idbCount(store: StoreName): Promise<number> {
  return withStore<number>(store, 'readonly', (s) => s.count(), 0);
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return withStore<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>, []);
}

/** Count records per value of an indexed field (e.g. outbox `status`). */
export async function idbCountByIndex(store: StoreName, index: string, value: IDBValidKey): Promise<number> {
  return withStore<number>(store, 'readonly', (s) => s.index(index).count(IDBKeyRange.only(value)), 0);
}

/**
 * Keep at most `max` records in `store`, deleting the oldest by `index`
 * (ascending). Returns how many were deleted.
 */
export function idbEvictOldest(store: StoreName, index: string, max: number): Promise<number> {
  return withStore<number>(
    store,
    'readwrite',
    async (s) => {
      const total = await reqToPromise(s.count());
      let excess = total - max;
      if (excess <= 0) return 0;
      let deleted = 0;
      await new Promise<void>((resolve, reject) => {
        const cursorReq = s.index(index).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || excess <= 0) return resolve();
          cursor.delete();
          deleted += 1;
          excess -= 1;
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      return deleted;
    },
    0,
  );
}

/** Empty every store (logout). The database itself is kept so open handles stay valid. */
export async function idbClearAll(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const names: StoreName[] = ['responses', 'outbox', 'conflicts', 'meta'];
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* best effort */
  }
}

export async function metaGet<T>(key: string): Promise<T | null> {
  const rec = await idbGet<MetaRecord<T>>('meta', key);
  return rec ? rec.value : null;
}

export function metaSet<T>(key: string, value: T): Promise<boolean> {
  return idbPut<MetaRecord<T>>('meta', { key, value });
}

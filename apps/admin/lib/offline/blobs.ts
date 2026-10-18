/**
 * Offline photos (admin offline mode, Phase 4).
 *
 * When a product / category image is picked while the API can't be reached,
 * AdminApiClient.uploadMultipart() stores the (already cropped) file here and
 * returns `{ url: 'offline-blob://<id>' }`. The form puts that URL wherever a
 * real upload URL would go (e.g. the product `images` array) and the write is
 * queued in the outbox as usual.
 *
 * Before replaying a queued write the sync engine (lib/offline/sync-engine.ts):
 *   1. finds every `offline-blob://<id>` string in the body (findBlobRefs),
 *   2. uploads each blob once through the normal upload endpoint with its own
 *      Idempotency-Key (a replayed upload returns the stored `{ url }`),
 *      remembering the real URL on the blob record (`uploadedUrl`),
 *   3. rewrites the body (replaceBlobRefs), persists it, then sends it.
 * Blobs are deleted once no unsynced outbox entry references them
 * (releaseBlobs / gcOrphanBlobs).
 *
 * Only the photo endpoints listed in OFFLINE_UPLOAD_ENDPOINTS are queued;
 * every other uploader keeps failing with "needs internet".
 *
 * This module must not import the API client (api.ts imports it).
 */
import { idbDelete, idbGet, idbGetAll, idbPutStrict, type StrictPutResult } from './db';

export const OFFLINE_BLOB_PREFIX = 'offline-blob://';

/** Upload endpoints whose files may be kept on the device and uploaded later. */
export const OFFLINE_UPLOAD_ENDPOINTS = ['/upload/image', '/upload/category'] as const;
export type OfflineUploadEndpoint = (typeof OFFLINE_UPLOAD_ENDPOINTS)[number];

export function isOfflineUploadEndpoint(endpoint: string): endpoint is OfflineUploadEndpoint {
  return (OFFLINE_UPLOAD_ENDPOINTS as readonly string[]).includes(endpoint);
}

export interface BlobRecord {
  /** Client id (also the part after `offline-blob://`). */
  id: string;
  /** `${tenantId|platform}:${userId}` of the operator who picked the photo. */
  scope: string;
  /** Upload endpoint to replay through, e.g. `/upload/image`. */
  endpoint: OfflineUploadEndpoint;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  /** Epoch ms. */
  createdAt: number;
  /** Idempotency-Key for the upload (kept across retries). */
  idempotencyKey: string;
  /** Real URL once uploaded (kept until no queued write references the blob). */
  uploadedUrl?: string;
}

export function isOfflineBlobUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(OFFLINE_BLOB_PREFIX);
}

export function blobIdFromUrl(url: string): string | null {
  if (!isOfflineBlobUrl(url)) return null;
  const id = url.slice(OFFLINE_BLOB_PREFIX.length).trim();
  return id || null;
}

export function blobUrl(id: string): string {
  return `${OFFLINE_BLOB_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// Body walking (pure — unit-testable without IndexedDB)
// ---------------------------------------------------------------------------

/** Every blob id referenced anywhere in `value` (strings, arrays, nested objects). */
export function findBlobRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const id = blobIdFromUrl(value);
    if (id) out.add(id);
  } else if (Array.isArray(value)) {
    for (const v of value) findBlobRefs(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) findBlobRefs(v, out);
  }
  return out;
}

/**
 * Deep copy of `value` with every `offline-blob://<id>` string replaced by
 * `urls[id]`. Ids missing from `urls` are left untouched.
 */
export function replaceBlobRefs<T>(value: T, urls: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const id = blobIdFromUrl(v);
      return id && urls[id] ? urls[id] : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

function newId(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `b${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export type StoreBlobResult = { ok: true; record: BlobRecord } | { ok: false; reason: Exclude<StrictPutResult, 'ok'> };

/** Keep a picked photo on the device. */
export async function storeOfflineBlob(scope: string, endpoint: OfflineUploadEndpoint, file: Blob, name?: string): Promise<StoreBlobResult> {
  const id = newId();
  const record: BlobRecord = {
    id,
    scope,
    endpoint,
    blob: file,
    name: name || (file as File).name || `photo-${Date.now()}.jpg`,
    type: file.type || 'image/jpeg',
    size: file.size,
    createdAt: Date.now(),
    idempotencyKey: `blob-${id}`,
  };
  const res = await idbPutStrict('blobs', record);
  return res === 'ok' ? { ok: true, record } : { ok: false, reason: res };
}

export function getBlobRecord(id: string): Promise<BlobRecord | null> {
  return idbGet<BlobRecord>('blobs', id);
}

/** Remember the real URL after a successful upload (so it's never uploaded twice). */
export async function markBlobUploaded(record: BlobRecord, url: string): Promise<void> {
  await idbPutStrict('blobs', { ...record, uploadedUrl: url });
}

export function deleteBlob(id: string): Promise<boolean> {
  return idbDelete('blobs', id);
}

/** Minimal outbox shape needed to decide whether a blob is still referenced. */
interface OutboxLike {
  status: string;
  body: unknown;
}

/** Ids referenced by unsynced (not `done`) outbox entries. */
export function referencedBlobIds(entries: OutboxLike[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.status !== 'done') findBlobRefs(e.body, out);
  return out;
}

/** Delete the given blobs unless an unsynced outbox entry still references them. */
export async function releaseBlobs(ids: Iterable<string>, outbox: OutboxLike[]): Promise<void> {
  const keep = referencedBlobIds(outbox);
  for (const id of ids) if (!keep.has(id)) await deleteBlob(id);
}

/**
 * Photos picked in a form that was never saved stay unreferenced: delete
 * blobs no unsynced entry references once they are older than `graceMs`
 * (the grace period covers a form that is still open).
 */
export const ORPHAN_BLOB_GRACE_MS = 24 * 60 * 60 * 1000;

export async function gcOrphanBlobs(outbox: OutboxLike[], graceMs = ORPHAN_BLOB_GRACE_MS): Promise<number> {
  const keep = referencedBlobIds(outbox);
  const all = await idbGetAll<BlobRecord>('blobs');
  const cutoff = Date.now() - graceMs;
  let n = 0;
  for (const b of all) {
    if (!b || typeof b.id !== 'string') continue;
    if (keep.has(b.id)) continue;
    if ((b.createdAt ?? 0) > cutoff) continue;
    if (await deleteBlob(b.id)) n += 1;
  }
  return n;
}

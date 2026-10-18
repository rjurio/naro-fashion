import { createHash } from 'crypto';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
export const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** An IN_PROGRESS row older than this is assumed abandoned (crash) and may be taken over. */
export const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;
export const DEFAULT_IDEMPOTENCY_RETENTION_DAYS = 30;

/** Deterministic JSON: object keys sorted recursively (arrays keep order). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** sha256(method + path + canonical JSON body). */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

export function resolveIdempotencyRetentionDays(raw: string | undefined): number {
  const n = Number(raw);
  // Never accept < 1 day — the window must outlive a realistic offline period
  // plus client retries.
  if (!Number.isFinite(n) || n < 1) return DEFAULT_IDEMPOTENCY_RETENTION_DAYS;
  return Math.floor(n);
}

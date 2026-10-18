/**
 * Per-user cache of GET responses, used by AdminApiClient.request() to keep
 * pages readable when the API is unreachable (offline mode, Phase 1).
 *
 * Key: `${tenantId | 'platform'}:${userId}:${pathWithQuery}` — derived from
 * the stored access token's payload (decoded, not verified: this is only a
 * cache partition, the API remains the authority). With no decodable token
 * nothing is cached or served, so one operator can never see another's data.
 */
import {
  idbEvictOldest,
  idbGet,
  idbPut,
  metaGet,
  metaSet,
  type CachedResponseRecord,
} from './db';

/** Skip responses larger than this (serialized chars ≈ bytes for JSON). */
export const MAX_CACHED_RESPONSE_CHARS = 2 * 1024 * 1024;
/** Keep at most this many cached responses (oldest evicted). */
export const MAX_CACHED_RESPONSES = 500;

/** Endpoints never cached: auth, sync bookkeeping, health, private files/exports. */
const UNCACHEABLE_PREFIXES = ['/auth/', '/auth?', '/sync/', '/health', '/upload/', '/audit/export'];

export function isCacheableEndpoint(endpoint: string): boolean {
  const path = endpoint.split('?')[0];
  if (path === '/auth' || path === '/health' || path === '/sync') return false;
  if (UNCACHEABLE_PREFIXES.some((p) => endpoint.startsWith(p))) return false;
  if (/\/(export|download)(\/|$|\?)/.test(path)) return false;
  return true;
}

export interface TokenIdentity {
  userId: string;
  tenantId: string | null;
  isPlatformAdmin: boolean;
}

/** Decode a JWT payload without verifying it (client-side partitioning only). */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(padded) : '';
    if (!json) return null;
    // Handle UTF-8 in claims (names etc.)
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function identityFromToken(token: string | null | undefined): TokenIdentity | null {
  const p = decodeJwtPayload(token);
  if (!p || typeof p.sub !== 'string' || !p.sub) return null;
  return {
    userId: p.sub,
    tenantId: typeof p.tenantId === 'string' && p.tenantId ? p.tenantId : null,
    isPlatformAdmin: p.isPlatformAdmin === true,
  };
}

export function scopeFromIdentity(id: TokenIdentity | null): string | null {
  if (!id) return null;
  const tenantPart = id.tenantId ?? (id.isPlatformAdmin ? 'platform' : 'none');
  return `${tenantPart}:${id.userId}`;
}

let writesSinceEvict = 0;

/** Store a successful GET body. Fire-and-forget; never throws. */
export async function writeCachedResponse(scope: string | null, pathWithQuery: string, body: string): Promise<void> {
  if (!scope || !body || body.length > MAX_CACHED_RESPONSE_CHARS) return;
  const record: CachedResponseRecord = {
    key: `${scope}:${pathWithQuery}`,
    body,
    savedAt: Date.now(),
    size: body.length,
  };
  const ok = await idbPut('responses', record);
  if (!ok) return;
  writesSinceEvict += 1;
  if (writesSinceEvict >= 20) {
    writesSinceEvict = 0;
    void idbEvictOldest('responses', 'savedAt', MAX_CACHED_RESPONSES);
  }
}

/** Read a cached GET body for the current scope. */
export async function readCachedResponse(
  scope: string | null,
  pathWithQuery: string,
): Promise<{ data: unknown; savedAt: number } | null> {
  if (!scope) return null;
  const rec = await idbGet<CachedResponseRecord>('responses', `${scope}:${pathWithQuery}`);
  if (!rec || typeof rec.body !== 'string') return null;
  try {
    return { data: rec.body ? JSON.parse(rec.body) : null, savedAt: rec.savedAt };
  } catch {
    return null;
  }
}

/** Trim the cache once at start-up (cheap; bounded by MAX_CACHED_RESPONSES). */
export function trimResponseCache(): void {
  void idbEvictOldest('responses', 'savedAt', MAX_CACHED_RESPONSES);
}

// ---------------------------------------------------------------------------
// Cached profile (/auth/me is never in the response cache, but offline
// reloads need the signed-in user to render the dashboard shell).
// ---------------------------------------------------------------------------

const PROFILE_KEY = 'profile';

export async function saveCachedProfile(scope: string | null, profile: unknown): Promise<void> {
  if (!scope || !profile) return;
  await metaSet(PROFILE_KEY, { scope, profile, savedAt: Date.now() });
}

/** Returns the cached profile only if it belongs to the same token scope. */
export async function loadCachedProfile<T>(scope: string | null): Promise<T | null> {
  if (!scope) return null;
  const rec = await metaGet<{ scope: string; profile: T; savedAt: number }>(PROFILE_KEY);
  if (!rec || rec.scope !== scope) return null;
  return rec.profile ?? null;
}

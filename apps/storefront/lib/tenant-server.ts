// Server-only module (uses next/headers). Do not import from client components.
import { cookies, headers } from 'next/headers';

export const SERVER_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
export const SERVER_API_ORIGIN = SERVER_API_URL.replace(/\/api\/v1\/?$/, '');

/**
 * Resolve the current tenant id inside a server component / route handler.
 *
 * 1. `x-tenant-id` REQUEST header — set by middleware.ts on every request
 *    (overwriting anything the client sent), so it's present even on the very
 *    first visit / for crawlers that never carry cookies.
 * 2. `tenantId` cookie — set by middleware on a previous response.
 */
export async function getServerTenantId(): Promise<string | null> {
  try {
    const h = await headers();
    const fromHeader = h.get('x-tenant-id');
    if (fromHeader) return fromHeader;
  } catch {
    // headers() unavailable outside a request (build time)
  }
  try {
    const c = await cookies(); // Next 15: async
    return c.get('tenantId')?.value || null;
  } catch {
    return null;
  }
}

/** `{ 'X-Tenant-Id': id }` for SSR fetches to the API (empty if unknown). */
export async function serverTenantHeaders(): Promise<Record<string, string>> {
  const id = await getServerTenantId();
  return id ? { 'X-Tenant-Id': id } : {};
}

/**
 * Absolute origin of the current request (`https://narofashion.co.tz`), used
 * for canonical URLs / sitemap entries so each tenant domain gets its own
 * absolute links. Falls back to NEXT_PUBLIC_SITE_URL, then localhost.
 */
export async function getRequestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
      const proto =
        h.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
        (process.env.NODE_ENV === 'production' ? 'https' : 'http');
      return `${proto === 'http' ? 'http' : 'https'}://${host}`;
    }
  } catch {
    // outside request
  }
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Tenant-scoped, uncached GET against the API from the server. Returns `null`
 * on any failure so metadata/sitemap generation never crashes a page.
 * `cache: 'no-store'` is mandatory: Next's URL-keyed fetch cache would
 * otherwise serve tenant A's payload to tenant B.
 */
export async function serverApiGet<T = any>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${endpoint}`, {
      cache: 'no-store',
      headers: await serverTenantHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Prefix API-relative upload paths (`/uploads/...`) with the request origin. */
export function absolutizeUrl(url: string | null | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

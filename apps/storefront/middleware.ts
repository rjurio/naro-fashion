import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const TENANT_SLUG_FALLBACK = process.env.NEXT_PUBLIC_TENANT_SLUG || 'naro-fashion';
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Hosts that may fall back to the `NEXT_PUBLIC_TENANT_SLUG` tenant when the
 * domain lookup finds nothing. In production an unknown Host must NOT be
 * served the default tenant (that would let any domain pointed at this server
 * impersonate the store, and lets cache/SEO poisoning attach our content to
 * arbitrary hosts) — it gets a 404 instead.
 *
 * - `localhost` / `127.0.0.1` are always allowed outside production.
 * - `STOREFRONT_DEFAULT_HOSTS` (comma-separated, e.g.
 *   `narofashion.co.tz,www.narofashion.co.tz`) whitelists hosts in production.
 *   The primary tenant normally resolves via `/tenants/resolve?domain=` (its
 *   apex domain is stored on the Tenant row, and `www.` is stripped before the
 *   lookup), so this allowlist is a safety net, not the primary path.
 */
const DEFAULT_HOSTS = new Set(
  (process.env.STOREFRONT_DEFAULT_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Nonce-based Content-Security-Policy (single source of truth — next.config.js
 * no longer sets a CSP header).
 *
 * Every page response gets a fresh per-request nonce. The nonce is placed on:
 *   - the response `Content-Security-Policy` header (what the browser enforces)
 *   - the forwarded *request* `Content-Security-Policy` header — Next 15's
 *     app-render reads the nonce from it and stamps it on its own framework
 *     <script> tags (bootstrap, RSC flight data, chunk tags)
 *   - the forwarded request `x-nonce` header — read by app/layout.tsx via
 *     `headers()` for our own inline scripts (theme bootstrap, next-themes,
 *     JSON-LD).
 *
 * `'strict-dynamic'` lets nonce'd scripts load further scripts (webpack
 * chunks, the bundled <model-viewer> import) without a host allowlist; in
 * CSP3 browsers it makes `'self'`/host sources ignored, which are kept only as
 * a CSP2 fallback. `'wasm-unsafe-eval'` + gstatic stay for model-viewer's
 * Draco/KTX2 decoders (fetched via connect-src, run as blob workers + wasm).
 * `'unsafe-eval'` only in development (React Refresh).
 *
 * style-src keeps `'unsafe-inline'`: Tailwind/next-themes/React `style={}`
 * attributes and next/font emit inline styles. Adding a nonce to style-src
 * would disable 'unsafe-inline' and break those, and inline styles are a far
 * lower risk than inline scripts.
 *
 * Non-script directives are unchanged from the previous static CSP.
 */
const API_ORIGIN = (() => {
  try {
    return new URL(API_URL.replace(/\/api\/v1\/?$/, '')).origin;
  } catch {
    return 'http://localhost:4000';
  }
})();

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https://www.gstatic.com${IS_PROD ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:" + (IS_PROD ? '' : ' http://localhost:*'),
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN} https://www.gstatic.com${IS_PROD ? '' : ' ws: http://localhost:*'}`,
    "media-src 'self' blob: https:" + (IS_PROD ? '' : ' http://localhost:*'),
    "worker-src 'self' blob:",
    'frame-src https://www.google.com https://maps.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(IS_PROD ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Stamps nonce + CSP onto the forwarded request headers; returns the CSP string. */
function applyNonce(requestHeaders: Headers): string {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  return csp;
}

function mayUseSlugFallback(hostname: string): boolean {
  if (DEFAULT_HOSTS.has(hostname)) return true;
  if (IS_PROD) return false;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

// Bounded LRU + TTL cache for tenant resolution. A Map preserves insertion
// order, so re-inserting on hit moves the key to the "most recent" end and the
// first key is always the least recently used.
const CACHE_TTL = 60_000; // 60 seconds
const CACHE_MAX = 500;
const NEGATIVE_CACHE_TTL = 10_000; // 10 seconds
const tenantCache = new Map<string, { data: any; expiry: number }>();

function cacheGet(key: string): any | undefined {
  const hit = tenantCache.get(key);
  if (!hit) return undefined;
  if (hit.expiry <= Date.now()) {
    tenantCache.delete(key);
    return undefined;
  }
  tenantCache.delete(key);
  tenantCache.set(key, hit);
  return hit.data;
}

function cacheSet(key: string, data: any, ttl = CACHE_TTL) {
  if (tenantCache.has(key)) tenantCache.delete(key);
  tenantCache.set(key, { data, expiry: Date.now() + ttl });
  while (tenantCache.size > CACHE_MAX) {
    const oldest = tenantCache.keys().next().value;
    if (oldest === undefined) break;
    tenantCache.delete(oldest);
  }
}

async function resolveTenant(hostname: string): Promise<any | null> {
  const cached = cacheGet(hostname);
  if (cached !== undefined) return cached;

  // Strip leading "www." so www.narofashion.co.tz and narofashion.co.tz both
  // resolve to the same tenant row (which is stored under the apex domain).
  const lookupDomain = hostname.replace(/^www\./i, '');

  try {
    const res = await fetch(
      `${API_URL}/tenants/resolve?domain=${encodeURIComponent(lookupDomain)}`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const tenant = await res.json();
      if (tenant?.id) {
        cacheSet(hostname, tenant);
        return tenant;
      }
    }
  } catch {
    // Domain lookup failed — maybe fall back below
  }

  if (!mayUseSlugFallback(hostname)) {
    cacheSet(hostname, null, NEGATIVE_CACHE_TTL);
    return null;
  }

  try {
    const res = await fetch(
      `${API_URL}/tenants/resolve?slug=${encodeURIComponent(TENANT_SLUG_FALLBACK)}`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const tenant = await res.json();
      if (tenant?.id) {
        cacheSet(hostname, tenant);
        return tenant;
      }
    }
  } catch {
    // Slug lookup also failed
  }

  // Short negative cache so a flood of requests for an unknown Host doesn't
  // turn into one API round-trip each (kept short so a transient API outage
  // doesn't pin a real tenant to 404 for long).
  cacheSet(hostname, null, NEGATIVE_CACHE_TTL);
  return null;
}

export async function middleware(request: NextRequest) {
  const hostname = (request.headers.get('host')?.split(':')[0] || 'localhost').toLowerCase();

  // Skip for static assets and API routes
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|webp|woff|woff2)$/)
  ) {
    // Never let a client-supplied x-tenant-id reach server code unverified.
    // Same for x-nonce: always overwritten with a fresh server-generated one.
    const stripped = new Headers(request.headers);
    stripped.delete('x-tenant-id');
    stripped.delete('x-tenant-slug');
    // Static assets/API don't render the layout, but stamp a CSP anyway so a
    // page path that happens to match the extension regex is never served
    // without one.
    const csp = applyNonce(stripped);
    const res = NextResponse.next({ request: { headers: stripped } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }

  const tenant = await resolveTenant(hostname);

  if (!tenant) {
    return new NextResponse('Store not found', { status: 404 });
  }

  if (tenant.status === 'SUSPENDED') {
    return new NextResponse('This store is temporarily unavailable. Please try again later.', {
      status: 503,
    });
  }

  // Forward the tenant to the *request* so server components / route handlers
  // (settings-server.ts, generateMetadata, sitemap, manifest) can read it via
  // `headers()` on the very first visit — before the browser has the cookie.
  // Never trust an inbound x-tenant-id from the client: always overwrite it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-id', tenant.id);
  requestHeaders.set('x-tenant-slug', String(tenant.slug ?? ''));
  const csp = applyNonce(requestHeaders);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Tenant-Id', tenant.id);
  response.headers.set('X-Tenant-Slug', String(tenant.slug ?? ''));

  // Cookie so client-side code (lib/api.ts) can inject X-Tenant-Id.
  response.cookies.set('tenantId', tenant.id, {
    httpOnly: false, // Needs to be readable by client JS
    path: '/',
    maxAge: 60 * 60, // 1 hour
    sameSite: 'lax',
    secure: IS_PROD,
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

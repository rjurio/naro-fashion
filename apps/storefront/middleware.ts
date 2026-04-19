import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const TENANT_SLUG_FALLBACK = process.env.NEXT_PUBLIC_TENANT_SLUG || 'naro-fashion';

// Simple in-memory cache for tenant resolution
const tenantCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 60_000; // 60 seconds

async function resolveTenant(hostname: string): Promise<any | null> {
  // Check cache first
  const cached = tenantCache.get(hostname);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  // Strip leading "www." so www.narofashion.co.tz and narofashion.co.tz both
  // resolve to the same tenant row (which is stored under the apex domain).
  // Without this, the www variant falls through to the slug fallback and
  // we unnecessarily waste a round-trip on every request.
  const lookupDomain = hostname.replace(/^www\./i, '');

  try {
    // Try domain resolution
    const res = await fetch(`${API_URL}/tenants/resolve?domain=${lookupDomain}`, {
      next: { revalidate: 60 },
    });

    if (res.ok) {
      const tenant = await res.json();
      tenantCache.set(hostname, { data: tenant, expiry: Date.now() + CACHE_TTL });
      return tenant;
    }
  } catch {
    // Domain lookup failed — try slug fallback for local dev
  }

  // Fallback: use TENANT_SLUG env var (local development)
  try {
    const res = await fetch(`${API_URL}/tenants/resolve?slug=${TENANT_SLUG_FALLBACK}`);
    if (res.ok) {
      const tenant = await res.json();
      tenantCache.set(hostname, { data: tenant, expiry: Date.now() + CACHE_TTL });
      return tenant;
    }
  } catch {
    // Slug lookup also failed
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0] || 'localhost';

  // Skip for static assets and API routes
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|webp|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  const tenant = await resolveTenant(hostname);

  if (!tenant) {
    // No tenant found — show a "store not found" page
    return new NextResponse('Store not found', { status: 404 });
  }

  if (tenant.status === 'SUSPENDED') {
    return new NextResponse('This store is temporarily unavailable. Please try again later.', {
      status: 503,
    });
  }

  // Pass tenant context to the request via headers
  const response = NextResponse.next();
  response.headers.set('X-Tenant-Id', tenant.id);
  response.headers.set('X-Tenant-Slug', tenant.slug);
  response.headers.set('X-Tenant-Name', tenant.name);

  // Also set a cookie so client-side code can read it
  response.cookies.set('tenantId', tenant.id, {
    httpOnly: false, // Needs to be readable by client JS
    path: '/',
    maxAge: 60 * 60, // 1 hour
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

import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Build an `X-Tenant-Id` header from the `tenantId` cookie set by
 * `apps/storefront/middleware.ts` during tenant resolution.
 *
 * Required for SSR fetches: server components don't auto-forward cookies the
 * way the browser does, so without this the API returns the default tenant's
 * data (or errors) for every domain — manifest.json + first-paint metadata
 * end up identical for every tenant.
 */
async function tenantHeader(): Promise<Record<string, string>> {
  try {
    const c = await cookies(); // Next 15: cookies() is async
    const id = c.get('tenantId')?.value;
    return id ? { 'X-Tenant-Id': id } : {};
  } catch {
    // cookies() is unavailable outside a request context (e.g. during build).
    return {};
  }
}

export interface BusinessProfile {
  businessName: string;
  businessNameSw: string;
  tagline: string;
  taglineSw: string;
  businessType: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  contactAddressSw: string;
  whatsappNumber: string;
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  tiktokUrl: string;
  logoUrl: string;
  iconUrl: string;
  faviconUrl: string;
  domain: string;
  currency: string;
}

const DEFAULTS: BusinessProfile = {
  businessName: 'Naro Fashion',
  businessNameSw: '',
  tagline: 'Premium Fashion & Clothing in Tanzania',
  taglineSw: '',
  businessType: 'Fashion',
  contactEmail: 'hello@narofashion.co.tz',
  contactPhone: '0753968554',
  contactAddress: 'Kibada/Kigamboni, Dar es Salaam, Tanzania',
  contactAddressSw: '',
  whatsappNumber: '255759047287',
  instagramUrl: 'https://www.instagram.com/narofashion2019/',
  facebookUrl: '',
  twitterUrl: '',
  tiktokUrl: '',
  logoUrl: '/logo.jpg',
  iconUrl: '/icon.jpg',
  faviconUrl: '/favicon.jpg',
  domain: 'narofashion.co.tz',
  currency: 'TZS',
};

export async function getBusinessProfile(): Promise<BusinessProfile> {
  try {
    const res = await fetch(`${API_URL}/cms/settings/business-profile`, {
      // `cache: 'no-store'` avoids cross-tenant cache key collisions —
      // Next's URL-based cache would otherwise return tenant A's profile
      // to tenant B's first request after revalidation. Manifest/metadata
      // fetches are infrequent so the extra API hit is fine.
      cache: 'no-store',
      headers: await tenantHeader(),
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  } catch {
    return DEFAULTS;
  }
}

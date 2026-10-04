import type { MetadataRoute } from 'next';
import { getRequestOrigin } from '@/lib/tenant-server';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Per-tenant: point crawlers at the sitemap on the domain they're visiting.
  const baseUrl = await getRequestOrigin();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account/', '/checkout', '/cart', '/auth/', '/orders/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

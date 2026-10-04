import type { MetadataRoute } from 'next';
import { getRequestOrigin, serverApiGet } from '@/lib/tenant-server';

// Tenant-scoped: every domain gets its own sitemap with its own absolute URLs.
export const dynamic = 'force-dynamic';

type CategoryNode = { slug: string; children?: CategoryNode[] };

function flattenCategories(nodes: CategoryNode[] | null | undefined, out: string[] = []): string[] {
  for (const n of nodes || []) {
    if (n?.slug) out.push(n.slug);
    if (n?.children?.length) flattenCategories(n.children, out);
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Absolute URLs use the request host, so tenant B's sitemap never points at
  // tenant A's domain.
  const BASE_URL = await getRequestOrigin();
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/categories`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/rentals`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/flash-sales`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/events`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/pages/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/pages/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/pages/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/pages/terms`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/pages/privacy-policy`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/pages/size-guide`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/pages/shipping-info`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];

  // Both fetches carry X-Tenant-Id (request header from middleware → cookie fallback).
  const [productsRes, categories] = await Promise.all([
    serverApiGet<{ data: { slug: string; updatedAt?: string; createdAt?: string }[] }>(
      '/products?limit=1000',
    ),
    serverApiGet<CategoryNode[]>('/categories'),
  ]);

  const productPages: MetadataRoute.Sitemap = (productsRes?.data || [])
    .filter((p) => p?.slug)
    .map((p) => {
      const ts = p.updatedAt || p.createdAt;
      return {
        url: `${BASE_URL}/products/${encodeURIComponent(p.slug)}`,
        lastModified: ts ? new Date(ts) : now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
    });

  const categoryPages: MetadataRoute.Sitemap = Array.from(
    new Set(flattenCategories(Array.isArray(categories) ? categories : [])),
  ).map((slug) => ({
    url: `${BASE_URL}/categories/${encodeURIComponent(slug)}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...productPages, ...categoryPages];
}

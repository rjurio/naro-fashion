import type { Metadata } from 'next';
import { cache } from 'react';
import { getBusinessProfile } from '@/lib/settings-server';
import { getRequestOrigin, serverApiGet } from '@/lib/tenant-server';
import { buildEntityMetadata, resolveApiImage, serializeJsonLd, toPlainText } from '@/lib/seo-server';

type Params = Promise<{ slug: string }>;

// Per-request memo so generateMetadata + the layout share one API call.
const getProduct = cache((slug: string) =>
  serverApiGet<any>(`/products/${encodeURIComponent(slug)}`),
);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  return buildEntityMetadata({
    path: `/products/${encodeURIComponent(slug)}`,
    title: product?.name,
    description: product?.description,
    image: product?.images?.[0]?.url,
    notFound: !product,
  });
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);

  let jsonLd: Record<string, unknown> | null = null;
  if (product?.name) {
    const [origin, bp] = await Promise.all([getRequestOrigin(), getBusinessProfile()]);
    const images = (product.images || [])
      .map((img: any) => resolveApiImage(img?.url, origin))
      .filter(Boolean);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const inStock = variants.length === 0 || variants.some((v: any) => (v?.stock ?? 0) > 0);
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: toPlainText(product.description, 5000),
      ...(images.length ? { image: images } : {}),
      sku: product.sku || product.id,
      brand: { '@type': 'Brand', name: bp.businessName },
      offers: {
        '@type': 'Offer',
        url: `${origin}/products/${encodeURIComponent(slug)}`,
        priceCurrency: bp.currency || 'TZS',
        price: Number(product.basePrice) || 0,
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
      ...(product.avgRating && product.reviewCount
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(product.avgRating),
              reviewCount: Number(product.reviewCount),
            },
          }
        : {}),
    };
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // serializeJsonLd escapes < > & so "</script>" in tenant data can't break out.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}

import type { Metadata } from 'next';
import { serverApiGet } from '@/lib/tenant-server';
import { buildEntityMetadata } from '@/lib/seo-server';

type Params = Promise<{ slug: string }>;

// Rental detail pages are products with availabilityMode RENTAL_ONLY/BOTH.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await serverApiGet<any>(`/products/${encodeURIComponent(slug)}`);
  return buildEntityMetadata({
    path: `/rentals/${encodeURIComponent(slug)}`,
    title: product?.name,
    description: product?.description,
    image: product?.images?.[0]?.url,
    notFound: !product,
  });
}

export default function RentalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

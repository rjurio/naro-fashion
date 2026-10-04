import type { Metadata } from 'next';
import { serverApiGet } from '@/lib/tenant-server';
import { buildEntityMetadata } from '@/lib/seo-server';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const category = await serverApiGet<any>(`/categories/${encodeURIComponent(slug)}`);
  return buildEntityMetadata({
    path: `/categories/${encodeURIComponent(slug)}`,
    title: category?.name,
    description: category?.description,
    image: category?.imageUrl || category?.fallbackImageUrl,
    notFound: !category,
  });
}

export default function CategoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

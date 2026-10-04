import type { Metadata } from 'next';
import { serverApiGet } from '@/lib/tenant-server';
import { buildEntityMetadata } from '@/lib/seo-server';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const event = await serverApiGet<any>(`/events/by-slug/${encodeURIComponent(slug)}`);
  const cover =
    event?.coverImageUrl ||
    (Array.isArray(event?.media) ? event.media.find((m: any) => m?.mediaType === 'IMAGE')?.url : undefined);
  return buildEntityMetadata({
    path: `/events/${encodeURIComponent(slug)}`,
    title: event?.title,
    description: event?.description,
    image: cover,
    type: 'article',
    notFound: !event,
  });
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';
import { serverApiGet } from '@/lib/tenant-server';
import { buildEntityMetadata } from '@/lib/seo-server';

type Params = Promise<{ slug: string }>;

// Titles for built-in fallback pages (rendered from i18n when the tenant has
// no CMS page with that slug) so they still get a sensible <title>.
const FALLBACK_TITLES: Record<string, string> = {
  about: 'About Us',
  contact: 'Contact Us',
  faq: 'FAQ',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  'privacy-policy': 'Privacy Policy',
  'size-guide': 'Size Guide',
  'shipping-info': 'Shipping Information',
  'returns-exchanges': 'Returns & Exchanges',
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = await serverApiGet<any>(`/cms/pages/${encodeURIComponent(slug)}`);
  const published = page && page.isPublished !== false ? page : null;
  return buildEntityMetadata({
    path: `/pages/${encodeURIComponent(slug)}`,
    title: published?.title ?? FALLBACK_TITLES[slug],
    description: published?.content,
    type: 'article',
    notFound: !published && !FALLBACK_TITLES[slug],
  });
}

export default function CmsPageLayout({ children }: { children: React.ReactNode }) {
  return children;
}

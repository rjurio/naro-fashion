'use client';

import { useState, useEffect } from 'react';
import { Instagram, Heart, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';
import { cmsApi } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const API_ORIGIN = API_BASE_URL.replace('/api/v1', '');

interface InstagramPost {
  id: string;
  caption?: string;
  imageUrl: string;
  postUrl?: string;
  likes: number;
  sortOrder: number;
}

interface InstagramFeedProps {
  /** Hard upper cap on visible posts. Applied after the layout-derived count. */
  maxPosts?: number;
  /** 'single_row' = 6 posts (one desktop row). 'multi_row' = `rows` × 6. */
  layout?: 'single_row' | 'multi_row';
  /** Row count for multi_row layout (1..5). Ignored when layout is single_row. */
  rows?: number;
}

// Desktop grid width — must stay in sync with `lg:grid-cols-6` below.
const DESKTOP_COLS = 6;

export default function InstagramFeed({ maxPosts, layout = 'single_row', rows = 2 }: InstagramFeedProps) {
  const { t } = useTranslation();
  const { settings } = useSiteSettings();
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(true);
  const instagramUrl = settings.instagramUrl || 'https://www.instagram.com/';
  const instagramHandle = instagramUrl.match(/instagram\.com\/([^/?]+)/)?.[1] || '';

  useEffect(() => {
    cmsApi.getInstagramPosts()
      .then((data) => setPosts(Array.isArray(data) ? data : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  // Layout determines slot count; max_posts is a hard cap on top of that.
  const layoutSlots = layout === 'multi_row' ? Math.max(1, rows) * DESKTOP_COLS : DESKTOP_COLS;
  const effectiveCap = maxPosts && maxPosts > 0 ? Math.min(layoutSlots, maxPosts) : layoutSlots;
  const visiblePosts = posts.slice(0, effectiveCap);

  const resolveImageUrl = (url: string) =>
    url.startsWith('/uploads') ? `${API_ORIGIN}${url}` : url;

  if (loading) {
    return (
      <section className="py-12 sm:py-16 bg-card">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
        </div>
      </section>
    );
  }

  if (visiblePosts.length === 0) return null;

  return (
    <section className="py-12 sm:py-16 bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Instagram className="h-6 w-6 text-gold-500" />
            <h2 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">
              {t('home.followUs')}
            </h2>
          </div>
          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-500 hover:text-gold-600 text-sm font-medium transition-colors"
          >
            {instagramHandle ? `@${instagramHandle}` : ''}
          </a>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            {t('home.instagramDesc')}
          </p>
        </div>

        {/* Grid of Instagram Posts */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {visiblePosts.map((post) => (
            <a
              key={post.id}
              href={post.postUrl || instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-square rounded-lg overflow-hidden bg-muted hover:shadow-lg transition-shadow duration-300"
            >
              <img
                src={resolveImageUrl(post.imageUrl)}
                alt={post.caption || 'Instagram post'}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-dark-500/70 md:bg-dark-500/0 md:group-hover:bg-dark-500/70 transition-all duration-300 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100">
                <div className="text-center text-white transform scale-95 group-hover:scale-100 transition-transform">
                  {post.likes > 0 && (
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Heart className="h-4 w-4" />
                      <span className="text-sm font-semibold">{post.likes}</span>
                    </div>
                  )}
                  {post.caption && (
                    <p className="text-xs font-medium px-2 line-clamp-2">{post.caption}</p>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Follow Button */}
        <div className="text-center mt-8">
          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-dark-800 to-dark-900 text-white px-6 py-3 text-sm font-medium hover:from-dark-700 hover:to-dark-800 hover:scale-105 active:scale-[0.97] transition-all shadow-md hover:shadow-lg"
          >
            <Instagram className="h-5 w-5" />
            {t('home.followOnInstagram')}
          </a>
        </div>
      </div>
    </section>
  );
}

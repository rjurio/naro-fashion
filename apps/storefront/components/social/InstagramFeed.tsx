'use client';

import { Instagram } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

// Placeholder posts - replace with real Instagram API data later
const instagramPosts = [
  { id: '1', imageUrl: '/images/instagram/ig-1.jpg', likes: 234, caption: 'New collection drop' },
  { id: '2', imageUrl: '/images/instagram/ig-2.jpg', likes: 189, caption: 'Behind the scenes' },
  { id: '3', imageUrl: '/images/instagram/ig-3.jpg', likes: 312, caption: 'Customer spotlight' },
  { id: '4', imageUrl: '/images/instagram/ig-4.jpg', likes: 276, caption: 'Style inspiration' },
  { id: '5', imageUrl: '/images/instagram/ig-5.jpg', likes: 198, caption: 'Flash sale preview' },
  { id: '6', imageUrl: '/images/instagram/ig-6.jpg', likes: 421, caption: 'Wedding collection' },
];

const INSTAGRAM_URL = 'https://www.instagram.com/narofashion2019/';

export default function InstagramFeed() {
  const { t } = useTranslation();
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
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-500 hover:text-gold-600 text-sm font-medium transition-colors"
          >
            @narofashion2019
          </a>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            {t('home.instagramDesc')}
          </p>
        </div>

        {/* Grid of Instagram Posts */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {instagramPosts.map((post) => (
            <a
              key={post.id}
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-square rounded-lg overflow-hidden bg-muted"
            >
              {/* Placeholder - gradient bg with Instagram icon */}
              <div className="absolute inset-0 bg-gradient-to-br from-dark-300 to-dark-500 flex items-center justify-center">
                <Instagram className="h-8 w-8 text-dark-200" />
              </div>

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-dark-500/0 group-hover:bg-dark-500/70 transition-all duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
                <div className="text-center text-white transform scale-95 group-hover:scale-100 transition-transform">
                  <Instagram className="h-6 w-6 mx-auto mb-1" />
                  <p className="text-xs font-medium">{post.caption}</p>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Follow Button */}
        <div className="text-center mt-8">
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-dark-800 to-dark-900 text-white px-6 py-3 text-sm font-medium hover:from-dark-700 hover:to-dark-800 transition-all shadow-md hover:shadow-lg"
          >
            <Instagram className="h-5 w-5" />
            {t('home.followOnInstagram')}
          </a>
        </div>
      </div>
    </section>
  );
}

import type { MetadataRoute } from 'next';
import { getBusinessProfile } from '@/lib/settings-server';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const bp = await getBusinessProfile();

  return {
    name: bp.businessName,
    short_name: bp.businessName.split(' ')[0] || bp.businessName,
    description: bp.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#1A1A1A',
    orientation: 'portrait-primary',
    categories: ['shopping', 'fashion', 'lifestyle'],
    lang: 'en',
    icons: [
      {
        src: '/icon.jpg',
        sizes: '192x192',
        type: 'image/jpeg',
        purpose: 'any',
      },
      {
        src: '/logo.jpg',
        sizes: '512x512',
        type: 'image/jpeg',
        purpose: 'any',
      },
    ],
  };
}

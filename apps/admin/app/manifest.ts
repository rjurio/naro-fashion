import type { MetadataRoute } from 'next';

/** Lets the admin be installed as an app (works with the offline service worker). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Naro Admin',
    short_name: 'Naro Admin',
    description: 'Naro Fashion admin dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#1A1A1A',
    theme_color: '#1A1A1A',
    icons: [
      { src: '/logo.jpg', sizes: '1080x1080', type: 'image/jpeg', purpose: 'any' },
      { src: '/icon.jpg', sizes: '303x306', type: 'image/jpeg', purpose: 'any' },
    ],
  };
}

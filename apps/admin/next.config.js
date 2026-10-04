const isDev = process.env.NODE_ENV !== 'production';

/** Origin of the NestJS API (images/uploads/GLB models + XHR all come from here). */
function apiOrigin() {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/api\/v1\/?$/, '');
  }
}

/**
 * Content-Security-Policy for the admin SPA.
 *
 * External resources the admin actually loads (audit before tightening):
 *  - API origin: fetch/XHR, /uploads images, GLB/GLTF models (model-viewer)
 *  - https://ajax.googleapis.com — model-viewer CDN fallback (Model3dUploader)
 *  - https://www.gstatic.com — model-viewer's Draco / KTX2 decoders
 *  - https://www.google.com/maps embed iframe (Business Profile map preview)
 *  - YouTube / Vimeo iframes — Quill video embeds in rich-text previews
 *  - Inline scripts: the theme bootstrap in app/layout.tsx, Next.js runtime
 *    and the POS receipt print window → 'unsafe-inline' (no nonce plumbing yet)
 *  - next/font/google is self-hosted at build time → font-src 'self'
 */
function contentSecurityPolicy() {
  const api = apiOrigin();
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), 'https://ajax.googleapis.com', 'https://www.gstatic.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', api],
    'media-src': ["'self'", 'data:', 'blob:', api],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", api, 'blob:', 'data:', 'https://www.gstatic.com', ...(isDev ? ['ws:', 'wss:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': [
      "'self'",
      'blob:',
      'https://www.google.com',
      'https://maps.google.com',
      'https://www.youtube.com',
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
    ],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${Array.from(new Set(v)).join(' ')}`)
    .join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // geolocation=(self): Business Profile "detect my location" uses the browser API.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  output: 'standalone', // Note: may cause EPERM symlink errors on OneDrive-synced directories

  transpilePackages: ['@naro/shared'],
  reactStrictMode: true,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  async rewrites() {
    const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');
    return [
      {
        source: '/uploads/:path*',
        destination: `${apiOrigin}/uploads/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

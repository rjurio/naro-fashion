/*
 * Content-Security-Policy is NOT set here any more — middleware.ts generates
 * it per request with a nonce (no script 'unsafe-inline'), so there is exactly
 * one CSP header. Keep the resource audit there in sync.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // geolocation=(self): Business Profile "detect my location" uses the browser API.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: never build into a different distDir and rename it to .next —
  // `next build` bakes the distDir name into its output, so every
  // /_next/static asset 404s (prod outage 2026-10-04). deploy.sh builds in
  // place and keeps a pre-build copy for rollback instead.
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

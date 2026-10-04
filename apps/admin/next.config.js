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
  // deploy.sh builds into a side directory (NEXT_DIST_DIR=.next-build) and
  // swaps it into place only after the build is verified, so the live
  // process never serves a half-written .next. Runtime always uses .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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

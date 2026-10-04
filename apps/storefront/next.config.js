/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

let apiUrl;
try {
  apiUrl = new URL(apiOrigin);
} catch {
  apiUrl = new URL('http://localhost:4000');
}

/**
 * next/image remote hosts. Previously `hostname: '**'`, which turned
 * /_next/image into an open image proxy/resizer for any host on the internet
 * (bandwidth/CPU abuse on a 2GB VPS + SSRF-ish fetches). Restricted to:
 *   - the API host (uploads), localhost (dev)
 *   - Instagram / Facebook CDNs (Instagram feed mirror fallbacks)
 *   - Cloudinary
 * Keep lib/image-hosts.ts in sync — components fall back to `unoptimized`
 * for anything outside this list instead of throwing.
 */
const remotePatterns = [
  { protocol: 'http', hostname: 'localhost' },
  { protocol: 'https', hostname: 'api.narofashion.co.tz' },
  { protocol: 'https', hostname: '**.cdninstagram.com' },
  { protocol: 'https', hostname: '**.fbcdn.net' },
  { protocol: 'https', hostname: 'res.cloudinary.com' },
];
if (
  apiUrl.hostname !== 'localhost' &&
  apiUrl.hostname !== 'api.narofashion.co.tz'
) {
  remotePatterns.push({ protocol: apiUrl.protocol.replace(':', ''), hostname: apiUrl.hostname });
}

/**
 * Content-Security-Policy is NOT set here any more — it is generated per
 * request with a nonce in middleware.ts (buildCsp), so there is exactly one
 * CSP header and no script 'unsafe-inline'. External resources audited for it:
 *   - API (fetch + /uploads images)            → connect-src / img-src
 *   - Google Maps embed on /pages/contact      → frame-src www.google.com
 *   - <model-viewer> (bundled from npm) loads its Draco/KTX2 decoders from
 *     www.gstatic.com as wasm + blob workers  → connect-src, script-src, worker-src, 'wasm-unsafe-eval'
 *   - next/font/google is self-hosted at build → font-src 'self'
 *   - product/IG/event images may come from any https host (tenant data) → img-src https:
 *   - event videos                              → media-src https: blob:
 *   - wa.me / payment gateway pages open via window.open (navigation, not CSP-governed)
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Contact page does NOT use geolocation (only the admin's business-profile
  // page does), so it's disabled here. xr-spatial-tracking=(self) keeps
  // <model-viewer> WebXR AR working.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=(self)',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig = {
  // deploy.sh builds into a side directory (NEXT_DIST_DIR=.next-build) and
  // swaps it into place only after the build is verified, so the live
  // process never serves a half-written .next. Runtime always uses .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  output: 'standalone',
  poweredByHeader: false,

  transpilePackages: ["@naro/shared"],

  images: {
    remotePatterns,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${apiOrigin}/uploads/:path*`,
      },
    ];
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

module.exports = nextConfig;

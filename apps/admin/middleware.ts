import { NextRequest, NextResponse } from 'next/server';

/**
 * Nonce-based Content-Security-Policy for the admin app (single source of
 * truth — next.config.js no longer sets a CSP header). This middleware does
 * nothing else: admin has no tenant resolution (tenantId flows via the JWT).
 *
 * Per request:
 *   - a fresh nonce is generated
 *   - the CSP is set on the response (what the browser enforces)
 *   - the CSP is also set on the forwarded *request* — Next 15's app-render
 *     reads the nonce from it and stamps its own framework <script> tags
 *   - `x-nonce` is forwarded for app/layout.tsx (theme bootstrap script +
 *     next-themes' injected script)
 *
 * External resources the admin loads (audit before tightening):
 *  - API origin: fetch/XHR, /uploads images, GLB/GLTF models (model-viewer)
 *  - https://ajax.googleapis.com — model-viewer CDN fallback (Model3dUploader
 *    injects it via createElement('script'), allowed by 'strict-dynamic')
 *  - https://www.gstatic.com — model-viewer's Draco / KTX2 decoders
 *  - https://www.google.com/maps embed iframe (Business Profile map preview)
 *  - YouTube / Vimeo iframes — Quill video embeds in rich-text previews
 *  - next/font/google is self-hosted at build time → font-src 'self'
 *
 * 'strict-dynamic' makes CSP3 browsers ignore 'self'/host sources in
 * script-src (kept as a CSP2 fallback) and trust scripts loaded by nonce'd
 * scripts (webpack chunks, dynamic imports). 'unsafe-eval' only in dev.
 * style-src keeps 'unsafe-inline' (Tailwind/next-themes/React style attrs,
 * Quill, Recharts inline styles) — adding a nonce there would disable it.
 */
const IS_DEV = process.env.NODE_ENV !== 'production';

const API_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/api\/v1\/?$/, '');
  }
})();

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(IS_DEV ? ["'unsafe-eval'"] : []),
      'https://ajax.googleapis.com',
      'https://www.gstatic.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', API_ORIGIN],
    'media-src': ["'self'", 'data:', 'blob:', API_ORIGIN],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", API_ORIGIN, 'blob:', 'data:', 'https://www.gstatic.com', ...(IS_DEV ? ['ws:', 'wss:'] : [])],
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

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Always overwrite — never trust a client-supplied x-nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Page routes only. Excluded:
     * - _next/static, _next/image (build assets / image optimizer)
     * - favicon + static files by extension (incl. /uploads/* images and GLB models)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|glb|gltf|woff2?)$).*)',
  ],
};

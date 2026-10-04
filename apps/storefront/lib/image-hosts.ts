/**
 * Mirror of `images.remotePatterns` in next.config.js. next/image throws at
 * render time for a remote host that isn't configured, so for sources outside
 * this list pass `unoptimized` (renders a plain <img>, no proxying).
 * Keep in sync with next.config.js.
 */
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(
  /\/api\/v1\/?$/,
  '',
);

let apiHost = '';
try {
  apiHost = new URL(API_ORIGIN).hostname;
} catch {
  apiHost = '';
}

const EXACT_HOSTS = new Set(
  ['api.narofashion.co.tz', 'localhost', 'res.cloudinary.com', apiHost].filter(Boolean),
);
const SUFFIX_HOSTS = ['.cdninstagram.com', '.fbcdn.net'];

export function isOptimizableImage(src: string | null | undefined): boolean {
  if (!src) return false;
  if (src.startsWith('/') && !src.startsWith('//')) return true; // same-origin
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
      return false;
    }
    return EXACT_HOSTS.has(u.hostname) || SUFFIX_HOSTS.some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}

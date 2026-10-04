// Server-only helpers for per-route generateMetadata (uses next/headers).
import type { Metadata } from 'next';
import { getBusinessProfile } from './settings-server';
import { absolutizeUrl, getRequestOrigin, SERVER_API_ORIGIN } from './tenant-server';

/** Strip tags/entities and collapse whitespace → plain text for meta descriptions. */
export function toPlainText(html: string | null | undefined, max = 160): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Resolve an image path from the API (`/uploads/...`) to an absolute URL. */
export function resolveApiImage(url: string | null | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/uploads')) {
    // /uploads is rewritten to the API by next.config.js, so the storefront
    // origin serves it too — prefer the API origin when it's absolute.
    return /^https?:\/\//.test(SERVER_API_ORIGIN) ? `${SERVER_API_ORIGIN}${url}` : `${origin}${url}`;
  }
  return absolutizeUrl(url, origin);
}

export async function buildEntityMetadata(opts: {
  path: string; // e.g. `/products/${slug}`
  title?: string | null;
  description?: string | null;
  image?: string | null;
  type?: 'website' | 'article';
  notFound?: boolean;
}): Promise<Metadata> {
  const [origin, bp] = await Promise.all([getRequestOrigin(), getBusinessProfile()]);
  const canonical = `${origin}${opts.path}`;
  if (opts.notFound || !opts.title) {
    return {
      title: `${bp.businessName}`,
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }
  const title = `${opts.title} | ${bp.businessName}`;
  const description = toPlainText(opts.description) || bp.tagline;
  const image = resolveApiImage(opts.image, origin);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: bp.businessName,
      type: opts.type ?? 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * Serialize JSON-LD safely for a <script type="application/ld+json">.
 * Escapes <, >, & to \uXXXX so a value containing "</script>" can't break out
 * of the element (JSON.parse reads the escapes back transparently).
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

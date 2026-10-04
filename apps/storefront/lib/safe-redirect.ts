/**
 * Validate a user-supplied post-login redirect target (e.g. `?redirect=`).
 *
 * Only same-origin, path-absolute targets are accepted. Rejects:
 *   - absolute URLs to other origins (`https://evil.com`)
 *   - protocol-relative URLs (`//evil.com`)
 *   - backslash tricks (`/\evil.com` — browsers normalise `\` to `/`)
 *   - control characters / whitespace smuggling (`/\t/evil.com`)
 *   - `javascript:` and other non-http schemes
 *
 * Returns the normalised `pathname + search + hash` on success, or `fallback`.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  // Reject backslashes and any ASCII control char / whitespace outright.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F\s]/.test(raw)) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

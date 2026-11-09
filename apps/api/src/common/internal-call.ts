import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Explicit authentication for the API's calls to ITSELF (today only the
 * ai-assistant tool loop → /api/v1/ai/* on localhost).
 *
 * The token is random, generated once per process at start-up, kept in
 * memory and never logged or configured — the caller (ai-assistant service)
 * and the checker (AppThrottlerGuard) live in the same Node process, so no
 * other process on the shared VPS can know it. Replaces the old blanket
 * "any loopback request without X-Forwarded-For skips rate limiting".
 */
export const INTERNAL_CALL_HEADER = 'x-naro-internal-call';

const TOKEN = randomBytes(32).toString('hex');

export function internalCallToken(): string {
  return TOKEN;
}

export function safeEqualString(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length || b.length === 0) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function isValidInternalCallToken(value: unknown): boolean {
  return safeEqualString(value, TOKEN);
}

/** Only attach the token to requests that stay on this machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

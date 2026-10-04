import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step) built on Node's `crypto` — no
 * third-party dependency. Compatible with Google Authenticator, Microsoft
 * Authenticator, Authy, 1Password, etc.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous / next step too (clock drift tolerance). */
export const TOTP_WINDOW = 1;
/** 20 random bytes = 160-bit secret (RFC 4226 recommendation). */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32 (case-insensitive, ignores spaces / dashes / `=` padding). Throws on invalid chars. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s\-=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) for a given counter. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer; JS numbers are safe up to 2^53.
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac(algorithm, secret).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export function timeStep(unixSeconds: number, step = TOTP_STEP_SECONDS): number {
  return Math.floor(unixSeconds / step);
}

/** TOTP code for a unix time (seconds). */
export function generateTotp(secret: Buffer, unixSeconds: number, digits = TOTP_DIGITS, step = TOTP_STEP_SECONDS): string {
  return hotp(secret, timeStep(unixSeconds, step), digits);
}

/**
 * Verify a TOTP code. Returns the matched time-step counter (use it for
 * replay protection) or null. Constant-time per comparison; checks every
 * candidate in the window regardless of an early match.
 */
export function verifyTotp(
  secretBase32: string,
  code: unknown,
  opts: { nowMs?: number; window?: number; digits?: number } = {},
): number | null {
  const digits = opts.digits ?? TOTP_DIGITS;
  if (typeof code !== 'string') return null;
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return null;
  }
  if (secret.length === 0) return null;

  const window = opts.window ?? TOTP_WINDOW;
  const current = timeStep(Math.floor((opts.nowMs ?? Date.now()) / 1000));
  const given = Buffer.from(normalized);
  let matched: number | null = null;
  for (let i = -window; i <= window; i++) {
    const counter = current + i;
    if (counter < 0) continue;
    const expected = Buffer.from(hotp(secret, counter, digits));
    if (timingSafeEqual(expected, given) && matched === null) matched = counter;
  }
  return matched;
}

/** New random base32 secret (20 bytes → 32 base32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** `otpauth://totp/<Issuer>:<account>?secret=…&issuer=…` — the URI authenticator apps (and QR codes) consume. */
export function buildOtpauthUrl(issuer: string, account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

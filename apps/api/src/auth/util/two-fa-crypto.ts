import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { requireJwtSecret } from './jwt-secrets';

/**
 * At-rest encryption for AdminUser.twoFASecret (AES-256-GCM).
 *
 * Stored format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 *
 * Key: HKDF-SHA256 over env `TWO_FA_ENCRYPTION_KEY` (>= 32 chars). In
 * production a missing/short key returns null — callers refuse to enable
 * 2FA (boot is never blocked). Outside production the key falls back to an
 * HKDF derivation of JWT_SECRET so local dev works without extra config.
 *
 * Generate the production key with: openssl rand -hex 32
 */

export const TWO_FA_KEY_ENV = 'TWO_FA_ENCRYPTION_KEY';
const HKDF_SALT = 'naro-fashion/2fa';
const HKDF_INFO = 'twoFASecret/aes-256-gcm/v1';
const VERSION = 'v1';

let warnedFallback = false;

function hkdf32(material: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), HKDF_SALT, HKDF_INFO, 32));
}

/** Resolve the 32-byte AES key, or null when 2FA can't be used safely (prod without key). */
export function resolveTwoFaKey(config: ConfigService): Buffer | null {
  const raw = config.get<string>(TWO_FA_KEY_ENV);
  if (raw && raw.length >= 32) return hkdf32(raw);

  if (process.env.NODE_ENV === 'production') return null;

  if (!warnedFallback) {
    warnedFallback = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[auth] ${TWO_FA_KEY_ENV} not set (or < 32 chars) — deriving the 2FA secret key from JWT_SECRET (dev only). ` +
        'If JWT_SECRET is itself ephemeral, enrolled 2FA secrets stop decrypting on restart.',
    );
  }
  return hkdf32(`jwt-fallback:${requireJwtSecret('JWT_SECRET', config)}`);
}

export function encryptTwoFaSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Returns the plaintext, or null on any format / auth-tag failure (wrong key, tampering, legacy value). */
export function decryptTwoFaSecret(stored: string | null | undefined, key: Buffer): string | null {
  if (typeof stored !== 'string') return null;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** True when the stored value looks like an encrypted (real) enrolment, not a legacy/stale flag. */
export function isEncryptedTwoFaSecret(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(`${VERSION}:`) && stored.split(':').length === 4;
}

import { createHash, randomBytes } from 'crypto';
import { base32Encode } from './totp';

/**
 * One-time 2FA recovery codes. 10 codes of 10 base32 chars (50 bits each),
 * shown as `XXXXX-XXXXX`. Only sha256 hashes of the normalised code are
 * stored (`twoFARecoveryCodes String[]`); the plaintext is returned once.
 */

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_CHARS = 10;

/** Uppercase + strip everything but base32 chars ("abcde-fghij " → "ABCDEFGHIJ"). */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const n = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return n.length === RECOVERY_CODE_CHARS ? n : null;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`naro-2fa-recovery:${normalized}`).digest('hex');
}

/** Heuristic: 6 digits → TOTP; anything else that normalises to 10 base32 chars → recovery code. */
export function looksLikeRecoveryCode(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  if (/^\s*\d{6}\s*$/.test(input)) return false;
  return normalizeRecoveryCode(input) !== null;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const seen = new Set<string>();
  while (plain.length < count) {
    const raw = base32Encode(randomBytes(7)).slice(0, RECOVERY_CODE_CHARS); // 56 bits → 10 chars
    if (seen.has(raw)) continue;
    seen.add(raw);
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { plain, hashes: plain.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)) };
}

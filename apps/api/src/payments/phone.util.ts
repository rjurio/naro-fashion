/**
 * Normalize Tanzanian phone numbers to international format (255XXXXXXXXX).
 * Accepts formats like +255..., 0..., or bare 9-digit local numbers.
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.startsWith('0')) {
    cleaned = '255' + cleaned.substring(1);
  }

  if (!cleaned.startsWith('255') && cleaned.length === 9) {
    cleaned = '255' + cleaned;
  }

  return cleaned;
}

/**
 * Mixx by YAS (formerly Tigo Pesa) prefixes: 071, 065, 067, 077.
 * In canonical form that's 25571/25565/25567/25577 + 7 digits.
 */
export function isMixxMsisdn(canonical: string): boolean {
  return /^255(71|65|67|77)\d{7}$/.test(canonical);
}

/**
 * Mask a phone number for logs/UI: 2557********12 → "255****XXXX".
 */
export function maskPhone(canonical: string): string {
  if (!canonical || canonical.length < 6) return canonical;
  const prefix = canonical.slice(0, 3);
  const suffix = canonical.slice(-4);
  return `${prefix}****${suffix}`;
}

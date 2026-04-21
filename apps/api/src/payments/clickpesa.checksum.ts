import { createHmac, timingSafeEqual } from 'crypto';

type Json = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: Json;
}
type JsonArray = Json[];

/**
 * Recursively sort object keys (by default string comparison), preserve array
 * order, and strip `checksum`/`checksumMethod` fields anywhere they appear.
 */
export function canonicalizeForChecksum(value: Json): Json {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeForChecksum);
  }

  const out: JsonObject = {};
  const keys = Object.keys(value as JsonObject)
    .filter((k) => k !== 'checksum' && k !== 'checksumMethod')
    .sort();

  for (const key of keys) {
    out[key] = canonicalizeForChecksum((value as JsonObject)[key]);
  }

  return out;
}

/**
 * Build the canonical JSON string ClickPesa uses for HMAC signing.
 */
export function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalizeForChecksum(payload as Json));
}

/**
 * Compute the ClickPesa HMAC-SHA256 checksum: 64-char lowercase hex.
 */
export function computeChecksum(payload: unknown, secret: string): string {
  const canonical = canonicalJson(payload);
  return createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest('hex')
    .toLowerCase();
}

/**
 * Constant-time compare of a received checksum against a recomputed one.
 * Safely handles length mismatches (returns false).
 */
export function verifyChecksum(
  payload: unknown,
  secret: string,
  receivedChecksum: string | undefined | null,
): boolean {
  if (!receivedChecksum) return false;

  const expected = computeChecksum(payload, secret);
  const received = receivedChecksum.toLowerCase();

  if (expected.length !== received.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(received, 'hex'),
    );
  } catch {
    return false;
  }
}

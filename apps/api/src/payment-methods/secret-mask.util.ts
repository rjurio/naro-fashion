/**
 * Masking for gateway credentials stored on PaymentMethod
 * (`integrationParams` JSON + `integrationKey`).
 *
 * Admin read responses never return a secret in clear: any key whose name
 * matches SECRET_KEY_PATTERN (apiKey, checksumSecret, clientSecret, token,
 * password, …) is replaced by MASK_PREFIX + last 4 chars. On update, a value
 * that still carries the mask prefix means "unchanged" and the stored secret
 * is kept — so the admin UI can round-trip the JSON it was shown without
 * overwriting real credentials with the mask.
 */

export const MASK_PREFIX = '••••';
export const SECRET_KEY_PATTERN = /secret|key|token|password/i;

export function maskSecretValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 8 ? `${MASK_PREFIX}${s.slice(-4)}` : MASK_PREFIX;
}

export function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(MASK_PREFIX);
}

/** Recursively mask secret-named keys in an integrationParams object. */
export function maskIntegrationParams(params: unknown): unknown {
  if (Array.isArray(params)) return params.map(maskIntegrationParams);
  if (params === null || typeof params !== 'object') return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k) && (v === null || typeof v !== 'object')) {
      out[k] = maskSecretValue(v);
    } else {
      out[k] = maskIntegrationParams(v);
    }
  }
  return out;
}

/**
 * Merge an incoming integrationParams object with the stored one: every
 * masked value is replaced by the stored value at the same path. Non-masked
 * values (real edits) win. Keys absent from `incoming` are dropped, matching
 * the existing full-replace semantics of the PATCH.
 */
export function restoreMaskedSecrets(
  incoming: unknown,
  existing: unknown,
): unknown {
  if (isMaskedValue(incoming)) {
    return existing;
  }
  if (Array.isArray(incoming)) {
    const ex = Array.isArray(existing) ? existing : [];
    return incoming.map((v, i) => restoreMaskedSecrets(v, ex[i]));
  }
  if (incoming === null || typeof incoming !== 'object') return incoming;
  const ex =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    out[k] = restoreMaskedSecrets(v, ex[k]);
  }
  return out;
}

/** Mask the secret-bearing columns of a PaymentMethod row for admin output. */
export function maskPaymentMethod<
  T extends { integrationParams?: unknown; integrationKey?: string | null },
>(row: T): T {
  if (!row) return row;
  return {
    ...row,
    ...(row.integrationParams !== undefined && {
      integrationParams: maskIntegrationParams(row.integrationParams),
    }),
    ...(row.integrationKey !== undefined && {
      integrationKey: maskSecretValue(row.integrationKey) as string | null,
    }),
  };
}

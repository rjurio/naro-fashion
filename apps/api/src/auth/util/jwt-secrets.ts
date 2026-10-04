import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';

type SecretName = 'JWT_SECRET' | 'JWT_REFRESH_SECRET';

const ephemeralCache: Record<string, string> = {};
const warned: Record<string, boolean> = {};

/**
 * Resolve a JWT secret from env, hard-failing in production if it's missing
 * or too short. In dev, falls back to a per-process random value so leaked
 * dev tokens are useless across restarts and never publicly known.
 *
 * Replaces the previous pattern of `configService.get('JWT_SECRET', 'naro-secret-key')`
 * which silently signed tokens with a literal default.
 */
export function requireJwtSecret(
  name: SecretName,
  config: ConfigService,
): string {
  const v = config.get<string>(name);
  if (v && v.length >= 32) {
    // Access and refresh tokens MUST be signed with different keys in
    // production — otherwise a refresh token verifies as an access token
    // (and vice versa) and the `typ` claim is the only thing separating them.
    if (process.env.NODE_ENV === 'production') {
      const otherName: SecretName = name === 'JWT_SECRET' ? 'JWT_REFRESH_SECRET' : 'JWT_SECRET';
      const other = config.get<string>(otherName);
      if (other && other === v) {
        throw new Error(
          'Refusing to start: JWT_SECRET and JWT_REFRESH_SECRET must be different values in production. ' +
            'Generate a fresh one with: openssl rand -hex 48',
        );
      }
    }
    return v;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to start: ${name} env var must be set (>=32 chars) in production. ` +
        `Generate one with: openssl rand -hex 48`,
    );
  }

  if (!ephemeralCache[name]) {
    ephemeralCache[name] = randomBytes(48).toString('hex');
  }
  if (!warned[name]) {
    warned[name] = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[auth] ${name} not set or too short (<32 chars) — using ephemeral dev secret. ` +
        `Tokens invalidate on process restart.`,
    );
  }
  return ephemeralCache[name];
}

/** JWT `typ` claim values — a token used for the wrong purpose is rejected. */
export type JwtTokenType = 'access' | 'refresh';

/**
 * True when a payload's `typ` claim is compatible with the expected use.
 * Legacy tokens (issued before the claim existed) carry no `typ` and are
 * accepted so existing sessions aren't all killed on deploy; an explicit
 * mismatch (refresh token presented as access, or vice versa) is rejected.
 */
export function isTokenTypeAllowed(payload: { typ?: unknown } | null | undefined, expected: JwtTokenType): boolean {
  if (!payload) return false;
  if (payload.typ === undefined || payload.typ === null) return true;
  return payload.typ === expected;
}

/**
 * True when the payload's token version matches the principal's current
 * `tokenVersion`. Legacy tokens without a `tv` claim are treated as version 0,
 * so they keep working until the first logout / password change bumps it.
 */
export function isTokenVersionCurrent(payload: { tv?: unknown } | null | undefined, rowVersion: number | null | undefined): boolean {
  const tv = typeof payload?.tv === 'number' ? payload.tv : 0;
  return tv === (rowVersion ?? 0);
}

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
  if (v && v.length >= 32) return v;

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

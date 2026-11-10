import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';

/**
 * Per-ACCOUNT attempt limits on credential endpoints (Nov 2026).
 *
 * The global throttle is per client IP. That doesn't protect one account
 * against guessing spread over many IPs — or from a local process forging
 * X-Forwarded-For — and customers have no account lockout (only AdminUser /
 * PlatformAdmin do). This adds a limit keyed by the TARGET identity
 * (tenant + normalised email, or a hash of a token), independent of IP.
 *
 * Two tiers for sign-in (login / platform-login):
 *  - STRICT per account + client IP (`limit`, e.g. 10 / 15 min): someone
 *    hammering a victim's email from their own IP is stopped there, and the
 *    real customer — on a different IP — can still sign in.
 *  - GENEROUS per account, any IP (`accountLimit`, e.g. 60 / 15 min): bounds
 *    guessing spread over many IPs, or a local process forging
 *    X-Forwarded-For (which defeats per-IP keys but not this one).
 * A request blocked by the strict tier does not consume the account tier.
 * Token-keyed endpoints (2FA challenge, reset token) and forgot-password use
 * a single key.
 *
 * Anti-enumeration: keys are built from the SUBMITTED identifier without any
 * lookup, so a blocked request looks identical whether or not the account
 * exists. Counts attempts (success or failure) in a fixed window; in-memory,
 * single API instance (same assumption as the 2FA replay cache).
 *
 * Residual (documented): an attacker controlling enough IPs can still use up
 * one victim's account tier for a window (60 attempts / 15 min). That is far
 * weaker than the admin lockout (5 failures → 30 min) and costs the attacker
 * many IPs; without it, customer passwords had no per-account protection.
 */
export interface CredentialLimitConfig {
  /** Bucket namespace, e.g. 'login'. */
  name: string;
  /** Body field identifying the target account / token. */
  field: string;
  /** Hash the value (tokens) instead of storing it. */
  hash?: boolean;
  /** Limit for the key (per account + client IP when `perClient`). */
  limit: number;
  windowMs: number;
  /** Key the strict tier by account AND client IP. */
  perClient?: boolean;
  /** Generous per-account ceiling across all IPs (with `perClient`). */
  accountLimit?: number;
}

export const CREDENTIAL_LIMIT_KEY = 'credentialLimit';
export const CredentialLimit = (cfg: CredentialLimitConfig) => SetMetadata(CREDENTIAL_LIMIT_KEY, cfg);

export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt; returns false when the key is over its limit. */
  hit(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      e = { count: 0, resetAt: t + windowMs };
      this.hits.set(key, e);
      if (this.hits.size > this.maxKeys) this.prune(t);
    }
    e.count += 1;
    return e.count <= limit;
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }

  get size() {
    return this.hits.size;
  }
}

export function credentialKey(cfg: CredentialLimitConfig, req: any): string | null {
  const raw = req?.body?.[cfg.field];
  if (typeof raw !== 'string') return null; // the DTO will reject it
  const v = raw.trim().toLowerCase();
  if (!v || v.length > 512) return null;
  const id = cfg.hash ? createHash('sha256').update(v).digest('hex').slice(0, 32) : v;
  const tenant = String(req?.headers?.['x-tenant-id'] ?? req?.body?.tenantId ?? '-').slice(0, 64);
  return `${cfg.name}:${tenant}:${id}`;
}

const sharedLimiter = new FixedWindowLimiter();

@Injectable()
export class CredentialAttemptGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Overridable in tests. */
  protected limiter: FixedWindowLimiter = sharedLimiter;

  canActivate(context: ExecutionContext): boolean {
    const cfg = this.reflector.get<CredentialLimitConfig | undefined>(CREDENTIAL_LIMIT_KEY, context.getHandler());
    if (!cfg) return true;
    const req = context.switchToHttp().getRequest();
    const key = credentialKey(cfg, req);
    if (!key) return true;
    const tooMany = () =>
      new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (cfg.perClient) {
      const client = String(req?.ip ?? req?.socket?.remoteAddress ?? '-');
      if (!this.limiter.hit(`${key}|ip:${client}`, cfg.limit, cfg.windowMs)) throw tooMany();
      if (cfg.accountLimit && !this.limiter.hit(key, cfg.accountLimit, cfg.windowMs)) throw tooMany();
      return true;
    }
    if (!this.limiter.hit(key, cfg.limit, cfg.windowMs)) throw tooMany();
    return true;
  }
}

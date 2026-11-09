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
 * Counts attempts (successful or not) in a fixed window. In-memory, single
 * API instance (same assumption as the 2FA replay cache). A victim's
 * account can be temporarily rate-limited by someone hammering it — the
 * same trade-off as the existing admin lockout, but shorter.
 */
export interface CredentialLimitConfig {
  /** Bucket namespace, e.g. 'login'. */
  name: string;
  /** Body field identifying the target account / token. */
  field: string;
  /** Hash the value (tokens) instead of storing it. */
  hash?: boolean;
  limit: number;
  windowMs: number;
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
    const key = credentialKey(cfg, context.switchToHttp().getRequest());
    if (!key) return true;
    if (!this.limiter.hit(key, cfg.limit, cfg.windowMs)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many attempts for this account. Please wait a few minutes and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

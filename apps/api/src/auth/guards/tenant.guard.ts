import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { requireJwtSecret } from '../util/jwt-secrets';

/** Tenant statuses that lose API access. TRIAL / GRACE / ACTIVE keep it. */
export const BLOCKED_TENANT_STATUSES = new Set(['SUSPENDED', 'DEACTIVATED']);

/**
 * Paths (after the global `/api/v1` prefix) that stay reachable for a
 * blocked tenant so the UI can still render a clear "suspended" state and
 * the user can sign out. Matched by exact path, method-agnostic.
 */
const ALWAYS_ALLOWED_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/auth/login',
  '/api/v1/auth/platform-login',
  '/api/v1/auth/2fa/verify', // login step 2 — same treatment as /auth/login
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/tenants/resolve',
]);

/**
 * TenantGuard — registered GLOBALLY (APP_GUARD inside TenantModule).
 *
 * Rejects every tenant-scoped request (403 "Tenant suspended") whose tenant
 * is SUSPENDED or DEACTIVATED. Before this guard was wired, the subscription
 * lifecycle cron could flip a tenant to SUSPENDED but the tenant kept full
 * API access — the status was purely cosmetic.
 *
 * Because global guards run BEFORE route-level `JwtAuthGuard`, `req.user` is
 * not yet populated here. We therefore resolve the tenant the same way
 * `TenantInterceptor` does:
 *   1. Verified Bearer token (requireJwtSecret) → payload.tenantId
 *      (platform admins — `isPlatformAdmin` — bypass entirely)
 *   2. Otherwise the `X-Tenant-Id` header (anonymous storefront traffic)
 * Requests with no resolvable tenant (platform-admin login, webhooks,
 * health, tenant resolve) pass through — they are not tenant-scoped.
 * Unknown tenant ids also pass; downstream queries simply match nothing.
 *
 * This guard does NOT set `req.tenantId` — trust/precedence stays owned by
 * TenantInterceptor + TenantContext. It is purely a status gate.
 *
 * Tenant status is cached for 60s per tenant, so a suspension/reactivation
 * takes effect within a minute without a DB hit per request.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);
  private static readonly cache = new Map<string, { status: string | null; expires: number }>();
  static readonly TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Drop the cached status (call after changing a tenant's status). */
  static invalidate(tenantId?: string) {
    if (tenantId) TenantGuard.cache.delete(tenantId);
    else TenantGuard.cache.clear();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();

    const path = String(request.path || request.url || '').split('?')[0];
    if (ALWAYS_ALLOWED_PATHS.has(path)) return true;

    // req.user may already exist if something upstream authenticated.
    if (request.user?.isPlatformAdmin) return true;

    let tenantId: string | null = request.user?.tenantId || null;

    if (!tenantId) {
      const authHeader: string | undefined = request.headers?.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        try {
          const payload: any = this.jwtService.verify(authHeader.substring(7), {
            secret: requireJwtSecret('JWT_SECRET', this.configService),
          });
          // A refresh token is never a valid Bearer credential (defence in
          // depth; legacy tokens without `typ` are still accepted).
          if (payload?.typ !== 'refresh') {
            if (payload?.isPlatformAdmin) return true;
            if (payload?.tenantId) tenantId = payload.tenantId;
          }
        } catch {
          // Invalid/expired token: JwtAuthGuard (or the public-route
          // fallback) handles authentication. Fall through to the header.
        }
      }
    }

    if (!tenantId) {
      const header = request.headers?.['x-tenant-id'];
      if (typeof header === 'string' && header.length > 0) tenantId = header;
    }

    if (!tenantId) return true;

    const status = await this.getStatus(tenantId);
    if (status && BLOCKED_TENANT_STATUSES.has(status)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'TENANT_SUSPENDED',
        message:
          status === 'DEACTIVATED'
            ? 'Tenant suspended: this store has been deactivated. Please contact support.'
            : 'Tenant suspended: this store account is suspended. Please contact support.',
      });
    }
    return true;
  }

  private async getStatus(tenantId: string): Promise<string | null> {
    const hit = TenantGuard.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.status;

    let status: string | null = null;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true },
      });
      status = tenant?.status ?? null;
    } catch (err) {
      // Fail OPEN on a DB error: an outage must not be amplified into a
      // platform-wide 403. Don't cache the failure.
      this.logger.warn(`Tenant status lookup failed: ${(err as Error).message}`);
      return null;
    }
    TenantGuard.cache.set(tenantId, { status, expires: Date.now() + TenantGuard.TTL_MS });
    return status;
  }
}

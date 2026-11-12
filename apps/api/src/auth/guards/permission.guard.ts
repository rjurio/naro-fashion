import { recordSecurityEvent } from '../../audit/security-audit';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/requires-permission.decorator';
import { effectivePermissionCodes } from '../util/permission-check';

/**
 * PermissionGuard — enforces RBAC permission codes declared via
 * `@RequiresPermission(...)`. Apply AFTER JwtAuthGuard + AdminGuard so
 * `request.user` (the AdminUser row) is populated.
 *
 * Before this guard, admin endpoints were gated by AdminGuard alone, which
 * only checks `isAdmin`. That let ANY admin — including STAFF/MANAGER — hit
 * SUPER_ADMIN-only actions (e.g. create an admin account with role
 * 'SUPER_ADMIN', mutate roles). The RBAC model (Permission/Role/RolePermission/
 * AdminUserRole) was fully seeded but never enforced on non-AI routes.
 *
 * Bypass rules (deliberate, fail-safe):
 *  - Platform admins bypass everything (they operate above tenant RBAC).
 *  - An AdminUser whose JWT `role` string is 'SUPER_ADMIN' bypasses. SUPER_ADMIN
 *    holds every permission by design, and this keeps the primary/default admin
 *    from being locked out if their AdminUserRole rows are ever absent.
 *  - Everyone else must have at least one of the required codes among the
 *    permissions granted by their assigned roles.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  // Short-TTL cache of adminUserId -> permission codes. Permissions change
  // rarely; 60s keeps role edits reasonably fresh without a DB hit per request.
  private readonly cache = new Map<string, { codes: Set<string>; expires: number }>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');

    if (user.isPlatformAdmin) return true;
    if (user.role === 'SUPER_ADMIN') return true;

    // Customers never hold RBAC permissions (AdminGuard should already have
    // stopped them; this is defence in depth if the guard order changes).
    if (!user.isAdmin) {
      throw new ForbiddenException(
        `Missing required permission: ${required.join(' or ')}`,
      );
    }

    const codes = await this.resolvePermissions(user.id, user.tenantId ?? null);
    const allowed = required.some((code) => codes.has(code));
    if (!allowed) {
      await this.recordDenial(context, user, required);
      throw new ForbiddenException(
        `Missing required permission: ${required.join(' or ')}`,
      );
    }
    return true;
  }

  // One audit row per admin + route per minute: a refused privileged action
  // is recorded without letting a script flood the log.
  private readonly lastDenial = new Map<string, number>();

  private async recordDenial(context: ExecutionContext, user: any, required: string[]) {
    const req = context.switchToHttp().getRequest();
    const route = `${req.method} ${req.route?.path ?? String(req.originalUrl ?? req.url ?? '').split('?')[0]}`;
    const key = `${user.id}|${route}`;
    const now = Date.now();
    const last = this.lastDenial.get(key);
    if (last !== undefined && now - last < 60_000) return;
    this.lastDenial.set(key, now);
    if (this.lastDenial.size > 5000) {
      for (const [k, t] of this.lastDenial) if (now - t >= 60_000) this.lastDenial.delete(k);
    }
    await recordSecurityEvent(this.prisma as any, {
      action: 'PERMISSION_DENIED',
      result: 'DENIED',
      tenantId: user.tenantId ?? null,
      actor: { type: 'admin', id: user.id, role: user.role ?? null },
      targetType: 'Route',
      targetId: route,
      ipAddress: req.ip ?? null,
      details: { required, targetAdminId: req.params?.id ?? null },
    });
  }

  /**
   * Effective permission codes for an admin. Only roles that are
   *  - owned by the admin's OWN tenant, or shared system roles
   *    (tenantId=null, isSystem=true) — a stray AdminUserRole row pointing at
   *    another tenant's custom role grants nothing, and
   *  - not soft-deleted (`deletedAt: null`) and still active
   * contribute codes.
   */
  private async resolvePermissions(adminUserId: string, tenantId: string | null): Promise<Set<string>> {
    const cacheKey = `${adminUserId}:${tenantId ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.codes;

    const codes = await effectivePermissionCodes(this.prisma, adminUserId, tenantId);
    this.cache.set(cacheKey, { codes, expires: Date.now() + this.ttlMs });
    return codes;
  }
}

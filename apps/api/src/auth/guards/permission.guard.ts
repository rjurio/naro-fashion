import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/requires-permission.decorator';

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

    const codes = await this.resolvePermissions(user.id);
    const allowed = required.some((code) => codes.has(code));
    if (!allowed) {
      throw new ForbiddenException(
        `Missing required permission: ${required.join(' or ')}`,
      );
    }
    return true;
  }

  private async resolvePermissions(adminUserId: string): Promise<Set<string>> {
    const cached = this.cache.get(adminUserId);
    if (cached && cached.expires > Date.now()) return cached.codes;

    const rows = await this.prisma.adminUserRole.findMany({
      where: { adminUserId },
      select: {
        role: {
          select: {
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    const codes = new Set<string>();
    for (const r of rows) {
      for (const rp of r.role.permissions) {
        codes.add(rp.permission.code);
      }
    }
    this.cache.set(adminUserId, { codes, expires: Date.now() + this.ttlMs });
    return codes;
  }
}

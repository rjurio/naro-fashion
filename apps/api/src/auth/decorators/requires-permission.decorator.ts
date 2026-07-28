import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Marks a route as requiring one of the given RBAC permission codes (OR
 * semantics). Enforced by `PermissionGuard`, which resolves the current
 * admin's effective permissions from their assigned roles.
 *
 * SUPER_ADMIN (by JWT role string) and platform admins bypass the check — see
 * PermissionGuard for why (backward-compat safety so the primary admin can
 * never be locked out).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
 *   @RequiresPermission('admins:create')
 *   @Post()
 *   create(...) {}
 */
export const RequiresPermission = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);

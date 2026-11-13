/**
 * Shared RBAC resolution — used by PermissionGuard (route-level
 * `@RequiresPermission`) and by services that need a CONDITIONAL check
 * inside one request (e.g. a POS sale only needs `payments:confirm-manual`
 * when it contains a non-cash tender). One copy of the rules:
 *
 *  - Platform admins and AdminUsers whose (DB-refreshed) role is
 *    SUPER_ADMIN hold every permission.
 *  - Customers never hold RBAC permissions.
 *  - Everyone else: codes granted by their assigned roles that are the
 *    admin's OWN tenant's roles or shared system roles, active and not
 *    soft-deleted.
 */
export async function effectivePermissionCodes(
  prisma: { adminUserRole: { findMany: (args: any) => Promise<any[]> } },
  adminUserId: string,
  tenantId: string | null,
): Promise<Set<string>> {
  const tenantScope = tenantId
    ? [{ tenantId }, { tenantId: null, isSystem: true }]
    : [{ tenantId: null, isSystem: true }];

  const rows = await prisma.adminUserRole.findMany({
    where: {
      adminUserId,
      role: { deletedAt: null, isActive: true, OR: tenantScope },
    },
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
    for (const rp of r.role.permissions) codes.add(rp.permission.code);
  }
  return codes;
}

export async function userHasPermission(
  prisma: { adminUserRole: { findMany: (args: any) => Promise<any[]> } },
  user: { id?: string; isPlatformAdmin?: boolean; isAdmin?: boolean; role?: string; tenantId?: string | null } | null | undefined,
  code: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  if (user.role === 'SUPER_ADMIN') return true;
  if (!user.isAdmin || !user.id) return false;
  const codes = await effectivePermissionCodes(prisma, user.id, user.tenantId ?? null);
  return codes.has(code);
}

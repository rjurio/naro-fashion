/**
 * Build a Prisma `where` fragment that constrains a query to the calling
 * customer's own rows. Admins (tenant or platform) get an empty fragment so
 * they can read across customers within the tenant.
 *
 * Usage:
 *   where: { id, tenantId, ...ownerScope(user) }
 */
export function ownerScope(user: any): { userId?: string } {
  if (user?.isAdmin || user?.isPlatformAdmin) return {};
  return { userId: user?.id };
}

/** True for tenant admins and platform admins. */
export function isAdminUser(user: any): boolean {
  return Boolean(user?.isAdmin || user?.isPlatformAdmin);
}

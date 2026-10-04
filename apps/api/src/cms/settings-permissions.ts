import { isSensitiveSettingKey } from './cms.service';

/**
 * SiteSetting keys whose write needs `settings:manage` (not just
 * `cms:manage`): session lifetimes (`auth_*` — e.g.
 * auth_access_token_expires / auth_refresh_token_expires), secret-valued
 * keys (`*_secret`, `*_token`, api keys, passwords) and third-party
 * integration config (`instagram_*`, `facebook_*`).
 */
export function isPrivilegedSettingKey(key: string): boolean {
  if (!key) return true;
  const k = key.toLowerCase();
  return (
    k.startsWith('auth_') ||
    k.startsWith('instagram_') ||
    k.startsWith('facebook_') ||
    k.includes('session') ||
    isSensitiveSettingKey(k)
  );
}

interface PermissionLookupClient {
  adminUserRole: {
    findMany(args: any): Promise<any[]>;
  };
}

type RoleRow = { role: { permissions: Array<{ permission: { code: string } }> } };

/**
 * Same resolution + bypass rules as PermissionGuard (platform admins and
 * JWT role SUPER_ADMIN hold every permission), for in-handler checks that
 * depend on the request payload (here: which setting key is written).
 */
export async function adminHasPermission(
  prisma: PermissionLookupClient,
  user: any,
  code: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  if (user.role === 'SUPER_ADMIN') return true;
  if (!user.id) return false;
  const rows: RoleRow[] = await prisma.adminUserRole.findMany({
    where: { adminUserId: user.id },
    select: {
      role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
    },
  });
  return rows.some((r) => r.role.permissions.some((rp) => rp.permission.code === code));
}

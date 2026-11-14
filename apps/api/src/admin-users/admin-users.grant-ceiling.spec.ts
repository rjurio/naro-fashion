import { ForbiddenException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';

/**
 * Round 25F — grant ceiling. Below SUPER_ADMIN an admin may only hand out
 * permissions they hold, may not change their own role, and may not take
 * control of (edit / re-enable) an account holding permissions they don't.
 * Otherwise `admins:create` / `roles:manage` / `admins:update` would each be
 * a route to any permission: create an account with a stronger role (and a
 * password you chose), assign a stronger role to an account you control, or
 * reset the password of a stronger admin.
 */
describe('AdminUsersService — no permission beyond your own (create / assignRole / update / toggle)', () => {
  const TENANT = 't1';
  const MANAGER = { id: 'mgr', role: 'MANAGER' };
  const SUPER = { id: 'sup', role: 'SUPER_ADMIN' };
  const perms = (codes: string[]) => [{ role: { permissions: codes.map((code) => ({ permission: { code } })) } }];
  const grants = (codes: string[]) => codes.map((code) => ({ permission: { code } }));

  let prisma: any;
  let service: AdminUsersService;
  // effective codes per admin id; role grants per role id
  let held: Record<string, string[]>;
  let roleGrants: Record<string, string[]>;

  beforeEach(() => {
    held = { mgr: ['admins:create', 'admins:update', 'roles:manage', 'orders:view'], target: [] };
    roleGrants = { weak: ['orders:view'], strong: ['orders:view', 'inventory:manage'] };
    prisma = {
      adminUser: {
        findUnique: jest.fn(async () => ({ id: 'target', role: 'STAFF', isActive: false, tenantId: TENANT, email: 't@x.tz' })),
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id === 'mgr') return { id: 'mgr', role: 'MANAGER' };
          if (where.id === 'sup') return { id: 'sup', role: 'SUPER_ADMIN' };
          if (where.id === 'target') return { id: 'target', tenantId: TENANT };
          return null;
        }),
        update: jest.fn(async () => ({ id: 'target' })),
        create: jest.fn(async () => ({ id: 'new', email: 'n@x.tz', role: 'STAFF' })),
      },
      adminUserRole: {
        create: jest.fn(async () => ({})),
        delete: jest.fn(),
        findMany: jest.fn(async ({ where }: any) => perms(held[where.adminUserId] ?? [])),
      },
      rolePermission: { findMany: jest.fn(async ({ where }: any) => grants(roleGrants[where.roleId] ?? [])) },
      role: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, name: where.id === 'strong' ? 'Stock' : 'Clerk', isSystem: false, tenantId: TENANT })) },
    };
    service = new AdminUsersService(prisma, { requireId: TENANT, id: TENANT } as any);
  });

  const base = { firstName: 'A', lastName: 'B', email: 'n@x.tz', password: 'Passw0rdX' };
  const code = async (p: Promise<any>) => {
    const e: any = await p.catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    return e.getResponse().code;
  };

  it('create: a role holding a permission you lack → 403 BEYOND_OWN_PERMISSIONS, no account', async () => {
    expect(await code(service.create({ ...base, roleIds: ['strong'] }, 'mgr', MANAGER))).toBe('BEYOND_OWN_PERMISSIONS');
    expect(prisma.adminUser.create).not.toHaveBeenCalled();
  });
  it('create: a role within your own permissions → allowed', async () => {
    await service.create({ ...base, roleIds: ['weak'] }, 'mgr', MANAGER);
    expect(prisma.adminUser.create).toHaveBeenCalled();
  });
  it('assignRole: a stronger role to someone else → 403, nothing written; SUPER_ADMIN may', async () => {
    expect(await code(service.assignRole('target', 'strong', 'mgr', MANAGER))).toBe('BEYOND_OWN_PERMISSIONS');
    expect(prisma.adminUserRole.create).not.toHaveBeenCalled();
    await service.assignRole('target', 'strong', 'sup', SUPER);
    expect(prisma.adminUserRole.create).toHaveBeenCalled();
  });
  it('assignRole to yourself → 403 (any role)', async () => {
    await expect(service.assignRole('mgr', 'weak', 'mgr', MANAGER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adminUserRole.create).not.toHaveBeenCalled();
  });
  it('update: changing your own role string → 403 OWN_ROLE', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: 'mgr', role: 'MANAGER', tenantId: TENANT });
    expect(await code(service.update('mgr', { role: 'STAFF' }, MANAGER))).toBe('OWN_ROLE');
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
  });
  it('update: resetting the password of an admin who holds more than you → 403 TARGET_HAS_MORE_PERMISSIONS', async () => {
    held.target = ['inventory:manage'];
    expect(await code(service.update('target', { password: 'Passw0rdY' }, MANAGER))).toBe('TARGET_HAS_MORE_PERMISSIONS');
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
  });
  it('update: a weaker admin → allowed; SUPER_ADMIN edits anyone', async () => {
    held.target = ['orders:view'];
    await service.update('target', { firstName: 'Z' }, MANAGER);
    expect(prisma.adminUser.update).toHaveBeenCalledTimes(1);
    held.target = ['inventory:manage'];
    await service.update('target', { password: 'Passw0rdY' }, SUPER);
    expect(prisma.adminUser.update).toHaveBeenCalledTimes(2);
  });
  it('toggle: re-enabling an admin who holds more than you → 403', async () => {
    held.target = ['inventory:manage'];
    expect(await code(service.toggle('target', 'mgr', MANAGER))).toBe('TARGET_HAS_MORE_PERMISSIONS');
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
  });
});

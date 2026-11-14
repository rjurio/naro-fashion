import { MANAGER_EXCLUDED, STAFF_CODES, SystemRolesSeeder } from '../roles/system-roles.seeder';
import { MANAGER_DEFAULT_GRANTS, PermissionsService } from '../permissions/permissions.service';

// Owner control (round 25F E): no NEW permission reaches an existing account.
// inventory:approve is created as a permission row only; no seeder attaches
// it to an existing MANAGER / STAFF / SUPER_ADMIN role. SUPER_ADMIN accounts
// hold it implicitly through PermissionGuard's bypass — but the service-level
// "different person" rule has no role exception, so with ONE SUPER_ADMIN and
// nobody granted the code, a SUPER_ADMIN's own write-off can never be applied
// (fail safe: it waits in the queue).
describe('inventory:approve is never granted automatically', () => {
  it('excluded from MANAGER on fresh installs, not a STAFF code, not a MANAGER default grant', () => {
    expect(MANAGER_EXCLUDED).toContain('inventory:approve');
    expect(STAFF_CODES).not.toContain('inventory:approve');
    expect(MANAGER_DEFAULT_GRANTS).not.toContain('inventory:approve');
  });

  it('SystemRolesSeeder.seed() writes no grant when the system roles already exist (every live database)', async () => {
    const prisma: any = {
      permission: { findMany: jest.fn(async () => [{ id: 'perm-approve', code: 'inventory:approve' }, { id: 'perm-view', code: 'inventory:view' }]) },
      role: { findFirst: jest.fn(async () => ({ id: 'existing-role' })), create: jest.fn() },
      rolePermission: { createMany: jest.fn() },
    };
    await new SystemRolesSeeder(prisma).seed();
    expect(prisma.role.create).not.toHaveBeenCalled();
    expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('PermissionsService.seedManagerDefaults() never asks for inventory:approve', async () => {
    const prisma: any = {
      role: { findFirst: jest.fn(async () => ({ id: 'manager' })) },
      permission: { findMany: jest.fn(async () => [{ id: 'p1' }]) },
      rolePermission: { createMany: jest.fn(async () => ({ count: 1 })) },
    };
    await new PermissionsService(prisma).seedManagerDefaults();
    const asked: string[] = prisma.permission.findMany.mock.calls[0][0].where.code.in;
    expect(asked).not.toContain('inventory:approve');
    expect(asked).not.toContain('payments:reverse');
  });
});

import { ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { PermissionsService, MANAGER_DEFAULT_GRANTS } from '../permissions/permissions.service';

/** October 2026 review — shared system roles are not tenant-editable; seeding is unambiguous. */
describe('RolesService — system role protection', () => {
  let prisma: any;
  let tenantContext: any;
  let service: RolesService;

  beforeEach(() => {
    prisma = {
      role: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    };
    tenantContext = { requireId: 't1', id: 't1', isPlatformAdmin: false };
    service = new RolesService(prisma, tenantContext, { log: jest.fn() } as any);
  });

  it('a tenant admin cannot edit a shared system role (even the description)', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'r-mgr', name: 'MANAGER', isSystem: true, tenantId: null });
    await expect(service.update('r-mgr', { description: 'pwned' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('a tenant admin can still edit its own custom role', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'r1', name: 'Cashier', isSystem: false, tenantId: 't1' });
    prisma.role.update.mockResolvedValue({ id: 'r1' });
    await expect(service.update('r1', { description: 'ok' } as any)).resolves.toEqual({ id: 'r1' });
  });

  it('reserved system role names cannot be used for custom roles', async () => {
    await expect(service.create({ name: 'super_admin' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });
});

describe('PermissionsService — MANAGER default grants', () => {
  it('grants the default codes to the system MANAGER role idempotently', async () => {
    const prisma: any = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'r-mgr' }) },
      permission: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]) },
      rolePermission: { createMany: jest.fn() },
    };
    await new PermissionsService(prisma).seedManagerDefaults();
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'MANAGER', isSystem: true, tenantId: null } }),
    );
    expect(prisma.permission.findMany.mock.calls[0][0].where.code.in).toEqual(MANAGER_DEFAULT_GRANTS);
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'r-mgr', permissionId: 'p1' }, { roleId: 'r-mgr', permissionId: 'p2' }],
      skipDuplicates: true,
    });
  });

  it('never grants the SUPER_ADMIN-only codes to MANAGER', () => {
    for (const code of ['payment-methods:manage', 'payments:manage', 'recycle-bin:purge', 'settings:manage']) {
      expect(MANAGER_DEFAULT_GRANTS).not.toContain(code);
    }
  });
});

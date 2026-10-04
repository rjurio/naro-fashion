import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';

/**
 * October 2026 review — privilege-escalation guards on AdminUsersService:
 *  (a) roleId(s) from another tenant are rejected on create
 *  (b) SUPER_ADMIN (role string or system role) can only be granted by a
 *      SUPER_ADMIN / platform admin — on create, update and assignRole
 *  plus: soft-deleted roles are not assignable, update() whitelists fields
 *  and hashes passwords.
 */
describe('AdminUsersService — escalation guards', () => {
  const TENANT = 't1';
  let prisma: any;
  let service: AdminUsersService;

  const MANAGER_ACTOR = { id: 'mgr', role: 'MANAGER' };
  const SUPER_ACTOR = { id: 'sup', role: 'SUPER_ADMIN' };

  beforeEach(() => {
    prisma = {
      adminUser: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'x' }),
        create: jest.fn().mockResolvedValue({ id: 'new', email: 'n@x.tz', role: 'STAFF' }),
      },
      adminUserRole: { create: jest.fn().mockResolvedValue({}), delete: jest.fn() },
      role: { findFirst: jest.fn() },
    };
    // isSuperActor reads the performer row; return role by id.
    prisma.adminUser.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 'mgr') return { id: 'mgr', role: 'MANAGER' };
      if (where.id === 'sup') return { id: 'sup', role: 'SUPER_ADMIN' };
      if (where.id === 'target') return { id: 'target', tenantId: TENANT };
      return null;
    });
    service = new AdminUsersService(prisma, { requireId: TENANT, id: TENANT } as any);
  });

  const base = { firstName: 'A', lastName: 'B', email: 'n@x.tz' };

  describe('create()', () => {
    it('MANAGER cannot create a SUPER_ADMIN by role string', async () => {
      await expect(service.create({ ...base, role: 'SUPER_ADMIN' }, 'mgr', MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUser.create).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN can create a SUPER_ADMIN', async () => {
      await expect(service.create({ ...base, role: 'SUPER_ADMIN' }, 'sup', SUPER_ACTOR)).resolves.toBeDefined();
    });

    it('platform admin can create a SUPER_ADMIN without a DB lookup', async () => {
      await service.create({ ...base, role: 'SUPER_ADMIN' }, 'p1', { id: 'p1', isPlatformAdmin: true });
      expect(prisma.adminUser.create).toHaveBeenCalled();
    });

    it('rejects a roleId that belongs to another tenant (lookup is tenant-or-system, not deleted)', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...base, roleId: 'foreign-role' }, 'sup', SUPER_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      const where = prisma.role.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ id: 'foreign-role', deletedAt: null, OR: [{ tenantId: TENANT }, { tenantId: null, isSystem: true }] });
      expect(prisma.adminUser.create).not.toHaveBeenCalled();
    });

    it('MANAGER cannot attach the SUPER_ADMIN system role via roleIds', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r-super', name: 'SUPER_ADMIN', isSystem: true, tenantId: null });
      await expect(service.create({ ...base, roleIds: ['r-super'] }, 'mgr', MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUser.create).not.toHaveBeenCalled();
    });

    it('creates with every validated role and no temp password when one is supplied', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r1', name: 'Cashier', isSystem: false, tenantId: TENANT });
      const res: any = await service.create({ ...base, roleIds: ['r1'], roleId: 'r1', password: 'Passw0rdX' }, 'mgr', MANAGER_ACTOR);
      const data = prisma.adminUser.create.mock.calls[0][0].data;
      expect(data.roles.create).toEqual([{ roleId: 'r1', assignedBy: 'mgr' }]);
      expect(res.temporaryPassword).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('MANAGER cannot promote someone to SUPER_ADMIN', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'target', role: 'STAFF', tenantId: TENANT });
      await expect(service.update('target', { role: 'SUPER_ADMIN' }, MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('MANAGER cannot edit a SUPER_ADMIN account (email/password takeover)', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'target', role: 'SUPER_ADMIN', tenantId: TENANT });
      await expect(service.update('target', { email: 'evil@x.tz' }, MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('whitelists fields and hashes a new password + revokes sessions', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'target', role: 'STAFF', tenantId: TENANT });
      await service.update('target', { firstName: 'Z', password: 'Passw0rdX', isActive: true } as any, MANAGER_ACTOR);
      const data = prisma.adminUser.update.mock.calls[0][0].data;
      expect(data.firstName).toBe('Z');
      expect(data.password).toBeUndefined();
      expect(data.isActive).toBeUndefined();
      expect(typeof data.passwordHash).toBe('string');
      expect(data.passwordHash).not.toBe('Passw0rdX');
      expect(data.tokenVersion).toEqual({ increment: 1 });
    });
  });

  describe('assignRole()', () => {
    it('MANAGER cannot assign the SUPER_ADMIN system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r-super', name: 'SUPER_ADMIN', isSystem: true, tenantId: null });
      await expect(service.assignRole('target', 'r-super', 'mgr', MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUserRole.create).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN can assign the SUPER_ADMIN system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r-super', name: 'SUPER_ADMIN', isSystem: true, tenantId: null });
      await service.assignRole('target', 'r-super', 'sup', SUPER_ACTOR);
      expect(prisma.adminUserRole.create).toHaveBeenCalled();
    });

    it('soft-deleted roles are not assignable (deletedAt: null in lookup)', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.assignRole('target', 'r-del', 'sup', SUPER_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.findFirst.mock.calls[0][0].where.deletedAt).toBeNull();
    });

    it('non-string roleId (operator object) never reaches Prisma', async () => {
      await expect(service.assignRole('target', { not: '' } as any, 'sup', SUPER_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('toggle()', () => {
    it('MANAGER cannot disable a SUPER_ADMIN', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'target', role: 'SUPER_ADMIN', isActive: true, tenantId: TENANT });
      await expect(service.toggle('target', 'mgr', MANAGER_ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

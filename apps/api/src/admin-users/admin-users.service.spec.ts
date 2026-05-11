import { ForbiddenException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';

/**
 * Regression coverage for the self-modification guards on AdminUsersService.
 *
 * Background — 2026-05-11. Smoke testing the Step C role-assignment UI
 * surfaced that POST /admin-users/:id/roles returned 201 (not 403) when an
 * admin POSTed against their own id. Root cause: the controller passed
 * `req.user.sub` as `performedById`, but `JwtStrategy.validate()` returns
 * `{ id, ... }` — the AdminUser row — and never preserves the JWT payload's
 * `sub` field on the validated user. `req.user.sub` was always undefined,
 * so the service-layer check `if (id === performedById)` reduced to
 * `if (X === undefined)` which is always false. Every self-modification
 * guard in this service silently failed open, and every row in
 * AdminUserRole/AdminActivityLog wrote `assignedBy: null` / `createdBy: null`.
 *
 * The controller now uses `@CurrentUser('id')` which extracts `req.user.id`.
 * The service-layer check is the defence in depth. These tests pin the
 * contract: when `targetId === performedById`, we throw before touching the
 * DB.
 */
describe('AdminUsersService — self-modification guards', () => {
  let service: AdminUsersService;
  let prisma: {
    adminUser: { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    adminUserRole: { create: jest.Mock; delete: jest.Mock };
    role: { findFirst: jest.Mock };
  };
  let tenantContext: { requireId: string; id: string };

  const TENANT_ID = 'tenant-1';
  const ADMIN_ID = 'admin-self';
  const OTHER_ROLE_ID = 'role-1';

  beforeEach(() => {
    prisma = {
      adminUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      adminUserRole: { create: jest.fn(), delete: jest.fn() },
      role: { findFirst: jest.fn() },
    };
    tenantContext = { requireId: TENANT_ID, id: TENANT_ID };
    // Same minimal-dep pattern as the AI service specs in this package —
    // no Nest TestingModule (we don't pull in @nestjs/testing).
    service = new AdminUsersService(prisma as any, tenantContext as any);
  });

  describe('remove()', () => {
    it('throws ForbiddenException when the admin tries to delete their own account', async () => {
      await expect(service.remove(ADMIN_ID, ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT touch Prisma when blocking self-delete', async () => {
      // Defence in depth — the check must fire before any DB read so an
      // attacker cannot rely on the user being unresolvable as a side channel.
      await expect(service.remove(ADMIN_ID, ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
      expect(prisma.adminUser.update).not.toHaveBeenCalled();
    });
  });

  describe('toggle()', () => {
    it('throws ForbiddenException when the admin tries to disable their own account', async () => {
      await expect(service.toggle(ADMIN_ID, ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT touch Prisma when blocking self-toggle', async () => {
      await expect(service.toggle(ADMIN_ID, ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
      expect(prisma.adminUser.update).not.toHaveBeenCalled();
    });
  });

  describe('assignRole()', () => {
    it('throws ForbiddenException when the admin tries to assign a role to themselves', async () => {
      await expect(
        service.assignRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT look up the role or write to AdminUserRole when blocking self-assign', async () => {
      await expect(
        service.assignRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.findFirst).not.toHaveBeenCalled();
      expect(prisma.adminUserRole.create).not.toHaveBeenCalled();
    });

    it('error message names the rule so the operator understands the rejection', async () => {
      await expect(
        service.assignRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toThrow(/cannot change your own roles/i);
    });
  });

  describe('removeRole()', () => {
    it('throws ForbiddenException when the admin tries to remove a role from themselves', async () => {
      await expect(
        service.removeRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does NOT delete from AdminUserRole when blocking self-remove', async () => {
      await expect(
        service.removeRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.adminUserRole.delete).not.toHaveBeenCalled();
    });

    it('error message names the rule so the operator understands the rejection', async () => {
      await expect(
        service.removeRole(ADMIN_ID, OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toThrow(/cannot change your own roles/i);
    });
  });

  describe('Symmetry — different ids still proceed past the self-check', () => {
    it('assignRole proceeds to role lookup when performer and target differ', async () => {
      // Prove the guard is bound to equality, not blanket-blocking everything.
      // The role lookup returns null so the call rejects with NotFound — fine.
      // The important assertion is that prisma.role.findFirst WAS called,
      // meaning we got past the self-check.
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(
        service.assignRole('target-different', OTHER_ROLE_ID, ADMIN_ID),
      ).rejects.toThrow(/role not found/i);
      expect(prisma.role.findFirst).toHaveBeenCalledTimes(1);
    });

    it('removeRole proceeds to the delete when performer and target differ', async () => {
      prisma.adminUserRole.delete.mockResolvedValue({});
      await expect(
        service.removeRole('target-different', OTHER_ROLE_ID, ADMIN_ID),
      ).resolves.toEqual({ message: 'Role removed' });
      expect(prisma.adminUserRole.delete).toHaveBeenCalledTimes(1);
    });
  });
});

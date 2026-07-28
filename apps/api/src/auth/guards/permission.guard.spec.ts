import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';

function makeCtx(user: any): any {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
}

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { adminUserRole: { findMany: jest.Mock } };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { adminUserRole: { findMany: jest.fn() } };
    guard = new PermissionGuard(reflector as any, prisma as any);
  });

  it('allows routes with no @RequiresPermission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(
      guard.canActivate(makeCtx({ id: 'x', role: 'STAFF' })),
    ).resolves.toBe(true);
    expect(prisma.adminUserRole.findMany).not.toHaveBeenCalled();
  });

  it('bypasses for SUPER_ADMIN (by JWT role string) without a DB lookup', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:create']);
    await expect(
      guard.canActivate(makeCtx({ id: 'x', role: 'SUPER_ADMIN' })),
    ).resolves.toBe(true);
    expect(prisma.adminUserRole.findMany).not.toHaveBeenCalled();
  });

  it('bypasses for platform admins', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:create']);
    await expect(
      guard.canActivate(makeCtx({ id: 'x', isPlatformAdmin: true })),
    ).resolves.toBe(true);
  });

  it('BLOCKS a STAFF admin lacking the required permission (the escalation fix)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:create']);
    prisma.adminUserRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: { code: 'products:view' } }] } },
    ]);
    await expect(
      guard.canActivate(makeCtx({ id: 'staff', role: 'STAFF' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a non-super admin whose role grants the permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:create']);
    prisma.adminUserRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: { code: 'admins:create' } }] } },
    ]);
    await expect(
      guard.canActivate(makeCtx({ id: 'mgr', role: 'MANAGER' })),
    ).resolves.toBe(true);
  });

  it('uses OR semantics across multiple required codes', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles:manage', 'admins:update']);
    prisma.adminUserRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: { code: 'admins:update' } }] } },
    ]);
    await expect(
      guard.canActivate(makeCtx({ id: 'u', role: 'MANAGER' })),
    ).resolves.toBe(true);
  });

  it('caches resolution per admin (second call issues no DB query)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:view']);
    prisma.adminUserRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: { code: 'admins:view' } }] } },
    ]);
    await guard.canActivate(makeCtx({ id: 'u1', role: 'STAFF' }));
    await guard.canActivate(makeCtx({ id: 'u1', role: 'STAFF' }));
    expect(prisma.adminUserRole.findMany).toHaveBeenCalledTimes(1);
  });

  it('throws when the request is unauthenticated', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admins:view']);
    await expect(
      guard.canActivate(makeCtx(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

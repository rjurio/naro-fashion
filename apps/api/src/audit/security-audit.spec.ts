import * as bcryptNs from 'bcryptjs';
import { ForbiddenException } from '@nestjs/common';
import { AuthService, GENERIC_LOGIN_ERROR } from '../auth/auth.service';
import { AdminUsersService } from '../admin-users/admin-users.service';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ADMIN_ACCOUNT_FAILURE_LIMIT } from '../auth/util/admin-lockout';
import {
  LOCKOUT_REPEAT_WINDOW_MS,
  LOCKOUT_WARN_INTERVAL_MS,
  LockoutAlerts,
  accountRef,
  lockoutAlerts,
  recordSecurityEvent,
  scrubSecrets,
} from './security-audit';

/**
 * P0d audit and alert additions (owner-approved 2026-11-12, local only):
 * admin create / role changes / status / delete, lockouts, unlocks and
 * password-reset request + completion are audited with actor, affected
 * account, time and result, including refused and failed attempts; repeated
 * lockouts raise a throttled warning. Authorisation is unchanged.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt: typeof bcryptNs = require('bcryptjs');

const rows = (create: jest.Mock) => create.mock.calls.map((c) => c[0].data);
const NO_SECRETS = /Correct1pass|NewPassw0rd|\$2[aby]\$|reset-token|[a-f0-9]{64}/;

describe('recordSecurityEvent', () => {
  it('attaches the row to the acting admin and records actor, target, result and time-stamped row', async () => {
    const create = jest.fn();
    await recordSecurityEvent({ adminActivityLog: { create } }, {
      action: 'ADMIN_UNLOCK', result: 'SUCCESS', tenantId: 't1',
      actor: { type: 'admin', id: 'boss', role: 'SUPER_ADMIN' }, targetAdminId: 'a1', ipAddress: '10.0.0.5',
    });
    expect(rows(create)[0]).toMatchObject({
      tenantId: 't1', adminUserId: 'boss', action: 'ADMIN_UNLOCK', entity: 'AdminUser', entityId: 'a1', ipAddress: '10.0.0.5',
      details: { result: 'SUCCESS', actor: { type: 'admin', id: 'boss', role: 'SUPER_ADMIN' }, target: { type: 'AdminUser', id: 'a1' } },
    });
    // createdAt is the DB default (now()), so every row is time-stamped
    expect(rows(create)[0].createdAt).toBeUndefined();
  });

  it('a platform or system actor is kept in details; the row is attached to the affected admin', async () => {
    const create = jest.fn();
    await recordSecurityEvent({ adminActivityLog: { create } }, {
      action: 'ADMIN_UNLOCK', result: 'SUCCESS', actor: { type: 'platform', id: 'p1' }, targetAdminId: 'a1',
    });
    expect(rows(create)[0]).toMatchObject({ adminUserId: 'a1', details: { actor: { type: 'platform', id: 'p1' } } });
  });

  it('with no AdminUser on either side nothing is written to the table (application log only)', async () => {
    const create = jest.fn();
    await recordSecurityEvent({ adminActivityLog: { create } }, {
      action: 'ADMIN_ACCOUNT_LOCKED', result: 'BLOCKED', actor: { type: 'system' }, targetType: 'PlatformAdmin', targetId: 'p1',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('drops secret-looking keys and never throws when the write fails', async () => {
    expect(scrubSecrets({ password: 'x', resetToken: 'y', twoFASecret: 'z', recoveryCodes: [1], passwordHash: 'h', role: 'STAFF' })).toEqual({ role: 'STAFF' });
    await expect(recordSecurityEvent({ adminActivityLog: { create: jest.fn().mockRejectedValue(new Error('db down')) } }, {
      action: 'X', result: 'SUCCESS', actor: { type: 'admin', id: 'a' },
    })).resolves.toBeUndefined();
    await expect(recordSecurityEvent({} as any, { action: 'X', result: 'SUCCESS', actor: { type: 'admin', id: 'a' } })).resolves.toBeUndefined();
  });
});

describe('LockoutAlerts (throttled operator warnings)', () => {
  it('one warning per account per 30 min; 3 locks in 24 h say REPEATED_ADMIN_LOCKOUTS; no email in the line', () => {
    const lines: string[] = [];
    const a = new LockoutAlerts((l) => lines.push(l));
    const t0 = 1_000_000;
    expect(a.onLock('admin', 'a1', { distinctIps: 12, tenantId: 't1' }, t0)).toMatch(/ADMIN_ACCOUNT_LOCKED .*distinctIps=12 locks24h=1/);
    expect(a.onLock('admin', 'a1', {}, t0 + 60_000)).toBeNull(); // throttled
    expect(a.onLock('admin', 'a1', {}, t0 + LOCKOUT_WARN_INTERVAL_MS + 1)).toMatch(/REPEATED_ADMIN_LOCKOUTS .*locks24h=3/);
    expect(a.onLock('admin', 'other', {}, t0 + 2)).toMatch(/ADMIN_ACCOUNT_LOCKED/); // per account
    expect(a.onLock('admin', 'a1', {}, t0 + LOCKOUT_REPEAT_WINDOW_MS + LOCKOUT_WARN_INTERVAL_MS * 2)).toMatch(/ADMIN_ACCOUNT_LOCKED .*locks24h=1/);
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).not.toMatch(/@/);
    expect(lines[0]).toContain(`account=${accountRef('admin', 'a1')}`);
  });
});

// ---------------------------------------------------------------- AuthService
function authWorld() {
  const admin: any = { id: 'a1', email: 'owner@naro.tz', tenantId: 't1', isActive: true, deletedAt: null, role: 'SUPER_ADMIN', is2FAEnabled: true, twoFASecret: null, failedLoginAttempts: 0, lockedUntil: null, tokenVersion: 0, passwordResetToken: null, passwordResetExpires: null };
  const attempts: any[] = [];
  const delegate = {
    findUnique: jest.fn(async () => ({ ...admin })),
    findFirst: jest.fn(async () => ({ ...admin })),
    update: jest.fn(async ({ data, select }: any) => {
      if (data.failedLoginAttempts?.increment) admin.failedLoginAttempts += 1;
      else if (data.failedLoginAttempts === 0) admin.failedLoginAttempts = 0;
      if ('lockedUntil' in data) admin.lockedUntil = data.lockedUntil;
      if ('passwordResetToken' in data) admin.passwordResetToken = data.passwordResetToken;
      return select ? { failedLoginAttempts: admin.failedLoginAttempts } : { ...admin };
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
  };
  const create = jest.fn();
  const prisma: any = {
    adminUser: delegate,
    platformAdmin: { findUnique: jest.fn(async () => null) },
    user: { findFirst: jest.fn(async () => null) },
    loginAttempt: {
      create: jest.fn(async ({ data }: any) => { attempts.push({ ...data, attemptedAt: new Date() }); }),
      count: jest.fn(async ({ where }: any) => attempts.filter((a) => a.ipAddress === where.ipAddress && !a.success).length),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => [...new Set(attempts.filter((a) => !a.success).map((a) => a.ipAddress))].map((ipAddress) => ({ ipAddress }))),
    },
    adminActivityLog: { create },
  };
  const svc = new AuthService(prisma, { sign: jest.fn(), verify: jest.fn() } as any, { get: (_k: string, d?: any) => d } as any, { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) } as any);
  return { svc, prisma, admin, create };
}

describe('AuthService: lockout and password-reset audit', () => {
  let hash: string;
  beforeAll(async () => { hash = await bcrypt.hash('Correct1pass', 4); });

  it('the 10th wrong password records ADMIN_ACCOUNT_LOCKED (actor system, distinct IPs) once, with no secrets', async () => {
    const w = authWorld();
    w.admin.passwordHash = hash;
    const warn = jest.spyOn((lockoutAlerts as any), 'warn').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) {
        await w.svc.validateUser(w.admin.email, `wrong-${i}`, null, { ipAddress: `203.0.113.${i}` } as any);
      }
      await expect(w.svc.validateUser(w.admin.email, 'Correct1pass', null, { ipAddress: '198.51.100.1' } as any)).rejects.toThrow(GENERIC_LOGIN_ERROR);
      const locks = rows(w.create).filter((r) => r.action === 'ADMIN_ACCOUNT_LOCKED');
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatchObject({
        adminUserId: 'a1', entityId: 'a1', tenantId: 't1', ipAddress: '203.0.113.9',
        details: { result: 'BLOCKED', actor: { type: 'system' }, distinctIps: 10, step: 'password', lockMinutes: 30 },
      });
      expect(JSON.stringify(locks)).not.toMatch(NO_SECRETS);
      expect(JSON.stringify(locks)).not.toContain('owner@naro.tz');
    } finally {
      warn.mockRestore();
    }
  });

  it('password reset: the request and the completion are audited without the token or the password', async () => {
    const w = authWorld();
    await w.svc.forgotPassword('owner@naro.tz', undefined, { ipAddress: '10.0.0.5' });
    const req = rows(w.create).find((r) => r.action === 'PASSWORD_RESET_REQUESTED');
    expect(req).toMatchObject({ adminUserId: 'a1', ipAddress: '10.0.0.5', details: { result: 'SUCCESS', actor: { type: 'anonymous' } } });
    const storedHash = w.admin.passwordResetToken as string;
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    await w.svc.resetPassword('reset-token-from-email', 'NewPassw0rd!', { ipAddress: '10.0.0.6' });
    const done = rows(w.create).find((r) => r.action === 'PASSWORD_RESET_COMPLETED');
    expect(done).toMatchObject({ adminUserId: 'a1', ipAddress: '10.0.0.6', details: { result: 'SUCCESS', sessionsRevoked: true, twoFactorStillRequired: true } });
    const all = JSON.stringify(rows(w.create));
    expect(all).not.toContain(storedHash);
    expect(all).not.toMatch(NO_SECRETS);
  });

  it('an unknown email still gets the generic answer and writes no audit row', async () => {
    const w = authWorld();
    w.prisma.adminUser.findUnique = jest.fn(async () => null);
    await expect(w.svc.forgotPassword('nobody@x.tz', undefined, { ipAddress: '1.1.1.1' })).resolves.toEqual({ message: expect.stringMatching(/If this email exists/) });
    expect(w.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- AdminUsersService
function adminsWorld(actorRole = 'SUPER_ADMIN') {
  const people: Record<string, any> = {
    boss: { id: 'boss', email: 'boss@naro.tz', tenantId: 't1', role: actorRole, isActive: true, deletedAt: null, lockedUntil: null, failedLoginAttempts: 0 },
    a1: { id: 'a1', email: 'a1@naro.tz', tenantId: 't1', role: 'STAFF', isActive: true, deletedAt: null, lockedUntil: new Date(Date.now() + 600_000), failedLoginAttempts: 10 },
    foreign: { id: 'foreign', email: 'f@other.tz', tenantId: 't2', role: 'STAFF', isActive: true, deletedAt: null },
  };
  const find = async ({ where }: any) => {
    const p = people[where.id];
    if (!p || (where.tenantId && p.tenantId !== where.tenantId)) return null;
    if (where.deletedAt === null && p.deletedAt) return null;
    return { ...p };
  };
  const create = jest.fn();
  const prisma: any = {
    adminUser: {
      findUnique: jest.fn(find),
      findFirst: jest.fn(async (args: any) => (args.where.email ? null : find(args))),
      create: jest.fn(async ({ data }: any) => ({ id: 'new1', email: data.email, firstName: data.firstName, lastName: data.lastName, role: data.role })),
      update: jest.fn(async ({ where, data }: any) => ({ ...people[where.id], ...data, id: where.id })),
    },
    role: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'r-super' ? { id: 'r-super', name: 'SUPER_ADMIN' } : where.id === 'r-staff' ? { id: 'r-staff', name: 'STAFF' } : null)) },
    adminUserRole: { create: jest.fn(async ({ data }: any) => data), delete: jest.fn(async () => ({})) },
    adminActivityLog: { create },
  };
  const svc = new AdminUsersService(prisma, { requireId: 't1', id: 't1' } as any, { ip: '10.0.0.9' });
  const boss = { id: 'boss', role: actorRole };
  return { svc, prisma, create, boss };
}

describe('AdminUsersService: every admin-account change is audited (success, denied, failed)', () => {
  it('create: SUCCESS row for the actor with the new account, role and no password', async () => {
    const w = adminsWorld();
    const r: any = await w.svc.create({ email: 'n@naro.tz', firstName: 'N', lastName: 'W', role: 'STAFF' } as any, 'boss', w.boss);
    const row = rows(w.create)[0];
    expect(row).toMatchObject({ action: 'ADMIN_CREATE', adminUserId: 'boss', entityId: 'new1', ipAddress: '10.0.0.9', tenantId: 't1', details: { result: 'SUCCESS', role: 'STAFF', temporaryLoginIssued: true } });
    expect(JSON.stringify(row)).not.toContain(r.temporaryPassword);
  });

  it('create SUPER_ADMIN by a non-super admin is still refused and recorded as DENIED', async () => {
    const w = adminsWorld('MANAGER');
    await expect(w.svc.create({ email: 'x@naro.tz', firstName: 'X', lastName: 'Y', role: 'SUPER_ADMIN' } as any, 'boss', w.boss)).rejects.toBeInstanceOf(ForbiddenException);
    expect(w.prisma.adminUser.create).not.toHaveBeenCalled();
    expect(rows(w.create)[0]).toMatchObject({ action: 'ADMIN_CREATE', adminUserId: 'boss', details: { result: 'DENIED', requestedRole: 'SUPER_ADMIN', reason: 'Only SUPER_ADMIN can create a SUPER_ADMIN account' } });
  });

  it('role change via update: ADMIN_ROLE_CHANGE with from/to; a password set lists the field but never the value', async () => {
    const w = adminsWorld();
    await w.svc.update('a1', { role: 'MANAGER', password: 'NewPassw0rd!' } as any, w.boss);
    const row = rows(w.create)[0];
    expect(row).toMatchObject({ action: 'ADMIN_ROLE_CHANGE', adminUserId: 'boss', entityId: 'a1', details: { result: 'SUCCESS', roleFrom: 'STAFF', roleTo: 'MANAGER', changedFields: ['role', 'password'] } });
    expect(JSON.stringify(row)).not.toMatch(NO_SECRETS);
  });

  it('assign / remove role: SUCCESS rows; changing your own roles is DENIED and recorded', async () => {
    const w = adminsWorld();
    await w.svc.assignRole('a1', 'r-staff', 'boss', w.boss);
    await w.svc.removeRole('a1', 'r-staff', 'boss', w.boss);
    await expect(w.svc.assignRole('boss', 'r-staff', 'boss', w.boss)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows(w.create).map((r) => [r.action, r.details.result, r.entityId])).toEqual([
      ['ADMIN_ROLE_ASSIGN', 'SUCCESS', 'a1'],
      ['ADMIN_ROLE_REMOVE', 'SUCCESS', 'a1'],
      ['ADMIN_ROLE_ASSIGN', 'DENIED', 'boss'],
    ]);
  });

  it('granting SUPER_ADMIN by a non-super admin: refused, DENIED row, nothing assigned', async () => {
    const w = adminsWorld('MANAGER');
    await expect(w.svc.assignRole('a1', 'r-super', 'boss', w.boss)).rejects.toBeInstanceOf(ForbiddenException);
    expect(w.prisma.adminUserRole.create).not.toHaveBeenCalled();
    expect(rows(w.create)[0]).toMatchObject({ action: 'ADMIN_ROLE_ASSIGN', details: { result: 'DENIED', roleId: 'r-super' } });
  });

  it('another tenant’s admin id: 404 as before, FAILED row attached to the actor only (never to the foreign account)', async () => {
    const w = adminsWorld();
    await expect(w.svc.unlock('foreign', w.boss)).rejects.toThrow('Admin user not found');
    expect(rows(w.create)[0]).toMatchObject({ action: 'ADMIN_UNLOCK', adminUserId: 'boss', entityId: 'foreign', details: { result: 'FAILED', reason: 'Admin user not found', target: { type: 'AdminUser', id: 'foreign' } } });
  });

  it('a platform admin acting on an id outside this tenant: refused, and no row is attached to that foreign account', async () => {
    const w = adminsWorld();
    await expect(w.svc.unlock('foreign', { id: 'p1', isPlatformAdmin: true })).rejects.toThrow('Admin user not found');
    // no AdminUser on either side -> application log only, never adminUserId = 'foreign'
    expect(rows(w.create).filter((r) => r.adminUserId === 'foreign')).toHaveLength(0);
    expect(w.create).not.toHaveBeenCalled();
  });

  it('unlock: SUCCESS with the previous state; a platform admin’s unlock is attached to the target with actor platform', async () => {
    const w = adminsWorld();
    await w.svc.unlock('a1', w.boss);
    await w.svc.unlock('a1', { id: 'p1', isPlatformAdmin: true });
    const [byAdmin, byPlatform] = rows(w.create);
    expect(byAdmin).toMatchObject({ action: 'ADMIN_UNLOCK', adminUserId: 'boss', entityId: 'a1', details: { result: 'SUCCESS', wasLocked: true, previousFailedAttempts: 10, perNetworkBlocksCleared: true } });
    expect(byPlatform).toMatchObject({ action: 'ADMIN_UNLOCK', adminUserId: 'a1', details: { actor: { type: 'platform', id: 'p1' } } });
  });

  it('disabling or deleting your own account: refused as before and recorded', async () => {
    const w = adminsWorld();
    await expect(w.svc.toggle('boss', 'boss', w.boss)).rejects.toBeInstanceOf(ForbiddenException);
    await w.svc.toggle('a1', 'boss', w.boss);
    await expect(w.svc.remove('boss', 'boss', w.boss)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows(w.create).map((r) => [r.action, r.details.result])).toEqual([
      ['ADMIN_STATUS_CHANGE', 'DENIED'],
      ['ADMIN_STATUS_CHANGE', 'SUCCESS'],
      ['ADMIN_DELETE', 'DENIED'],
    ]);
  });
});

// ---------------------------------------------------------------- PermissionGuard
describe('PermissionGuard: a refused privileged action is recorded (throttled), authorisation unchanged', () => {
  const ctx = (user: any, path = '/admin-users/:id/unlock') => ({
    getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'PATCH', route: { path }, params: { id: 'a1' }, ip: '10.0.0.7' }) }),
  }) as any;
  const make = () => {
    const create = jest.fn();
    const prisma: any = { adminUserRole: { findMany: jest.fn(async () => []) }, adminActivityLog: { create } };
    const guard = new PermissionGuard({ getAllAndOverride: () => ['admins:unlock'] } as any, prisma);
    return { guard, create };
  };

  it('a STAFF admin without the permission is refused (403) and one PERMISSION_DENIED row per route per minute is written', async () => {
    const { guard, create } = make();
    const staff = { id: 's1', isAdmin: true, role: 'STAFF', tenantId: 't1' };
    for (let i = 0; i < 5; i++) await expect(guard.canActivate(ctx(staff))).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows(create)).toHaveLength(1);
    expect(rows(create)[0]).toMatchObject({ action: 'PERMISSION_DENIED', adminUserId: 's1', entity: 'Route', entityId: 'PATCH /admin-users/:id/unlock', ipAddress: '10.0.0.7', details: { result: 'DENIED', required: ['admins:unlock'], targetAdminId: 'a1' } });
    await expect(guard.canActivate(ctx(staff, '/admin-users'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows(create)).toHaveLength(2); // a different route is recorded separately
  });

  it('SUPER_ADMIN and platform admins still pass without a row', async () => {
    const { guard, create } = make();
    await expect(guard.canActivate(ctx({ id: 'b', isAdmin: true, role: 'SUPER_ADMIN' }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ id: 'p', isPlatformAdmin: true }))).resolves.toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

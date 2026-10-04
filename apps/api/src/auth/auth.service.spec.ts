import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  AuthService,
  GENERIC_LOGIN_ERROR,
  SUSPENDED_ACCOUNT_ERROR,
  TWO_FA_USE_NEW_ENDPOINTS_ERROR,
  isCredentialShapeValid,
  toPublicPrincipal,
} from './auth.service';
import { isTokenTypeAllowed, isTokenVersionCurrent } from './util/jwt-secrets';

/**
 * Regression coverage for the October 2026 auth review:
 *  - operator injection (non-string credentials never reach Prisma)
 *  - tenant-scoped customer login / registration / forgot-password
 *  - suspended customers rejected at login + refresh
 *  - atomic admin + platform-admin lockout
 *  - tokenVersion (`tv`) + `typ` claims, revocation
 *  - 2FA cannot be falsely enabled
 */

function makePrisma() {
  const delegate = () => ({
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn(),
  });
  return {
    user: delegate(),
    adminUser: delegate(),
    platformAdmin: delegate(),
    tenant: delegate(),
    loginAttempt: delegate(),
    siteSetting: { findMany: jest.fn().mockResolvedValue([]) },
    tenantModule: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('AuthService (security regressions)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let notifications: { sendPasswordResetEmail: jest.Mock };
  let service: AuthService;
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash('Correct1pass', 4);
  });

  beforeEach(() => {
    prisma = makePrisma();
    jwt = { sign: jest.fn((p: any) => `signed:${p.typ}:${p.tv}`), verify: jest.fn() };
    config = {
      get: jest.fn((key: string, def?: any) => {
        const env: Record<string, string> = {
          JWT_SECRET: 'a'.repeat(40),
          JWT_REFRESH_SECRET: 'b'.repeat(40),
          STOREFRONT_URL: 'https://narofashion.co.tz,https://www.narofashion.co.tz',
        };
        return env[key] ?? def;
      }),
    };
    notifications = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(prisma as any, jwt as any, config as any, notifications as any);
  });

  describe('credential shape (Prisma operator injection)', () => {
    it('rejects non-string email/password before any query', async () => {
      await expect(service.validateUser({ not: '' } as any, 'x', 't1')).resolves.toBeNull();
      await expect(service.validateUser('a@b.c', { not: '' } as any, 't1')).resolves.toBeNull();
      await expect(service.validatePlatformAdmin({ not: '' } as any, 'x')).resolves.toBeNull();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
      expect(prisma.platformAdmin.findUnique).not.toHaveBeenCalled();
    });

    it('isCredentialShapeValid only accepts bounded strings', () => {
      expect(isCredentialShapeValid('a@b.c', 'pw')).toBe(true);
      expect(isCredentialShapeValid(['a'], 'pw')).toBe(false);
      expect(isCredentialShapeValid('', 'pw')).toBe(false);
      expect(isCredentialShapeValid('a@b.c', 'x'.repeat(300))).toBe(false);
    });
  });

  describe('customer login is tenant-scoped', () => {
    it('looks customers up by { email, tenantId }', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'c@x.tz', tenantId: 't1', passwordHash: hash, isActive: true });
      const res: any = await service.validateUser('c@x.tz', 'Correct1pass', 't1');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'c@x.tz', tenantId: 't1' } });
      expect(res.id).toBe('u1');
      expect(res.passwordHash).toBeUndefined();
    });

    it('never looks up customers without a tenant', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.validateUser('c@x.tz', 'Correct1pass', null)).resolves.toBeNull();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a suspended customer even with the right password', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'c@x.tz', tenantId: 't1', passwordHash: hash, isActive: false });
      await expect(service.validateUser('c@x.tz', 'Correct1pass', 't1')).rejects.toThrow(SUSPENDED_ACCOUNT_ERROR);
    });

    it('resolveActiveTenantId rejects unknown / suspended tenants and non-strings', async () => {
      expect(await service.resolveActiveTenantId({ not: '' })).toBeNull();
      prisma.tenant.findUnique.mockResolvedValueOnce(null);
      expect(await service.resolveActiveTenantId('nope')).toBeNull();
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 't1', status: 'SUSPENDED' });
      expect(await service.resolveActiveTenantId('t1')).toBeNull();
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 't1', status: 'ACTIVE' });
      expect(await service.resolveActiveTenantId('t1')).toBe('t1');
    });
  });

  describe('registration requires a tenant', () => {
    const dto = { email: 'n@x.tz', password: 'Passw0rd!', firstName: 'A', lastName: 'B' };

    it('rejects registration with no tenant', async () => {
      await expect(service.register(dto as any, undefined)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects registration for an unknown tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.register(dto as any, 'ghost')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates the user under the resolved tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE' });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u9' });
      await service.register(dto as any, 't1');
      expect(prisma.user.create.mock.calls[0][0].data.tenantId).toBe('t1');
    });
  });

  describe('admin lockout (atomic)', () => {
    const admin = { id: 'a1', email: 'adm@x.tz', passwordHash: '', tenantId: 't1', isActive: true, deletedAt: null, lockedUntil: null, failedLoginAttempts: 0 };

    it('reserves the attempt with an atomic increment before checking the password', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ ...admin, passwordHash: hash });
      prisma.adminUser.update.mockResolvedValue({ failedLoginAttempts: 1 });
      await expect(service.validateUser('adm@x.tz', 'wrong', null)).resolves.toBeNull();
      expect(prisma.adminUser.update.mock.calls[0][0].data).toEqual({ failedLoginAttempts: { increment: 1 } });
    });

    it('locks on the 5th failure', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ ...admin, passwordHash: hash });
      prisma.adminUser.update.mockResolvedValueOnce({ failedLoginAttempts: 5 }).mockResolvedValue({});
      await service.validateUser('adm@x.tz', 'wrong', null);
      const lockCall = prisma.adminUser.update.mock.calls.find((c: any[]) => c[0].data.lockedUntil instanceof Date);
      expect(lockCall).toBeDefined();
    });

    it('a parallel request past the cap is rejected even with the CORRECT password', async () => {
      // The counter value returned by the atomic increment decides — a burst
      // of parallel requests can't all slip past a stale read.
      prisma.adminUser.findUnique.mockResolvedValue({ ...admin, passwordHash: hash });
      prisma.adminUser.update.mockResolvedValueOnce({ failedLoginAttempts: 6 }).mockResolvedValue({});
      await expect(service.validateUser('adm@x.tz', 'Correct1pass', null)).rejects.toThrow(GENERIC_LOGIN_ERROR);
      // no success reset was written
      const resetCall = prisma.adminUser.update.mock.calls.find((c: any[]) => c[0].data.failedLoginAttempts === 0);
      expect(resetCall).toBeUndefined();
    });

    it('a locked account gets the same generic message', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ ...admin, passwordHash: hash, lockedUntil: new Date(Date.now() + 60_000) });
      await expect(service.validateUser('adm@x.tz', 'Correct1pass', null)).rejects.toThrow(GENERIC_LOGIN_ERROR);
    });

    it('rejects inactive / soft-deleted admins even with the right password', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ ...admin, passwordHash: hash, isActive: false });
      prisma.adminUser.update.mockResolvedValue({ failedLoginAttempts: 1 });
      await expect(service.validateUser('adm@x.tz', 'Correct1pass', null)).resolves.toBeNull();
    });
  });

  describe('platform-admin lockout', () => {
    const pa = { id: 'p1', email: 'platform@naro.co.tz', passwordHash: '', isActive: true, lockedUntil: null, failedLoginAttempts: 0, role: 'PLATFORM_ADMIN', tokenVersion: 0 };

    it('counts failures atomically and logs a LoginAttempt', async () => {
      prisma.platformAdmin.findUnique.mockResolvedValue({ ...pa, passwordHash: hash });
      prisma.platformAdmin.update.mockResolvedValue({ failedLoginAttempts: 1 });
      await expect(service.validatePlatformAdmin('platform@naro.co.tz', 'wrong')).resolves.toBeNull();
      expect(prisma.platformAdmin.update.mock.calls[0][0].data).toEqual({ failedLoginAttempts: { increment: 1 } });
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'platform@naro.co.tz', success: false }) }),
      );
    });

    it('locked platform admin → generic error', async () => {
      prisma.platformAdmin.findUnique.mockResolvedValue({ ...pa, passwordHash: hash, lockedUntil: new Date(Date.now() + 60_000) });
      await expect(service.validatePlatformAdmin('platform@naro.co.tz', 'Correct1pass')).rejects.toThrow(GENERIC_LOGIN_ERROR);
    });

    it('successful login resets the counter', async () => {
      prisma.platformAdmin.findUnique.mockResolvedValue({ ...pa, passwordHash: hash });
      prisma.platformAdmin.update.mockResolvedValue({ failedLoginAttempts: 1 });
      const res: any = await service.validatePlatformAdmin('platform@naro.co.tz', 'Correct1pass');
      expect(res.isPlatformAdmin).toBe(true);
      expect(prisma.platformAdmin.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { failedLoginAttempts: 0, lockedUntil: null } }),
      );
    });
  });

  describe('token claims', () => {
    it('signs tv + typ into access and refresh tokens', async () => {
      const t = await service.generateTokens({ id: 'u1', email: 'e', tenantId: 't1', tokenVersion: 3 });
      expect(t.accessToken).toBe('signed:access:3');
      expect(t.refreshToken).toBe('signed:refresh:3');
    });

    it('typ / tv helpers accept legacy tokens and reject mismatches', () => {
      expect(isTokenTypeAllowed({}, 'access')).toBe(true);
      expect(isTokenTypeAllowed({ typ: 'refresh' }, 'access')).toBe(false);
      expect(isTokenTypeAllowed({ typ: 'access' }, 'access')).toBe(true);
      expect(isTokenVersionCurrent({}, 0)).toBe(true);
      expect(isTokenVersionCurrent({}, 1)).toBe(false);
      expect(isTokenVersionCurrent({ tv: 2 }, 2)).toBe(true);
    });

    it('toPublicPrincipal strips secrets from login responses', () => {
      const out: any = toPublicPrincipal({ id: 'a', passwordHash: 'h', twoFASecret: 's', tokenVersion: 1, lockedUntil: null, email: 'e' });
      expect(out).toEqual({ id: 'a', email: 'e' });
    });
  });

  describe('refreshTokens', () => {
    it('rejects an access token presented as a refresh token', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'access' });
      await expect(service.refreshTokens('tok')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a revoked (stale tv) customer token', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'refresh', tv: 0, tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e', tenantId: 't1', isActive: true, tokenVersion: 1 });
      await expect(service.refreshTokens('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a suspended customer', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'refresh', tv: 0, tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e', tenantId: 't1', isActive: false, tokenVersion: 0 });
      await expect(service.refreshTokens('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a customer whose tenant no longer matches the token', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'refresh', tv: 0, tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e', tenantId: 't2', isActive: true, tokenVersion: 0 });
      await expect(service.refreshTokens('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a non-string refresh token', async () => {
      await expect(service.refreshTokens({ not: '' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('issues new tokens for a valid legacy (no tv / typ) customer refresh token', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', tenantId: 't1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e', tenantId: 't1', isActive: true, tokenVersion: 0 });
      await expect(service.refreshTokens('tok')).resolves.toEqual(expect.objectContaining({ accessToken: 'signed:access:0' }));
    });

    it('rejects a revoked platform-admin token', async () => {
      jwt.verify.mockReturnValue({ sub: 'p1', typ: 'refresh', tv: 0, isPlatformAdmin: true });
      prisma.platformAdmin.findUnique.mockResolvedValue({ id: 'p1', email: 'e', role: 'PLATFORM_ADMIN', isActive: true, tokenVersion: 4 });
      await expect(service.refreshTokens('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout revocation', () => {
    it('bumps tokenVersion for the principal identified by a current token', async () => {
      jwt.verify.mockReturnValue({ sub: 'a1', typ: 'access', tv: 2, isAdmin: true });
      prisma.adminUser.findUnique.mockResolvedValue({ tokenVersion: 2 });
      await expect(service.revokeFromTokens('acc', undefined)).resolves.toBe(true);
      expect(prisma.adminUser.updateMany).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { tokenVersion: { increment: 1 } } });
      expect(jwt.verify.mock.calls[0][1].ignoreExpiration).toBe(true);
    });

    it('does not bump for an already-stale token', async () => {
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'access', tv: 0 });
      prisma.user.findUnique.mockResolvedValue({ tokenVersion: 5 });
      await expect(service.revokeFromTokens('acc', undefined)).resolves.toBe(false);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('platform admin logout bumps PlatformAdmin.tokenVersion', async () => {
      await service.revokeSessions({ id: 'p1', isPlatformAdmin: true });
      expect(prisma.platformAdmin.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { tokenVersion: { increment: 1 } } });
    });
  });

  describe('password changes revoke sessions', () => {
    it('changePassword increments tokenVersion and returns the fresh principal', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: hash });
      prisma.user.update.mockResolvedValue({ id: 'u1', email: 'e', tenantId: 't1', tokenVersion: 1 });
      const res = await service.changePassword({ id: 'u1' }, 'Correct1pass', 'NewPassw0rd');
      expect(prisma.user.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
      expect(res.principal.tokenVersion).toBe(1);
    });

    it('changePassword works for platform admins', async () => {
      prisma.platformAdmin.findUnique.mockResolvedValue({ id: 'p1', passwordHash: hash });
      prisma.platformAdmin.update.mockResolvedValue({ id: 'p1', email: 'e', role: 'PLATFORM_ADMIN', tokenVersion: 1 });
      const res: any = await service.changePassword({ id: 'p1', isPlatformAdmin: true }, 'Correct1pass', 'NewPassw0rd');
      expect(res.principal.isPlatformAdmin).toBe(true);
    });

    it('resetPassword increments tokenVersion', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      await service.resetPassword('rawtoken', 'NewPassw0rd');
      expect(prisma.user.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });
    });
  });

  describe('forgotPassword', () => {
    it('customer reset is tenant-scoped and links to the tenant domain', async () => {
      prisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 't1', status: 'ACTIVE' })
        .mockResolvedValueOnce({ domain: 'shop.example.tz' });
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: true });
      await service.forgotPassword('c@x.tz', 't1');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'c@x.tz', tenantId: 't1' } });
      expect(notifications.sendPasswordResetEmail.mock.calls[0][1]).toMatch(/^https:\/\/shop\.example\.tz\/auth\/reset-password\?token=/);
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to the first STOREFRONT_URL origin when the tenant has no domain', async () => {
      prisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 't1', status: 'ACTIVE' })
        .mockResolvedValueOnce({ domain: null });
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: true });
      await service.forgotPassword('c@x.tz', 't1');
      expect(notifications.sendPasswordResetEmail.mock.calls[0][1]).toMatch(/^https:\/\/narofashion\.co\.tz\/auth\/reset-password/);
    });

    it('without a tenant only admins are considered', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await service.forgotPassword('c@x.tz', undefined);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('ignores non-string emails', async () => {
      await service.forgotPassword({ not: '' }, 't1');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('legacy PATCH /auth/2fa toggle', () => {
    it('enabling returns 400 pointing at the new endpoints', async () => {
      await expect(service.toggle2FA({ id: 'a1', isAdmin: true }, true, 'x')).rejects.toThrow(TWO_FA_USE_NEW_ENDPOINTS_ERROR);
      expect(prisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('clearing a stale legacy flag requires the current password', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'a1', passwordHash: hash });
      await expect(service.toggle2FA({ id: 'a1', isAdmin: true }, false, 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
      prisma.adminUser.update.mockResolvedValue({ id: 'a1', is2FAEnabled: false });
      await expect(service.toggle2FA({ id: 'a1', isAdmin: true }, false, 'Correct1pass')).resolves.toEqual({ id: 'a1', is2FAEnabled: false });
    });
  });
});

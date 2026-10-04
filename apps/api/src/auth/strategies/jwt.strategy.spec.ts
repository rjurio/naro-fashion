import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

/** Access-token validation: typ, tokenVersion revocation, suspension, tenant membership. */
describe('JwtStrategy.validate', () => {
  let prisma: any;
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      adminUser: { findUnique: jest.fn() },
      platformAdmin: { findUnique: jest.fn() },
    };
    const config: any = { get: (k: string) => (k === 'JWT_SECRET' ? 'x'.repeat(40) : undefined) };
    strategy = new JwtStrategy(config, prisma);
  });

  const customer = { id: 'u1', email: 'c', firstName: null, lastName: null, avatarUrl: null, tenantId: 't1', isActive: true, tokenVersion: 0 };

  it('rejects a refresh token used as an access token', async () => {
    await expect(strategy.validate({ sub: 'u1', email: 'c', typ: 'refresh' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a 2FA challenge token used as an access token (typ confusion)', async () => {
    await expect(
      strategy.validate({ sub: 'a1', email: undefined as any, typ: '2fa_challenge', tv: 0 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a current customer token and strips internal fields', async () => {
    prisma.user.findUnique.mockResolvedValue(customer);
    const res: any = await strategy.validate({ sub: 'u1', email: 'c', typ: 'access', tv: 0, tenantId: 't1' });
    expect(res.id).toBe('u1');
    expect(res.tokenVersion).toBeUndefined();
  });

  it('accepts a legacy token without tv/typ while tokenVersion is 0', async () => {
    prisma.user.findUnique.mockResolvedValue(customer);
    await expect(strategy.validate({ sub: 'u1', email: 'c', tenantId: 't1' })).resolves.toBeDefined();
  });

  it('rejects a suspended customer', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...customer, isActive: false });
    await expect(strategy.validate({ sub: 'u1', email: 'c', tv: 0 })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked customer token (tv behind tokenVersion)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...customer, tokenVersion: 2 });
    await expect(strategy.validate({ sub: 'u1', email: 'c', tv: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a customer token whose tenant no longer matches', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...customer, tenantId: 't2' });
    await expect(strategy.validate({ sub: 'u1', email: 'c', tv: 0, tenantId: 't1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked / soft-deleted admin', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: 'a1', isActive: true, deletedAt: null, tokenVersion: 3, tenantId: 't1' });
    await expect(strategy.validate({ sub: 'a1', email: 'a', isAdmin: true, tv: 2 })).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.adminUser.findUnique.mockResolvedValue({ id: 'a1', isActive: true, deletedAt: new Date(), tokenVersion: 0, tenantId: 't1' });
    await expect(strategy.validate({ sub: 'a1', email: 'a', isAdmin: true, tv: 0 })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked platform admin', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({ id: 'p1', isActive: true, tokenVersion: 1 });
    await expect(strategy.validate({ sub: 'p1', email: 'p', isPlatformAdmin: true })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

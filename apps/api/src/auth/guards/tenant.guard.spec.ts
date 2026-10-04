import { ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { TenantGuard } from './tenant.guard';

function ctx(req: any): any {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  };
}

function makeGuard(statusById: Record<string, string | null>, verify?: (t: string) => any) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id in statusById && statusById[where.id] !== null
          ? { status: statusById[where.id] }
          : null,
      ),
    },
  };
  const jwt: any = {
    verify: jest.fn((token: string) => {
      if (!verify) throw new Error('invalid');
      return verify(token);
    }),
  };
  const config: any = { get: jest.fn() };
  return { guard: new TenantGuard(prisma, jwt, config), prisma, jwt };
}

describe('TenantGuard (global suspended-tenant gate)', () => {
  beforeEach(() => TenantGuard.invalidate());

  it('blocks a SUSPENDED tenant resolved from the X-Tenant-Id header (403 Tenant suspended)', async () => {
    const { guard } = makeGuard({ t1: 'SUSPENDED' });
    const req = { path: '/api/v1/products', headers: { 'x-tenant-id': 't1' } };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Tenant suspended/);
  });

  it('blocks a DEACTIVATED tenant resolved from a verified JWT', async () => {
    const { guard } = makeGuard({ t1: 'DEACTIVATED' }, () => ({ sub: 'a1', tenantId: 't1', isAdmin: true }));
    const req = { path: '/api/v1/orders/admin', headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Tenant suspended/);
  });

  it.each(['ACTIVE', 'TRIAL', 'GRACE'])('allows a %s tenant', async (status) => {
    const { guard } = makeGuard({ t1: status });
    const req = { path: '/api/v1/products', headers: { 'x-tenant-id': 't1' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('platform admins bypass (JWT isPlatformAdmin) even with a suspended header tenant', async () => {
    const { guard, prisma } = makeGuard({ t1: 'SUSPENDED' }, () => ({ sub: 'p1', isPlatformAdmin: true }));
    const req = { path: '/api/v1/tenants', headers: { authorization: 'Bearer p', 'x-tenant-id': 't1' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('the JWT tenant wins over the header (cannot dodge suspension by sending another tenant id)', async () => {
    const { guard } = makeGuard({ suspended: 'SUSPENDED', ok: 'ACTIVE' }, () => ({ tenantId: 'suspended' }));
    const req = { path: '/api/v1/products', headers: { authorization: 'Bearer x', 'x-tenant-id': 'ok' } };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Tenant suspended/);
  });

  it('passes requests with no tenant context (platform login, webhooks)', async () => {
    const { guard } = makeGuard({});
    await expect(guard.canActivate(ctx({ path: '/api/v1/auth/platform-login', headers: {} }))).resolves.toBe(true);
  });

  it('ignores a refresh token used as Bearer (typ=refresh) — falls back to the header', async () => {
    const { guard } = makeGuard({ susp: 'SUSPENDED', ok: 'ACTIVE' }, () => ({ tenantId: 'susp', typ: 'refresh' }));
    const req = { path: '/api/v1/products', headers: { authorization: 'Bearer r', 'x-tenant-id': 'ok' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    const { guard: g2 } = makeGuard({}, () => ({ isPlatformAdmin: true, typ: 'refresh' }));
    // a refresh token can't claim the platform-admin bypass either
    const { guard: g3 } = makeGuard({ t1: 'SUSPENDED' }, () => ({ isPlatformAdmin: true, typ: 'refresh' }));
    await expect(g2.canActivate(ctx({ path: '/x', headers: { authorization: 'Bearer r' } }))).resolves.toBe(true);
    await expect(
      g3.canActivate(ctx({ path: '/x', headers: { authorization: 'Bearer r', 'x-tenant-id': 't1' } })),
    ).rejects.toThrow(/Tenant suspended/);
  });

  it('keeps health / tenant-less auth routes / tenant-resolve reachable for a suspended tenant', async () => {
    const { guard } = makeGuard({ t1: 'SUSPENDED' });
    for (const p of [
      '/api/v1/health',
      '/api/v1/auth/login',
      '/api/v1/auth/platform-login',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/reset-password',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/tenants/resolve',
    ]) {
      await expect(guard.canActivate(ctx({ path: p, headers: { 'x-tenant-id': 't1' } }))).resolves.toBe(true);
    }
  });

  it('caches tenant status (one DB hit for repeated requests)', async () => {
    const { guard, prisma } = makeGuard({ t1: 'ACTIVE' });
    const req = { path: '/api/v1/products', headers: { 'x-tenant-id': 't1' } };
    await guard.canActivate(ctx(req));
    await guard.canActivate(ctx(req));
    await guard.canActivate(ctx(req));
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN on a DB error (outage must not become a platform-wide 403)', async () => {
    const { guard, prisma } = makeGuard({});
    prisma.tenant.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(guard.canActivate(ctx({ path: '/x', headers: { 'x-tenant-id': 't1' } }))).resolves.toBe(true);
  });

  it('is registered globally as APP_GUARD in TenantModule', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tenant', 'tenant.module.ts'), 'utf8');
    expect(src).toMatch(/provide:\s*APP_GUARD,\s*useClass:\s*TenantGuard/);
  });
});

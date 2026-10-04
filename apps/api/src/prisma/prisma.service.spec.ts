import { InternalServerErrorException, Logger } from '@nestjs/common';
import 'reflect-metadata';
import { PrismaService } from './prisma.service';
import { PrismaModule } from './prisma.module';
import { requestContextStorage } from '../tenant/request-context';
import { getTenantScopeStats, resetTenantScopeStats } from '../tenant-scope/tenant-scope.guard';

/**
 * PrismaService returns a `$extends`-ed client from its constructor so the
 * tenant-scope guard is installed for every injector. These tests never hit
 * a database: the guard throws (strict mode) before Prisma connects.
 */
describe('PrismaService + tenant-scope extension', () => {
  const envBackup = { ...process.env };

  beforeAll(() => {
    process.env.DATABASE_URL ||= 'postgresql://nobody:nothing@127.0.0.1:1/none';
  });

  beforeEach(() => {
    resetTenantScopeStats();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...envBackup, DATABASE_URL: process.env.DATABASE_URL };
    jest.restoreAllMocks();
  });

  it('is still injectable via PrismaModule and keeps its shape', () => {
    // Nest DI instantiates providers with `new Metatype(...deps)`; PrismaService has no deps.
    expect(Reflect.getMetadata('providers', PrismaModule)).toContain(PrismaService);
    expect(Reflect.getMetadata('exports', PrismaModule)).toContain(PrismaService);
    expect(Reflect.getMetadata('design:paramtypes', PrismaService) ?? []).toHaveLength(0);
    const svc = new PrismaService();
    expect(svc).toBeInstanceOf(PrismaService);
    expect(typeof svc.onModuleInit).toBe('function');
    expect(typeof svc.onModuleDestroy).toBe('function');
    expect(typeof svc.$transaction).toBe('function');
    expect(typeof svc.$queryRaw).toBe('function');
    expect(typeof svc.product.findMany).toBe('function');
  });

  it('installs the guard: strict mode rejects an unscoped query inside a tenant request', async () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    const svc = new PrismaService();
    await expect(
      requestContextStorage.run({ req: { tenantId: 'tenant-A' } }, async () => await svc.product.findMany({ where: { isActive: true } })),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(getTenantScopeStats().violations).toBe(1);
  });

  it('guards array-form $transaction batches too', async () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    const svc = new PrismaService();
    await expect(
      requestContextStorage.run({ req: { tenantId: 'tenant-A' } }, async () =>
        await svc.$transaction([svc.order.count({ where: { status: 'PENDING' } as any })]),
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('TENANT_SCOPE_ENFORCEMENT=off at construction returns the plain client (no extension)', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'off';
    const svc = new PrismaService();
    expect(svc).toBeInstanceOf(PrismaService);
    expect(svc.tenantScopeGuardInstalled).toBe(false);
    process.env.TENANT_SCOPE_ENFORCEMENT = 'warn';
    expect(new PrismaService().tenantScopeGuardInstalled).toBe(true);
  });

  // Opt-in (needs a reachable DATABASE_URL): interactive transactions keep the
  // extension AND the ALS request context. Run with TENANT_SCOPE_DB_TEST=1.
  (process.env.TENANT_SCOPE_DB_TEST ? it : it.skip)('guards interactive $transaction(tx => ...) clients (DB)', async () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    const svc = new PrismaService();
    try {
      await expect(
        requestContextStorage.run({ req: { tenantId: 'tenant-A' } }, async () =>
          svc.$transaction(async (tx) => tx.product.count({ where: { isActive: true } })),
        ),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      // Scoped query passes through to the DB.
      await expect(
        requestContextStorage.run({ req: { tenantId: 'tenant-A' } }, async () =>
          svc.$transaction(async (tx) => tx.product.count({ where: { tenantId: 'tenant-A' } })),
        ),
      ).resolves.toBe(0);
    } finally {
      await svc.$disconnect();
    }
  });
});

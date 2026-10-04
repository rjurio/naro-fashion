import { ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { requestContextStorage } from '../tenant/request-context';
import { collectTenantIds, dataHasTenant, isByIdWhere, whereHasTenant } from './tenant-scope.inspect';
import { isTenantScopedModel, tenantScopedModels } from './tenant-scope.models';
import { findAllowEntry, TENANT_SCOPE_ALLOWLIST } from './tenant-scope.allowlist';
import {
  captureCallSite,
  checkTenantScope,
  getTenantScopeStats,
  resetTenantScopeStats,
  tenantScopeMode,
} from './tenant-scope.guard';

const T = 'tenant-A';
const inRequest = <R>(fn: () => R, req: any = { tenantId: T }): R => requestContextStorage.run({ req }, fn);

describe('tenant-scope inspectors', () => {
  describe('whereHasTenant', () => {
    it('detects top-level tenantId (string, equals, in, null)', () => {
      expect(whereHasTenant({ tenantId: T })).toBe(true);
      expect(whereHasTenant({ tenantId: { equals: T } })).toBe(true);
      expect(whereHasTenant({ tenantId: { in: [T] } })).toBe(true);
      expect(whereHasTenant({ tenantId: null })).toBe(true);
    });

    it('treats undefined tenantId as missing (Prisma drops undefined keys)', () => {
      expect(whereHasTenant({ tenantId: undefined, id: 'x' })).toBe(false);
      expect(whereHasTenant({})).toBe(false);
      expect(whereHasTenant(undefined)).toBe(false);
    });

    it('accepts AND when any element is scoped', () => {
      expect(whereHasTenant({ AND: [{ name: 'x' }, { tenantId: T }] })).toBe(true);
      expect(whereHasTenant({ AND: { tenantId: T } })).toBe(true);
      expect(whereHasTenant({ AND: [{ name: 'x' }, { sku: 'y' }] })).toBe(false);
    });

    it('accepts OR only when every branch is scoped', () => {
      expect(whereHasTenant({ OR: [{ tenantId: T }, { tenantId: null }] })).toBe(true);
      expect(whereHasTenant({ OR: [{ tenantId: T }, { name: 'x' }] })).toBe(false);
      expect(whereHasTenant({ OR: [] })).toBe(false);
      expect(whereHasTenant({ tenantId: T, OR: [{ name: 'x' }, { sku: 'y' }] })).toBe(true);
    });

    it('detects nested AND/OR combinations', () => {
      expect(
        whereHasTenant({ AND: [{ deletedAt: null }, { OR: [{ tenantId: T, a: 1 }, { AND: [{ tenantId: T }] }] }] }),
      ).toBe(true);
    });

    it('accepts relation filters and compound unique keys', () => {
      expect(whereHasTenant({ id: 'e1', rentalOrder: { tenantId: T } })).toBe(true);
      expect(whereHasTenant({ order: { is: { tenantId: T } } })).toBe(true);
      expect(whereHasTenant({ items: { some: { product: { tenantId: T } } } })).toBe(true);
      expect(whereHasTenant({ tenantId_slug: { tenantId: T, slug: 's' } })).toBe(true);
    });

    it('ignores NOT / none / every / isNot', () => {
      expect(whereHasTenant({ NOT: { tenantId: T } })).toBe(false);
      expect(whereHasTenant({ items: { none: { tenantId: T } } })).toBe(false);
      expect(whereHasTenant({ items: { every: { tenantId: T } } })).toBe(false);
      expect(whereHasTenant({ order: { isNot: { tenantId: T } } })).toBe(false);
    });
  });

  it('collectTenantIds finds literals in where and data trees', () => {
    expect(collectTenantIds({ tenantId: 'a', OR: [{ tenantId: { in: ['b', 'c'] } }], rel: { tenantId: { equals: 'd' } } }).sort())
      .toEqual(['a', 'b', 'c', 'd']);
    expect(collectTenantIds({ tenant: { connect: { id: 'z' } } })).toEqual(['z']);
    expect(collectTenantIds([{ tenantId: 'x' }, { tenantId: 'y' }])).toEqual(['x', 'y']);
    expect(collectTenantIds({ tenantId: null, NOT: { tenantId: 'q' } })).toEqual([]);
  });

  it('dataHasTenant handles single, array, and relation connect', () => {
    expect(dataHasTenant({ tenantId: T, name: 'x' })).toBe(true);
    expect(dataHasTenant({ tenant: { connect: { id: T } } })).toBe(true);
    expect(dataHasTenant({ name: 'x' })).toBe(false);
    expect(dataHasTenant({ tenantId: null })).toBe(false);
    expect(dataHasTenant([{ tenantId: T }, { tenantId: T }])).toBe(true);
    expect(dataHasTenant([{ tenantId: T }, { name: 'x' }])).toBe(false);
  });

  it('isByIdWhere recognises single-row-by-id lookups', () => {
    expect(isByIdWhere({ id: 'x' })).toBe(true);
    expect(isByIdWhere({ id: 'x', deletedAt: null })).toBe(true);
    expect(isByIdWhere({ id: { equals: 'x' } })).toBe(true);
    expect(isByIdWhere({ id: { in: ['x'] } })).toBe(false);
    expect(isByIdWhere({ slug: 'x' })).toBe(false);
  });
});

describe('tenant-scope models (DMMF)', () => {
  it('derives tenant-scoped models from the generated client', () => {
    expect(tenantScopedModels().size).toBeGreaterThan(20);
    expect(isTenantScopedModel('Product')).toBe(true);
    expect(isTenantScopedModel('Order')).toBe(true);
    expect(isTenantScopedModel('Tenant')).toBe(false);
    expect(isTenantScopedModel('PlatformAdmin')).toBe(false);
    expect(isTenantScopedModel('OrderItem')).toBe(false);
  });
});

describe('tenant-scope allowlist', () => {
  it('every entry documents a reason', () => {
    for (const e of TENANT_SCOPE_ALLOWLIST) expect(e.reason.length).toBeGreaterThan(20);
  });

  it('call-site entries only match their call site', () => {
    expect(findAllowEntry('AdminUser', 'findUnique', 'src/auth/auth.service.ts:267')).toBeDefined();
    expect(findAllowEntry('AdminUser', 'findUnique', 'src/orders/orders.service.ts:10')).toBeUndefined();
    expect(findAllowEntry('AdminUser', 'findUnique', null)).toBeUndefined();
    expect(findAllowEntry('LoginAttempt', 'create', 'src/auth/auth.service.ts:377')).toBeDefined();
  });

  it('cross-tenant exemptions require allowCrossTenant', () => {
    expect(findAllowEntry('AdminUser', 'findUnique', 'src/auth/auth.service.ts:267', { crossTenant: true })).toBeUndefined();
    expect(findAllowEntry('TenantBranding', 'findUnique', 'src/tenants/tenants.service.ts:78', { crossTenant: true })).toBeDefined();
  });
});

describe('checkTenantScope', () => {
  const envBackup = { ...process.env };
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    resetTenantScopeStats();
    delete process.env.TENANT_SCOPE_ENFORCEMENT;
    delete process.env.TENANT_SCOPE_STRICT_BY_ID;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...envBackup };
    warn.mockRestore();
    error.mockRestore();
  });

  it('defaults to warn mode', () => {
    expect(tenantScopeMode()).toBe('warn');
    process.env.TENANT_SCOPE_ENFORCEMENT = 'STRICT';
    expect(tenantScopeMode()).toBe('strict');
    process.env.TENANT_SCOPE_ENFORCEMENT = 'bogus';
    expect(tenantScopeMode()).toBe('warn');
  });

  it('is a no-op outside a request context (crons, scripts, seeders)', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    expect(() => checkTenantScope({ model: 'Product', operation: 'findMany', args: {} })).not.toThrow();
    expect(getTenantScopeStats().checked).toBe(0);
  });

  it('is a no-op for requests without a tenant and for platform admins', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    const q = { model: 'Product', operation: 'findMany', args: {} };
    expect(() => inRequest(() => checkTenantScope(q), {})).not.toThrow();
    expect(() => inRequest(() => checkTenantScope(q), { tenantId: T, user: { isPlatformAdmin: true } })).not.toThrow();
    expect(getTenantScopeStats().checked).toBe(0);
  });

  it('skips models without tenantId and non-checked operations', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    inRequest(() => {
      checkTenantScope({ model: 'Tenant', operation: 'findMany', args: {} });
      checkTenantScope({ model: 'OrderItem', operation: 'deleteMany', args: {} });
      checkTenantScope({ model: undefined, operation: 'queryRaw', args: {} });
    });
    expect(getTenantScopeStats().checked).toBe(0);
  });

  it('passes scoped queries and creates silently', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    inRequest(() => {
      checkTenantScope({ model: 'Product', operation: 'findMany', args: { where: { tenantId: T, deletedAt: null } } });
      checkTenantScope({ model: 'Product', operation: 'create', args: { data: { tenantId: T, name: 'x' } } });
      checkTenantScope({ model: 'Product', operation: 'createMany', args: { data: [{ tenantId: T }] } });
      checkTenantScope({ model: 'ProductVariant', operation: 'updateMany', args: { where: { product: { tenantId: T } }, data: {} } });
      checkTenantScope({
        model: 'SiteSetting',
        operation: 'upsert',
        args: { where: { tenantId_key: { tenantId: T, key: 'k' } }, create: { tenantId: T, key: 'k' }, update: {} },
      });
    });
    const s = getTenantScopeStats();
    expect(s.checked).toBe(5);
    expect(s.violations).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('warn mode logs once per call site, counts every occurrence, never throws', () => {
    const run = () => checkTenantScope({ model: 'Product', operation: 'findMany', args: { where: { isActive: true } } });
    inRequest(() => {
      for (let i = 0; i < 3; i++) run();
    });
    const s = getTenantScopeStats();
    expect(s.violations).toBe(3);
    expect(s.distinct).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/\[TENANT_SCOPE\] unscoped Product\.findMany .*tenant-scope\.spec\.ts:\d+/);
    const [key] = Object.keys(s.byKey);
    expect(key).toMatch(/^Product\.findMany @ src\/tenant-scope\/tenant-scope\.spec\.ts:\d+$/);
  });

  it('flags creates without tenantId and upserts whose create lacks tenantId', () => {
    inRequest(() => {
      checkTenantScope({ model: 'Order', operation: 'create', args: { data: { total: 1 } } });
      checkTenantScope({
        model: 'SiteSetting',
        operation: 'upsert',
        args: { where: { tenantId_key: { tenantId: T, key: 'k' } }, create: { key: 'k' }, update: {} },
      });
    });
    expect(getTenantScopeStats().violations).toBe(2);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/data without tenantId[\s\S]*upsert create without tenantId/);
  });

  it('strict mode throws InternalServerErrorException for unscoped bulk queries', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    expect(() =>
      inRequest(() => checkTenantScope({ model: 'Order', operation: 'deleteMany', args: { where: { status: 'X' } } })),
    ).toThrow(InternalServerErrorException);
    expect(() =>
      inRequest(() =>
        checkTenantScope({ model: 'Order', operation: 'findMany', args: { where: { OR: [{ tenantId: T }, { status: 'X' }] } } }),
      ),
    ).toThrow(/Tenant scope violation: Order\.findMany/);
  });

  it('strict mode only warns for by-id lookups unless TENANT_SCOPE_STRICT_BY_ID=true', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    const byId = () => checkTenantScope({ model: 'Order', operation: 'update', args: { where: { id: 'o1' }, data: {} } });
    expect(() => inRequest(byId)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/where by id only/));
    process.env.TENANT_SCOPE_STRICT_BY_ID = 'true';
    expect(() => inRequest(byId)).toThrow(InternalServerErrorException);
  });

  it('detects a cross-tenant tenantId: logs error in warn mode, Forbidden in strict', () => {
    const q = { model: 'Product', operation: 'findFirst', args: { where: { id: 'p', tenantId: 'tenant-B' } } };
    expect(() => inRequest(() => checkTenantScope(q))).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/cross-tenant Product\.findFirst .*tenant-B != request tenant tenant-A/));
    expect(getTenantScopeStats().mismatches).toBe(1);

    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    expect(() => inRequest(() => checkTenantScope(q))).toThrow(ForbiddenException);
    expect(() =>
      inRequest(() => checkTenantScope({ model: 'Product', operation: 'create', args: { data: { tenantId: 'tenant-B' } } })),
    ).toThrow(ForbiddenException);
    expect(() =>
      inRequest(() =>
        checkTenantScope({ model: 'Product', operation: 'update', args: { where: { id: 'p', tenantId: T }, data: { tenantId: 'tenant-B' } } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('reads the tenant lazily from req.user when the interceptor has not run yet', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'strict';
    expect(() =>
      inRequest(() => checkTenantScope({ model: 'Order', operation: 'findMany', args: {} }), { user: { tenantId: T } }),
    ).toThrow(InternalServerErrorException);
  });

  it('off mode disables everything', () => {
    process.env.TENANT_SCOPE_ENFORCEMENT = 'off';
    inRequest(() => checkTenantScope({ model: 'Order', operation: 'deleteMany', args: {} }));
    expect(getTenantScopeStats().checked).toBe(0);
  });

  it('captureCallSite points at the first app frame outside the guard', () => {
    expect(captureCallSite()).toMatch(/^src\/tenant-scope\/tenant-scope\.spec\.ts:\d+$/);
  });
});

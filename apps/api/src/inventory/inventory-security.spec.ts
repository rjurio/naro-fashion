import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { RolesService } from '../roles/roles.service';

// Security fix (round 25F B): inventory writes were open to ANY admin account
// (STAFF included); stock could go negative; the ledger's before/after were
// read outside the transaction; product forms could overwrite stock; a
// roles:manage holder could grant themselves any permission.

describe('routes: every inventory write needs inventory:manage', () => {
  const meta = (m: string) => Reflect.getMetadata(PERMISSIONS_KEY, (InventoryController.prototype as any)[m]);
  it('adjust + settings → inventory:manage; PermissionGuard on the controller; reads unchanged', () => {
    expect(meta('adjustStock')).toEqual(['inventory:manage']);
    expect(meta('updateSettings')).toEqual(['inventory:manage']);
    expect(meta('getList')).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', InventoryController)).toContain(PermissionGuard);
  });
  it('the DTO accepts only RESTOCK / ADJUSTMENT / DAMAGE', async () => {
    for (const [type, ok] of [['RESTOCK', true], ['ADJUSTMENT', true], ['DAMAGE', true], ['SALE', false], ['RENTAL_OUT', false], ['RETURN', false]] as const) {
      const errs = await validate(plainToInstance(AdjustStockDto, { productId: 'p', type, quantity: 1 }));
      expect([type, errs.length === 0]).toEqual([type, ok]);
    }
  });
});

describe('adjustStock: atomic, tenant-scoped, never negative, accurate ledger, before/after audit', () => {
  // PR #42 port, adapted to the approval workflow on this branch: a decrease
  // applies in one step only within an owner-set threshold (none set → it
  // becomes an approval request); every applied change is a compare-and-swap
  // on the stock read inside the transaction.
  function make(opts: { pre?: number; inTx?: number; delta?: number; count?: number; maxUnits?: string } = {}) {
    const tx: any = {
      productVariant: {
        findFirst: jest.fn(async () => ({ stock: opts.inTx ?? (opts.pre ?? 10) + (opts.delta ?? 0) })),
        updateMany: jest.fn(async () => ({ count: opts.count ?? 1 })),
      },
      product: { updateMany: jest.fn(async () => ({ count: 1 })) },
      inventoryTransaction: { create: jest.fn(async ({ data }: any) => ({ id: 'tx1', ...data })) },
    };
    const prisma: any = {
      product: { findFirst: jest.fn(async () => ({ id: 'p1', purchasePrice: 0, availabilityMode: 'PURCHASE_ONLY' })) },
      productVariant: { findFirst: jest.fn(async () => ({ id: 'v1', productId: 'p1', stock: opts.pre ?? 10 })), findMany: jest.fn(async () => [{ id: 'v1' }]) },
      siteSetting: { findMany: jest.fn(async () => (opts.maxUnits ? [{ key: 'inventory_decrease_auto_max_units', value: opts.maxUnits }] : [])) },
      inventoryAdjustmentRequest: { create: jest.fn(async ({ data }: any) => ({ id: 'req1', status: 'REQUESTED', ...data })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const audit: any = { log: jest.fn(async () => undefined) };
    const svc = new InventoryService(prisma, { requireId: 't1' } as any, audit);
    return { svc, tx, prisma, audit };
  }
  it('a decrease within the owner threshold is a tenant-scoped compare-and-swap; ledger before/after come from inside the transaction', async () => {
    const { svc, tx, audit } = make({ maxUnits: '5', delta: -3 });
    const r: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 3, note: 'torn hem, unsellable' } as any, 'admin-1');
    expect(tx.productVariant.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'v1', tenantId: 't1', stock: { gte: 3 } }, data: { stock: { increment: -3 } } });
    expect([r.quantityBefore, r.quantityChange, r.quantityAfter]).toEqual([10, -3, 7]);
    expect(audit.log).toHaveBeenCalledWith('ADJUST_STOCK', 'Inventory', 'p1', expect.objectContaining({ before: 10, after: 7, quantityChange: -3, variantId: 'v1', approval: 'WITHIN_THRESHOLD' }));
  });
  it('a decrease with NO threshold set is only requested — nothing written', async () => {
    const { svc, tx, prisma } = make();
    const r: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 1, note: 'torn hem, unsellable' } as any, 'admin-1');
    expect(r.status).toBe('PENDING_APPROVAL');
    expect(prisma.inventoryAdjustmentRequest.create).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('not enough stock → 409 INSUFFICIENT_STOCK, nothing ledgered', async () => {
    const { svc, tx } = make({ pre: 2, maxUnits: '5' });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 3, note: 'torn hem, unsellable' } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('INSUFFICIENT_STOCK');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('expectedStock that no longer matches → 409 STALE_STOCK, nothing written', async () => {
    const { svc, tx } = make({ pre: 9 });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 5, expectedStock: 10 } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('STALE_STOCK');
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('stock moved between the read and the transaction (expectedStock given) → 409 STALE_STOCK, nothing written', async () => {
    const { svc, tx } = make({ pre: 10, inTx: 9 });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 5, expectedStock: 10 } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('STALE_STOCK');
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('a concurrent write-off took the stock first (guarded update matched nothing) → 409 INSUFFICIENT_STOCK, nothing ledgered', async () => {
    const { svc, tx } = make({ count: 0, maxUnits: '5' });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 3, note: 'torn hem, unsellable' } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('INSUFFICIENT_STOCK');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});

describe('roles: no self-granted permission bypass', () => {
  function make(opts: { holds?: boolean; mine?: string[] } = {}) {
    const prisma: any = {
      role: { findFirst: jest.fn(async () => ({ id: 'r1', tenantId: 't1', isSystem: false })) },
      adminUserRole: {
        findFirst: jest.fn(async () => (opts.holds ? { adminUserId: 'u1', roleId: 'r1' } : null)),
        findMany: jest.fn(async () => [{ role: { permissions: (opts.mine ?? []).map((code) => ({ permission: { code } })) } }]),
      },
      permission: { findMany: jest.fn(async () => [{ code: 'inventory:manage' }]) },
      rolePermission: { createMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) },
    };
    const audit: any = { log: jest.fn(async () => undefined) };
    const svc = new RolesService(prisma, { requireId: 't1' } as any, audit);
    return { svc, prisma };
  }
  const manager = { id: 'u1', isAdmin: true, role: 'MANAGER', tenantId: 't1' };
  it('adding permissions to a role you hold → 403 OWN_ROLE', async () => {
    const { svc, prisma } = make({ holds: true, mine: ['roles:manage', 'inventory:manage'] });
    const e: any = await svc.addPermissions('r1', ['perm-inv'], manager).catch((x) => x);
    expect(e.getResponse().code).toBe('OWN_ROLE');
    expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });
  it('granting a permission you don\'t hold → 403 BEYOND_OWN_PERMISSIONS', async () => {
    const { svc, prisma } = make({ holds: false, mine: ['roles:manage'] });
    const e: any = await svc.addPermissions('r1', ['perm-inv'], manager).catch((x) => x);
    expect(e.getResponse().code).toBe('BEYOND_OWN_PERMISSIONS');
    expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });
  it('a permission you hold, on a role you don\'t hold → allowed; SUPER_ADMIN unrestricted', async () => {
    const a = make({ holds: false, mine: ['roles:manage', 'inventory:manage'] });
    await a.svc.addPermissions('r1', ['perm-inv'], manager);
    expect(a.prisma.rolePermission.createMany).toHaveBeenCalled();
    const b = make({ holds: true, mine: [] });
    await b.svc.addPermissions('r1', ['perm-inv'], { id: 's1', isAdmin: true, role: 'SUPER_ADMIN', tenantId: 't1' });
    expect(b.prisma.rolePermission.createMany).toHaveBeenCalled();
  });
});

describe('round 25F C: PermissionGuard on inventory:manage routes', () => {
  function guardFor(codes: string[]) {
    const reflector: any = { getAllAndOverride: () => ['inventory:manage'] };
    const prisma: any = { adminUserRole: { findMany: jest.fn(async () => [{ role: { permissions: codes.map((code) => ({ permission: { code } })) } }]) } };
    return { guard: new PermissionGuard(reflector, prisma), prisma };
  }
  const ctx = (user: any): any => ({ getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) });
  it('SUPER_ADMIN passes with NO grant (role bypass; no permission lookup at all)', async () => {
    const { guard, prisma } = guardFor([]);
    await expect(guard.canActivate(ctx({ id: 'sa', isAdmin: true, role: 'SUPER_ADMIN', tenantId: 't1' }))).resolves.toBe(true);
    expect(prisma.adminUserRole.findMany).not.toHaveBeenCalled();
  });
  it('a holder of inventory:manage passes; STAFF / a MANAGER without it -> 403; a customer -> 403', async () => {
    await expect(guardFor(['inventory:manage']).guard.canActivate(ctx({ id: 'm1', isAdmin: true, role: 'MANAGER', tenantId: 't1' }))).resolves.toBe(true);
    await expect(guardFor(['inventory:view']).guard.canActivate(ctx({ id: 's1', isAdmin: true, role: 'STAFF', tenantId: 't1' }))).rejects.toMatchObject({ status: 403 });
    await expect(guardFor(['orders:view']).guard.canActivate(ctx({ id: 'm2', isAdmin: true, role: 'MANAGER', tenantId: 't1' }))).rejects.toMatchObject({ status: 403 });
    await expect(guardFor(['inventory:manage']).guard.canActivate(ctx({ id: 'c1', tenantId: 't1' }))).rejects.toMatchObject({ status: 403 });
  });
});

describe('round 25F C: adjust only a variant of the named product', () => {
  it('variant lookup is scoped by tenant AND product', async () => {
    const prisma: any = {
      product: { findFirst: jest.fn(async () => ({ id: 'p1', purchasePrice: 0 })) },
      productVariant: { findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(),
    };
    const svc = new InventoryService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
    await expect(svc.adjustStock({ productId: 'p1', variantId: 'v-of-p2', type: 'RESTOCK', quantity: 1 } as any, 'a')).rejects.toMatchObject({ status: 404 });
    // Stack: Release 1's resolveTarget looks the variant up by tenant, then refuses one of another product (400).
    expect(prisma.productVariant.findFirst.mock.calls[0][0].where).toEqual({ id: 'v-of-p2', tenantId: 't1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    prisma.productVariant.findFirst.mockResolvedValue({ id: 'v-of-p2', productId: 'p2', stock: 3 });
    await expect(svc.adjustStock({ productId: 'p1', variantId: 'v-of-p2', type: 'RESTOCK', quantity: 1 } as any, 'a')).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('round 25F C: roles - restore is a grant; permissionIds validated', () => {
  function make(opts: { holds?: boolean; mine?: string[]; grants?: string[]; perms?: any[] } = {}) {
    const prisma: any = {
      role: {
        findFirst: jest.fn(async () => ({ id: 'r1', tenantId: 't1', isSystem: false, deletedAt: new Date() })),
        update: jest.fn(async () => ({ id: 'r1' })),
      },
      adminUserRole: {
        findFirst: jest.fn(async () => (opts.holds ? { adminUserId: 'u1', roleId: 'r1' } : null)),
        findMany: jest.fn(async () => [{ role: { permissions: (opts.mine ?? []).map((code) => ({ permission: { code } })) } }]),
      },
      permission: { findMany: jest.fn(async () => opts.perms ?? [{ code: 'orders:view' }]) },
      rolePermission: {
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => (opts.grants ?? []).map((code) => ({ permission: { code } }))),
      },
    };
    const svc = new RolesService(prisma, { requireId: 't1' } as any, { log: jest.fn(async () => undefined) } as any);
    return { svc, prisma };
  }
  const manager = { id: 'u1', isAdmin: true, role: 'MANAGER', tenantId: 't1' };
  it('restoring a role you hold -> 403 OWN_ROLE; one carrying permissions you lack -> 403 BEYOND_OWN_PERMISSIONS', async () => {
    const a = make({ holds: true, mine: ['roles:manage', 'inventory:manage'], grants: ['inventory:manage'] });
    expect((await a.svc.restore('r1', manager).catch((x) => x)).getResponse().code).toBe('OWN_ROLE');
    const b = make({ holds: false, mine: ['roles:manage'], grants: ['inventory:manage'] });
    expect((await b.svc.restore('r1', manager).catch((x) => x)).getResponse().code).toBe('BEYOND_OWN_PERMISSIONS');
    expect(a.prisma.role.update).not.toHaveBeenCalled();
    expect(b.prisma.role.update).not.toHaveBeenCalled();
  });
  it('restore within your permissions, or by SUPER_ADMIN -> allowed', async () => {
    const a = make({ holds: false, mine: ['roles:manage', 'orders:view'], grants: ['orders:view'] });
    await a.svc.restore('r1', manager);
    expect(a.prisma.role.update).toHaveBeenCalled();
    const b = make({ holds: true, grants: ['inventory:manage'] });
    await b.svc.restore('r1', { id: 's1', isAdmin: true, role: 'SUPER_ADMIN', tenantId: 't1' });
    expect(b.prisma.role.update).toHaveBeenCalled();
  });
  it('addPermissions: non-array / non-string / unknown ids -> 400/404, nothing written', async () => {
    const sup = { id: 's1', isAdmin: true, role: 'SUPER_ADMIN', tenantId: 't1' };
    const a = make();
    await expect(a.svc.addPermissions('r1', undefined as any, sup)).rejects.toMatchObject({ status: 400 });
    await expect(a.svc.addPermissions('r1', [{ not: 'x' }] as any, sup)).rejects.toMatchObject({ status: 400 });
    const b = make({ perms: [] });
    await expect(b.svc.addPermissions('r1', ['missing'], sup)).rejects.toMatchObject({ status: 404 });
    expect(a.prisma.rolePermission.createMany).not.toHaveBeenCalled();
    expect(b.prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });
});

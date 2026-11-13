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
  function make(opts: { count?: number; after?: number; now?: number } = {}) {
    const tx: any = {
      productVariant: {
        updateMany: jest.fn(async () => ({ count: opts.count ?? 1 })),
        findFirst: jest.fn(async () => ({ stock: opts.count === 0 ? (opts.now ?? 2) : (opts.after ?? 7) })),
      },
      product: { updateMany: jest.fn(async () => ({ count: 1 })) },
      inventoryTransaction: { create: jest.fn(async ({ data }: any) => ({ id: 'tx1', ...data })) },
    };
    const prisma: any = {
      product: { findFirst: jest.fn(async () => ({ id: 'p1', purchasePrice: 0 })) },
      productVariant: { findFirst: jest.fn(async () => ({ id: 'v1', productId: 'p1' })), findMany: jest.fn(async () => [{ id: 'v1' }]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const audit: any = { log: jest.fn(async () => undefined) };
    const svc = new InventoryService(prisma, { requireId: 't1' } as any, audit);
    return { svc, tx, audit };
  }
  it('a decrease is guarded (stock >= quantity) and tenant-scoped; ledger before/after come from inside the transaction', async () => {
    const { svc, tx, audit } = make({ after: 7 });
    const r: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 3 } as any, 'admin-1');
    expect(tx.productVariant.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'v1', tenantId: 't1', stock: { gte: 3 } }, data: { stock: { increment: -3 } } });
    expect([r.quantityBefore, r.quantityChange, r.quantityAfter]).toEqual([10, -3, 7]);
    expect(audit.log).toHaveBeenCalledWith('ADJUST_STOCK', 'Inventory', 'p1', expect.objectContaining({ before: 10, after: 7, quantityChange: -3, variantId: 'v1' }));
  });
  it('not enough stock → 409 INSUFFICIENT_STOCK, nothing ledgered', async () => {
    const { svc, tx } = make({ count: 0, now: 2 });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 3 } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('INSUFFICIENT_STOCK');
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('expectedStock that no longer matches → 409 STALE_STOCK, nothing written', async () => {
    const { svc, tx } = make({ count: 0, now: 9 });
    const e: any = await svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 5, expectedStock: 10 } as any, 'a').catch((x) => x);
    expect(e.getResponse().code).toBe('STALE_STOCK');
    expect(tx.productVariant.updateMany.mock.calls[0][0].where).toEqual({ id: 'v1', tenantId: 't1', stock: 10 });
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

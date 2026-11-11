import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PosService } from './pos.service';
import { PRODUCT_NOT_ACTIVE, assertActiveAtPos } from './pos-sale-eligibility';

/**
 * Owner decision 2026-11-11: Royal Pearl Mermaid Gown stays INACTIVE. It is
 * hidden from customers, the POS search and the offline catalog, but it has
 * a barcode (stock 1), so before this fix a scan could still sell it.
 * Inactive / archived / deleted products and disabled variants are now
 * refused in every POS path that starts a sale. Active products unchanged.
 */

type P = { isActive?: boolean; deletedAt?: Date | null; archivedAt?: Date | null; variantActive?: boolean; mode?: string };

function makeService(products: Record<string, P>) {
  const variants = Object.entries(products).map(([k, p]) => ({
    id: `v-${k}`, productId: `p-${k}`, stock: 1, price: 200000, name: 'off white', barcode: `BC-${k}`,
    isActive: p.variantActive ?? true,
    product: {
      id: `p-${k}`, name: `Product ${k}`, availabilityMode: p.mode ?? 'BOTH',
      isActive: p.isActive ?? true, deletedAt: p.deletedAt ?? null, archivedAt: p.archivedAt ?? null,
      images: [], category: null,
    },
  }));
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
    order: { create: jest.fn(async ({ data }: any) => ({ id: 'o1', ...data, items: [] })), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn() },
    payment: { create: jest.fn().mockResolvedValue({}) },
    productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn(async () => ({ stock: 0 })) },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    posSession: { update: jest.fn().mockResolvedValue({}) },
    layaway: { create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })) },
  };
  const prisma: any = {
    posSession: { findFirst: jest.fn(async () => ({ id: 's1', adminUserId: 'cashier-1', status: 'OPEN', openedAt: new Date(Date.now() - 3600_000), closedAt: null, tenantId: 't1' })) },
    productVariant: {
      findMany: jest.fn(async ({ where }: any) => variants.filter((v) => where.id.in.includes(v.id))),
      findFirst: jest.fn(async ({ where }: any) => variants.find((v) => v.barcode === where.barcode) ?? null),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  return { service: new PosService(prisma, { requireId: 't1' } as any), prisma, tx };
}

const sale = (keys: string[]) => ({
  items: keys.map((k) => ({ productId: `p-${k}`, variantId: `v-${k}`, quantity: 1, unitPrice: 200000 })),
  payments: [{ method: 'CASH', amount: 200000 * keys.length }],
});
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e.getResponse?.().code ?? e.constructor.name; } };

describe('assertActiveAtPos', () => {
  it('blocks inactive, archived, deleted products and disabled variants; names each once', () => {
    expect(() => assertActiveAtPos([{ isActive: true, product: { name: 'A', isActive: true } }])).not.toThrow();
    for (const v of [
      { product: { name: 'A', isActive: false } },
      { product: { name: 'A', isActive: true, archivedAt: new Date() } },
      { product: { name: 'A', isActive: true, deletedAt: new Date() } },
      { isActive: false, product: { name: 'A', isActive: true } },
    ]) {
      expect(() => assertActiveAtPos([v, v])).toThrow(/^A is not active and cannot be sold at the POS\.$/);
    }
  });
});

describe('POS never sells an inactive product (Royal Pearl Mermaid Gown case)', () => {
  it('barcode scan of an inactive product → not found (the till can’t add it)', async () => {
    const { service } = makeService({ royal: { isActive: false } });
    await expect(service.lookupBarcode('BC-royal')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a sale sent directly to the API is refused with nothing written', async () => {
    const { service, prisma, tx } = makeService({ royal: { isActive: false } });
    expect(await code(service.createSale(sale(['royal']) as any, 'cashier-1'))).toBe(PRODUCT_NOT_ACTIVE);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('an offline replay is refused too (shows as a failed sync entry for staff)', async () => {
    const { service, tx } = makeService({ royal: { isActive: false } });
    const r = await code(service.createSale({ ...sale(['royal']), offline: true, clientCreatedAt: new Date(Date.now() - 60_000).toISOString(), sessionId: 's1' } as any, 'cashier-1'));
    expect(r).toBe(PRODUCT_NOT_ACTIVE);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('layaway and exchange replacement are refused', async () => {
    const a = makeService({ royal: { isActive: false } });
    expect(await code(a.service.createLayaway({ customerId: 'u1', items: sale(['royal']).items, depositAmount: 0, depositMethod: 'CASH' } as any, 'cashier-1'))).toBe(PRODUCT_NOT_ACTIVE);
    expect(a.tx.layaway.create).not.toHaveBeenCalled();
    const b = makeService({ royal: { isActive: false } });
    expect(await code(b.service.createExchange({ originalOrderId: 'o0', returnedItems: [{ orderItemId: 'oi1', quantity: 1 }], newItems: [{ productId: 'p-royal', variantId: 'v-royal', quantity: 1, unitPrice: 200000 }] } as any, 'cashier-1'))).toBe(PRODUCT_NOT_ACTIVE);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('archived, deleted and disabled-variant products are refused the same way', async () => {
    for (const p of [{ archivedAt: new Date() }, { deletedAt: new Date() }, { variantActive: false }] as P[]) {
      const { service } = makeService({ x: p });
      expect(await code(service.createSale(sale(['x']) as any, 'cashier-1'))).toBe(PRODUCT_NOT_ACTIVE);
      await expect(service.lookupBarcode('BC-x')).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('active products (BOTH / PURCHASE_ONLY) still scan and sell normally', async () => {
    for (const mode of ['BOTH', 'PURCHASE_ONLY']) {
      const { service, tx } = makeService({ ok: { mode } });
      await expect(service.lookupBarcode('BC-ok')).resolves.toMatchObject({ id: 'v-ok' });
      expect(await code(service.createSale(sale(['ok']) as any, 'cashier-1'))).toBe('OK');
      expect(tx.order.create).toHaveBeenCalledTimes(1);
    }
  });

  it('a mixed cart with one inactive line is refused as a whole', async () => {
    const { service, tx } = makeService({ ok: {}, royal: { isActive: false } });
    expect(await code(service.createSale(sale(['ok', 'royal']) as any, 'cashier-1'))).toBe(PRODUCT_NOT_ACTIVE);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('a RENTAL_ONLY product keeps its own (P0a) refusal code', async () => {
    const { service } = makeService({ ro: { mode: 'RENTAL_ONLY' } });
    let err: any;
    try { await service.createSale(sale(['ro']) as any, 'cashier-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().code).toBe('RENTAL_ONLY_NOT_FOR_SALE');
  });
});

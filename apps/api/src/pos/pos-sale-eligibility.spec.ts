import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import {
  RENTAL_ONLY_NOT_FOR_SALE,
  assertSellableAtPos,
  isSellableAtPos,
} from './pos-sale-eligibility';

/**
 * Regression (Nov 2026): the POS sold RENTAL_ONLY gowns at their retail
 * price. The API now refuses — whatever the UI does — in every POS path that
 * sells a product: sale (online + offline replay), layaway, exchange
 * replacement items. PURCHASE_ONLY and BOTH keep selling exactly as before.
 */

type Mode = 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH' | undefined;

function makeService(modes: Record<string, Mode>) {
  // One variant per entry: v-<key> belongs to product p-<key> with that mode.
  const variants = Object.entries(modes).map(([k, mode]) => ({
    id: `v-${k}`,
    productId: `p-${k}`,
    stock: 10,
    price: 1000,
    name: 'Standard',
    product: { id: `p-${k}`, name: `Gown ${k}`, availabilityMode: mode },
  }));
  const tx: any = {
    // P0b: product lock + open-rental lookup inside sale transactions.
    $executeRaw: jest.fn().mockResolvedValue(1),
    rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
    order: {
      create: jest.fn(async ({ data }: any) => ({ id: 'o1', ...data, items: [] })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
    },
    payment: { create: jest.fn().mockResolvedValue({}) },
    productVariant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(async () => ({ stock: 9 })),
    },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    posSession: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    layaway: { create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })) },
  };
  const prisma: any = {
    posSession: {
      findFirst: jest.fn(async () => ({
        id: 'sess-open', adminUserId: 'cashier-1', status: 'OPEN',
        openedAt: new Date(Date.now() - 3600_000), closedAt: null, tenantId: 't1',
      })),
    },
    productVariant: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in;
        return variants.filter((v) => ids.includes(v.id));
      }),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const service = new PosService(prisma, { requireId: 't1' } as any);
  return { service, prisma, tx };
}

const sale = (keys: string[], extra: any = {}) => ({
  items: keys.map((k) => ({ productId: `p-${k}`, variantId: `v-${k}`, quantity: 1, unitPrice: 1000 })),
  payments: [{ method: 'CASH', amount: 1000 * keys.length }],
  ...extra,
});

async function expectRentalOnlyRejection(p: Promise<unknown>, names: string[]) {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(BadRequestException);
  const body = err.getResponse();
  expect(body.code).toBe(RENTAL_ONLY_NOT_FOR_SALE);
  expect(body.products).toEqual(names);
  expect(body.message).toMatch(/rental-only and cannot be sold/);
}

describe('isSellableAtPos / assertSellableAtPos', () => {
  it('only RENTAL_ONLY is unsellable; missing mode defaults to sellable', () => {
    expect(isSellableAtPos('RENTAL_ONLY')).toBe(false);
    expect(isSellableAtPos('PURCHASE_ONLY')).toBe(true);
    expect(isSellableAtPos('BOTH')).toBe(true);
    expect(isSellableAtPos(undefined)).toBe(true);
  });
  it('names every blocked product once', () => {
    expect(() =>
      assertSellableAtPos([
        { name: 'A', availabilityMode: 'RENTAL_ONLY' },
        { name: 'A', availabilityMode: 'RENTAL_ONLY' },
        { name: 'B', availabilityMode: 'BOTH' },
      ]),
    ).toThrow(/^A is rental-only/);
  });
});

describe('POS sale of a RENTAL_ONLY product is refused by the API', () => {
  it('direct API call (controller → service), bypassing the POS UI: 400 RENTAL_ONLY_NOT_FOR_SALE, nothing written', async () => {
    const { service, prisma, tx } = makeService({ ro: 'RENTAL_ONLY' });
    const controller = new PosController(service);
    await expectRentalOnlyRejection(controller.createSale(sale(['ro']) as any, 'cashier-1'), ['Gown ro']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('offline replay of a RENTAL_ONLY sale is refused too (no oversold/accept path)', async () => {
    const { service, tx } = makeService({ ro: 'RENTAL_ONLY' });
    await expectRentalOnlyRejection(
      service.createSale(sale(['ro'], { offline: true, clientCreatedAt: new Date(Date.now() - 60_000).toISOString(), sessionId: 'sess-open' }) as any, 'cashier-1'),
      ['Gown ro'],
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('a mixed cart with one RENTAL_ONLY line is refused as a whole (no partial sale)', async () => {
    const { service, tx } = makeService({ ok: 'PURCHASE_ONLY', ro: 'RENTAL_ONLY' });
    await expectRentalOnlyRejection(service.createSale(sale(['ok', 'ro']) as any, 'cashier-1'), ['Gown ro']);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('layaway with a RENTAL_ONLY item is refused', async () => {
    const { service, tx } = makeService({ ro: 'RENTAL_ONLY' });
    await expectRentalOnlyRejection(
      service.createLayaway({ customerId: 'u1', items: sale(['ro']).items, depositAmount: 0, depositMethod: 'CASH' } as any, 'cashier-1'),
      ['Gown ro'],
    );
    expect(tx.layaway.create).not.toHaveBeenCalled();
  });

  it('exchange replacement item that is RENTAL_ONLY is refused before any write', async () => {
    const { service, prisma } = makeService({ ro: 'RENTAL_ONLY' });
    await expectRentalOnlyRejection(
      service.createExchange({
        originalOrderId: 'o-orig',
        returnedItems: [{ orderItemId: 'oi1', quantity: 1 }],
        newItems: [{ productId: 'p-ro', variantId: 'v-ro', quantity: 1, unitPrice: 1000 }],
      } as any, 'cashier-1'),
      ['Gown ro'],
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PURCHASE_ONLY and BOTH keep their purchase behaviour', () => {
  it.each(['PURCHASE_ONLY', 'BOTH', undefined] as const)('%s sells normally (order, payment, stock decrement)', async (mode) => {
    const { service, tx } = makeService({ x: mode });
    await service.createSale(sale(['x']) as any, 'cashier-1');
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'v-x', tenantId: 't1', stock: { gte: 1 } },
      data: { stock: { decrement: 1 } },
    });
  });

  it('BOTH + PURCHASE_ONLY together in one cart sell normally', async () => {
    const { service, tx } = makeService({ a: 'BOTH', b: 'PURCHASE_ONLY' });
    await service.createSale(sale(['a', 'b']) as any, 'cashier-1');
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });
});

describe('catalog + UI wiring', () => {
  it('the offline POS catalog carries availabilityMode so the device can block rental-only items', async () => {
    const prisma: any = {
      product: {
        findMany: jest.fn(async () => [
          { id: 'p1', name: 'G', sku: null, availabilityMode: 'RENTAL_ONLY', category: null, images: [], variants: [{ id: 'v1', name: 'S', sku: 's', barcode: null, size: null, color: null, colorHex: null, price: 1, stock: 1 }] },
        ]),
      },
    };
    const service = new PosService(prisma, { requireId: 't1' } as any);
    const cat = await service.getCatalog();
    expect(prisma.product.findMany.mock.calls[0][0].select.availabilityMode).toBe(true);
    expect(cat.products[0].availabilityMode).toBe('RENTAL_ONLY');
  });

  const ADMIN = join(__dirname, '..', '..', '..', 'admin');
  it('admin helper mirrors the API rule', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ui = require(join(ADMIN, 'lib', 'pos-sale-eligibility'));
    for (const m of ['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH', undefined]) {
      expect(ui.isSellableAtPos(m)).toBe(isSellableAtPos(m));
    }
  });
  it('POS search/scan and the exchange picker both check the sale rule', () => {
    const search = readFileSync(join(ADMIN, 'app/dashboard/pos/components/ProductSearch.tsx'), 'utf8');
    expect(search).toMatch(/posSaleBlock\(product\.availabilityMode, offline \|\| usingLocal\)\) return;/); // add-by-click
    expect(search).toMatch(/posSaleBlock\(hit\.product\.availabilityMode, true\)/); // device-catalog scan = offline
    expect(search).toMatch(/posSaleBlock\(variant\.product\?\.availabilityMode\) === 'RENTAL_ONLY'/); // online scan
    const exchange = readFileSync(join(ADMIN, 'app/dashboard/pos/components/ExchangeModal.tsx'), 'utf8');
    expect(exchange).toMatch(/if \(!isSellableAtPos\(product\?\.availabilityMode\)\) return;/);
  });
});

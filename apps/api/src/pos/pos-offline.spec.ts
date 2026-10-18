import { BadRequestException } from '@nestjs/common';
import {
  PosService,
  assertOfflinePayments,
  resolveClientCreatedAt,
} from './pos.service';

/**
 * Offline POS sales (admin offline mode, Phase 2). An offline sale is a
 * replay of a sale the cashier already took cash for, so it must never be
 * rejected for short stock — stock is clamped at 0 and the order flagged
 * `oversold`. Online sales keep rejecting short stock.
 */

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

function makeService(opts: { stock?: number; session?: any; sessionById?: any } = {}) {
  let stock = opts.stock ?? 1;
  const stockWrites: any[] = [];

  const stockFilterOk = (f: any) => {
    if (f === undefined) return true;
    if (typeof f === 'number') return stock === f;
    if (f.gte !== undefined && !(stock >= f.gte)) return false;
    if (f.equals !== undefined && stock !== f.equals) return false;
    return true;
  };

  const tx: any = {
    order: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'o1',
        ...data,
        isOfflineSale: data.isOfflineSale ?? false,
        oversold: false,
        oversoldDetails: null,
        items: [],
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: { create: jest.fn().mockResolvedValue({}) },
    productVariant: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!stockFilterOk(where.stock)) return { count: 0 };
        stock -= data.stock.decrement;
        stockWrites.push({ where, data });
        return { count: 1 };
      }),
      findFirst: jest.fn(async () => ({ stock })),
    },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    posSession: { update: jest.fn().mockResolvedValue({}) },
  };

  const openSession = opts.session === undefined
    ? { id: 'sess-open', adminUserId: 'cashier-1', openedAt: minutesAgo(120), closedAt: null, status: 'OPEN' }
    : opts.session;

  const prisma: any = {
    posSession: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) {
          const s = opts.sessionById;
          if (!s) return null;
          // Emulate the tenant + cashier filter of the real query.
          return s.id === where.id && s.tenantId === where.tenantId && s.adminUserId === where.adminUserId ? s : null;
        }
        return openSession;
      }),
    },
    productVariant: {
      findMany: jest.fn(async () => [
        { id: 'v1', productId: 'p1', stock, price: 1000, name: 'M', product: { id: 'p1', name: 'Gown' } },
      ]),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const service = new PosService(prisma, { requireId: 't1' } as any);
  return { service, prisma, tx, getStock: () => stock, stockWrites };
}

const sale = (overrides: any = {}) => ({
  items: [{ productId: 'p1', variantId: 'v1', quantity: 3, unitPrice: 1000 }],
  payments: [{ method: 'CASH', amount: 3000 }],
  ...overrides,
});

describe('PosService.createSale — offline sales', () => {
  it('offline sale with short stock is accepted: stock clamps to 0, order flagged oversold', async () => {
    const { service, tx, getStock } = makeService({ stock: 1 });
    const clientCreatedAt = minutesAgo(30).toISOString();

    const res: any = await service.createSale(sale({ offline: true, clientCreatedAt }) as any, 'cashier-1');

    expect(getStock()).toBe(0); // never negative
    expect(res.oversold).toBe(true);
    expect(res.isOfflineSale).toBe(true);
    expect(res.oversoldDetails).toEqual([
      { productId: 'p1', variantId: 'v1', requested: 3, fulfilledFromStock: 1, shortfall: 2 },
    ]);
    const flag = tx.order.updateMany.mock.calls[0][0];
    expect(flag.where).toEqual({ id: 'o1', tenantId: 't1' });
    expect(flag.data.oversold).toBe(true);

    // Order + payments carry the real sale time.
    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.isOfflineSale).toBe(true);
    expect(orderData.createdAt.toISOString()).toBe(clientCreatedAt);
    expect(tx.payment.create.mock.calls[0][0].data.createdAt.toISOString()).toBe(clientCreatedAt);

    // Ledger records only what actually left stock.
    const inv = tx.inventoryTransaction.create.mock.calls[0][0].data;
    expect(inv).toMatchObject({ quantityBefore: 1, quantityChange: -1, quantityAfter: 0 });
    expect(inv.note).toMatch(/OVERSOLD by 2/);
  });

  it('offline sale with zero stock records full shortfall and writes nothing to stock', async () => {
    const { service, getStock, stockWrites } = makeService({ stock: 0 });
    const res: any = await service.createSale(sale({ offline: true }) as any, 'cashier-1');
    expect(getStock()).toBe(0);
    expect(stockWrites).toHaveLength(0);
    expect(res.oversoldDetails[0]).toMatchObject({ fulfilledFromStock: 0, shortfall: 3 });
  });

  it('offline sale with enough stock is a normal sale (not oversold)', async () => {
    const { service, tx, getStock } = makeService({ stock: 10 });
    const res: any = await service.createSale(sale({ offline: true }) as any, 'cashier-1');
    expect(getStock()).toBe(7);
    expect(res.oversold).toBe(false);
    expect(res.oversoldDetails).toBeNull();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('ONLINE sale still rejects short stock (unchanged behaviour)', async () => {
    const { service, prisma, getStock } = makeService({ stock: 1 });
    await expect(service.createSale(sale() as any, 'cashier-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(getStock()).toBe(1);
  });

  it('online sale ignores offline-only fields', async () => {
    const { service, tx } = makeService({ stock: 10 });
    await service.createSale(
      sale({ clientCreatedAt: minutesAgo(60).toISOString(), sessionId: 'whatever' }) as any,
      'cashier-1',
    );
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.createdAt).toBeUndefined();
    expect(data.isOfflineSale).toBeUndefined();
    expect(data.posSessionId).toBe('sess-open');
  });

  describe('sessionId window', () => {
    const closedShift = {
      id: 'sess-old',
      tenantId: 't1',
      adminUserId: 'cashier-1',
      openedAt: minutesAgo(600),
      closedAt: minutesAgo(300),
      status: 'CLOSED',
    };

    it('accepts a sale inside a since-closed shift and books it to that shift', async () => {
      const { service, tx } = makeService({ stock: 10, sessionById: closedShift, session: null });
      await service.createSale(
        sale({ offline: true, sessionId: 'sess-old', clientCreatedAt: minutesAgo(400).toISOString() }) as any,
        'cashier-1',
      );
      expect(tx.order.create.mock.calls[0][0].data.posSessionId).toBe('sess-old');
      expect(tx.payment.create.mock.calls[0][0].data.gatewayResponse.posSessionId).toBe('sess-old');
    });

    it('rejects a sale time after the shift closed', async () => {
      const { service } = makeService({ stock: 10, sessionById: closedShift });
      await expect(
        service.createSale(
          sale({ offline: true, sessionId: 'sess-old', clientCreatedAt: minutesAgo(100).toISOString() }) as any,
          'cashier-1',
        ),
      ).rejects.toThrow(/outside the selected shift/);
    });

    it('rejects a sale time before the shift opened', async () => {
      const { service } = makeService({ stock: 10, sessionById: closedShift });
      await expect(
        service.createSale(
          sale({ offline: true, sessionId: 'sess-old', clientCreatedAt: minutesAgo(700).toISOString() }) as any,
          'cashier-1',
        ),
      ).rejects.toThrow(/outside the selected shift/);
    });

    it("rejects another cashier's (or another tenant's) shift", async () => {
      const { service, prisma } = makeService({ stock: 10, sessionById: { ...closedShift, adminUserId: 'cashier-2' } });
      await expect(
        service.createSale(
          sale({ offline: true, sessionId: 'sess-old', clientCreatedAt: minutesAgo(400).toISOString() }) as any,
          'cashier-1',
        ),
      ).rejects.toThrow(/not found/);
      const where = prisma.posSession.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ id: 'sess-old', tenantId: 't1', adminUserId: 'cashier-1' });
    });

    it('without sessionId falls back to requiring a currently open shift', async () => {
      const { service } = makeService({ stock: 10, session: null });
      await expect(service.createSale(sale({ offline: true }) as any, 'cashier-1')).rejects.toThrow(
        /No open session/,
      );
    });
  });

  describe('payments', () => {
    it('card (needs a live terminal) is rejected offline with NEEDS_ONLINE_PAYMENT', async () => {
      const { service, prisma } = makeService({ stock: 10 });
      const err: any = await service
        .createSale(sale({ offline: true, payments: [{ method: 'CARD', amount: 3000, transactionRef: 'X1' }] }) as any, 'cashier-1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'NEEDS_ONLINE_PAYMENT' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('mobile money offline needs a transaction reference', () => {
      expect(() => assertOfflinePayments([{ method: 'MPESA' }])).toThrow(BadRequestException);
      expect(() => assertOfflinePayments([{ method: 'MPESA', transactionRef: '   ' }])).toThrow(BadRequestException);
      expect(() => assertOfflinePayments([{ method: 'MPESA', transactionRef: 'QK12AB' }])).not.toThrow();
      expect(() => assertOfflinePayments([{ method: 'CASH' }])).not.toThrow();
      expect(() => assertOfflinePayments([{ method: 'SOMETHING_NEW', transactionRef: 'x' }])).toThrow(
        BadRequestException,
      );
    });

    it('card is still fine ONLINE', async () => {
      const { service, tx } = makeService({ stock: 10 });
      await service.createSale(
        sale({ payments: [{ method: 'CARD', amount: 3000, transactionRef: 'X1' }] }) as any,
        'cashier-1',
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveClientCreatedAt', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    it('defaults to now', () => expect(resolveClientCreatedAt(undefined, now)).toBe(now));
    it('accepts a time within 30 days', () =>
      expect(resolveClientCreatedAt('2026-10-01T10:00:00Z', now).toISOString()).toBe('2026-10-01T10:00:00.000Z'));
    it('rejects > 5 min in the future', () =>
      expect(() => resolveClientCreatedAt('2026-10-18T10:06:00Z', now)).toThrow(BadRequestException));
    it('clamps small future skew to now', () =>
      expect(resolveClientCreatedAt('2026-10-18T10:03:00Z', now).getTime()).toBe(now.getTime()));
    it('rejects older than 30 days', () =>
      expect(() => resolveClientCreatedAt('2026-09-17T09:00:00Z', now)).toThrow(BadRequestException));
    it('rejects garbage', () => expect(() => resolveClientCreatedAt('nope', now)).toThrow(BadRequestException));
  });
});

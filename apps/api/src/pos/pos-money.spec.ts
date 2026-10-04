import { BadRequestException } from '@nestjs/common';
import {
  PosService,
  allocateChange,
  computeSaleTotals,
  refundValueForUnits,
} from './pos.service';

/**
 * POS money-path regressions (2026-10 review):
 *  - refunds/exchanges valued at NET price paid (item + order discounts)
 *  - refundedQuantity claimed atomically inside the tx (no stale absolute write)
 *  - exchanges bounded by remaining qty and blocked on refunded/cancelled sales
 *  - payment.amount = net (tendered − change); drawer math per session tag
 *  - no negative totals / out-of-range discounts
 */

describe('computeSaleTotals', () => {
  it('computes subtotal, discount and total', () => {
    const r = computeSaleTotals(
      [{ unitPrice: 10000, quantity: 2, itemDiscount: 1000 }, { unitPrice: 5000, quantity: 1 }],
      10,
      'PERCENTAGE',
    );
    expect(r.subtotal).toBe(24000);
    expect(r.discountAmount).toBe(2400);
    expect(r.total).toBe(21600);
    expect(r.lineTotals).toEqual([19000, 5000]);
  });

  it('rejects a FIXED discount larger than the subtotal (negative total)', () => {
    expect(() => computeSaleTotals([{ unitPrice: 1000, quantity: 1 }], 5000, 'FIXED')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a percentage discount above 100%', () => {
    expect(() => computeSaleTotals([{ unitPrice: 1000, quantity: 1 }], 150, 'PERCENTAGE')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an item discount larger than the line', () => {
    expect(() =>
      computeSaleTotals([{ unitPrice: 1000, quantity: 1, itemDiscount: 2000 }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a negative unit price and unknown discount types', () => {
    expect(() => computeSaleTotals([{ unitPrice: -1, quantity: 1 }])).toThrow(BadRequestException);
    expect(() => computeSaleTotals([{ unitPrice: 1, quantity: 1 }], 1, 'BOGUS')).toThrow(
      BadRequestException,
    );
  });
});

describe('refundValueForUnits', () => {
  // Line: 3 × 10,000 with 3,000 item discount → line total 27,000.
  // Order: subtotal 27,000, order discount 2,700 (10%) → paid 24,300.
  const item = { total: 27000, quantity: 3 };
  const order = { subtotal: 27000, discount: 2700 };

  it('values units at the net price paid, not unitPrice', () => {
    expect(refundValueForUnits(item, order, 0, 1)).toBe(8100);
    expect(refundValueForUnits(item, order, 0, 3)).toBe(24300);
  });

  it('successive partial refunds telescope exactly to what was paid', () => {
    const a = refundValueForUnits(item, order, 0, 1);
    const b = refundValueForUnits(item, order, 1, 1);
    const c = refundValueForUnits(item, order, 2, 1);
    expect(a + b + c).toBe(24300);
  });

  it('handles awkward rounding without exceeding the line', () => {
    const odd = { total: 10000, quantity: 3 };
    const o = { subtotal: 10000, discount: 0 };
    const sum =
      refundValueForUnits(odd, o, 0, 1) + refundValueForUnits(odd, o, 1, 1) + refundValueForUnits(odd, o, 2, 1);
    expect(Math.round(sum * 100) / 100).toBe(10000);
  });
});

describe('allocateChange', () => {
  it('stores NET cash (tendered − change) and reports change', () => {
    const r = allocateChange([{ method: 'CASH', amount: 50000 }], 42000);
    expect(r.net).toEqual([42000]);
    expect(r.change).toEqual([8000]);
    expect(r.changeDue).toBe(8000);
  });

  it('takes change from cash in a split payment', () => {
    const r = allocateChange(
      [{ method: 'MPESA', amount: 20000 }, { method: 'CASH', amount: 30000 }],
      42000,
    );
    expect(r.net).toEqual([20000, 22000]);
  });

  it('rejects underpayment and non-cash overpayment', () => {
    expect(() => allocateChange([{ method: 'CASH', amount: 100 }], 200)).toThrow(BadRequestException);
    expect(() => allocateChange([{ method: 'MPESA', amount: 300 }], 200)).toThrow(BadRequestException);
  });
});

// ------------------------------------------------------------------
// Service-level tests with a fake Prisma transaction
// ------------------------------------------------------------------

function makeOrder(overrides: any = {}) {
  return {
    id: 'order-1',
    tenantId: 't1',
    orderNumber: 'POS-1',
    channel: 'POS',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    subtotal: 27000,
    discount: 2700,
    total: 24300,
    userId: null,
    customerName: null,
    customerPhone: null,
    items: [
      {
        id: 'item-1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 3,
        unitPrice: 10000,
        total: 27000,
        refundedQuantity: 0,
        product: { name: 'Gown' },
        variant: { name: 'M' },
      },
    ],
    payments: [],
    ...overrides,
  };
}

function makeService(order: any, opts: { claimCount?: number; session?: any } = {}) {
  const tx: any = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'new-order' }),
    },
    orderItem: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(order.items.map((i: any) => ({ quantity: i.quantity, refundedQuantity: i.quantity }))),
      ),
    },
    productVariant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ stock: 5 }),
    },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    payment: { create: jest.fn().mockResolvedValue({}) },
    posExchange: { create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)) },
  };
  const session = opts.session === undefined ? { id: 'sess-1', openingCash: 0 } : opts.session;
  const prisma: any = {
    posSession: { findFirst: jest.fn().mockResolvedValue(session) },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { aggregate: jest.fn() },
    $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const tenantContext: any = { requireId: 't1' };
  return { service: new PosService(prisma, tenantContext), prisma, tx };
}

describe('PosService.refundSale', () => {
  it('refunds a discounted sale at the net amount paid and passes the cap', async () => {
    const { service, tx } = makeService(makeOrder());
    const res = await service.refundSale('order-1', { refundMethod: 'CASH' } as any, 'cashier');
    expect(res.refundAmount).toBe(24300); // not 30,000 (unitPrice × qty)
    expect(res.isFullRefund).toBe(true);
    const pay = tx.payment.create.mock.calls[0][0].data;
    expect(pay.status).toBe('REFUNDED');
    expect(pay.amount).toBe(24300);
    expect(pay.gatewayResponse.posSessionId).toBe('sess-1');
  });

  it('claims refundedQuantity with an atomic guarded increment inside the tx', async () => {
    const { service, tx } = makeService(makeOrder());
    await service.refundSale(
      'order-1',
      { refundMethod: 'MPESA', items: [{ orderItemId: 'item-1', quantity: 2 }] } as any,
      'cashier',
    );
    const args = tx.orderItem.updateMany.mock.calls[0][0];
    expect(args.where.refundedQuantity).toEqual({ lte: 1 }); // quantity 3 − 2
    expect(args.data.refundedQuantity).toEqual({ increment: 2 });
    expect(tx.order.findFirst).toHaveBeenCalled(); // read inside tx
  });

  it('fails (rolls back) when a concurrent refund already claimed the units', async () => {
    const { service, tx } = makeService(makeOrder(), { claimCount: 0 });
    await expect(
      service.refundSale(
        'order-1',
        { refundMethod: 'MPESA', items: [{ orderItemId: 'item-1', quantity: 1 }] } as any,
        'cashier',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a cash refund with no open shift', async () => {
    const { service } = makeService(makeOrder(), { session: null });
    await expect(
      service.refundSale('order-1', { refundMethod: 'CASH' } as any, 'cashier'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects refunding more than the remaining quantity', async () => {
    const order = makeOrder();
    order.items[0].refundedQuantity = 2;
    const { service } = makeService(order);
    await expect(
      service.refundSale(
        'order-1',
        { refundMethod: 'MPESA', items: [{ orderItemId: 'item-1', quantity: 2 }] } as any,
        'cashier',
      ),
    ).rejects.toThrow(/remaining 1/);
  });
});

describe('PosService.createExchange', () => {
  const dto = (q = 1) => ({
    originalOrderId: 'order-1',
    returnedItems: [{ orderItemId: 'item-1', quantity: q }],
    newItems: [],
    settlementMethod: 'CASH',
  });

  it('rejects exchanging a refunded or cancelled sale', async () => {
    for (const status of ['REFUNDED', 'CANCELLED']) {
      const { service } = makeService(makeOrder({ status }));
      await expect(service.createExchange(dto() as any, 'cashier')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('rejects non-POS originals', async () => {
    const { service } = makeService(makeOrder({ channel: 'ONLINE' }));
    await expect(service.createExchange(dto() as any, 'cashier')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bounds by REMAINING qty (already refunded units cannot be exchanged again)', async () => {
    const order = makeOrder();
    order.items[0].refundedQuantity = 3;
    const { service } = makeService(order);
    await expect(service.createExchange(dto(1) as any, 'cashier')).rejects.toThrow(/remaining 0/);
  });

  it('claims refundedQuantity atomically and credits the net price', async () => {
    const { service, tx } = makeService(makeOrder());
    const ex: any = await service.createExchange(dto(1) as any, 'cashier');
    const claim = tx.orderItem.updateMany.mock.calls[0][0];
    expect(claim.where.refundedQuantity).toEqual({ lte: 2 });
    expect(claim.data.refundedQuantity).toEqual({ increment: 1 });
    expect(ex.returnTotal).toBe(8100);
    // Customer is owed → REFUNDED payment on the original order, drawer-tagged.
    const pay = tx.payment.create.mock.calls[0][0].data;
    expect(pay).toMatchObject({ orderId: 'order-1', status: 'REFUNDED', amount: 8100, method: 'CASH' });
    expect(pay.gatewayResponse.posSessionId).toBe('sess-1');
  });

  it('a concurrent exchange of the same line loses (claim count 0)', async () => {
    const { service } = makeService(makeOrder(), { claimCount: 0 });
    await expect(service.createExchange(dto(1) as any, 'cashier')).rejects.toThrow(/concurrently/);
  });
});

describe('PosService.closeSession — expected cash', () => {
  it('= opening + net cash in − cash refunded, keyed by the session tag', async () => {
    const session = { id: 'sess-1', openingCash: 10000, tenantId: 't1', notes: null };
    const prisma: any = {
      posSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      },
      payment: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: 50000 } }) // COMPLETED cash (net)
          .mockResolvedValueOnce({ _sum: { amount: 8000 } }), // REFUNDED cash
      },
    };
    const service = new PosService(prisma, { requireId: 't1' } as any);
    const res: any = await service.closeSession('cashier', { closingCash: 52000 } as any);
    expect(res.expectedCash).toBe(52000);
    expect(res.cashDifference).toBe(0);
    const [inArgs, outArgs] = prisma.payment.aggregate.mock.calls.map((c: any) => c[0]);
    expect(inArgs.where).toMatchObject({
      tenantId: 't1',
      method: 'CASH',
      status: 'COMPLETED',
      gatewayResponse: { path: ['posSessionId'], equals: 'sess-1' },
    });
    expect(outArgs.where.status).toBe('REFUNDED');
  });
});

describe('PosService.layawayPayment / completeLayaway idempotency', () => {
  function layawayService(claimCount: number) {
    const tx: any = {
      layaway: {
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: 'COMPLETED', balanceDue: 0 }),
      },
      payment: { create: jest.fn() },
    };
    const prisma: any = {
      posSession: { findFirst: jest.fn().mockResolvedValue({ id: 'sess-1' }) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    };
    return { service: new PosService(prisma, { requireId: 't1' } as any), tx };
  }

  it('layaway payment is a guarded increment; a lost race records no payment', async () => {
    const { service, tx } = layawayService(0);
    await expect(
      service.layawayPayment('l1', { amount: 1000, method: 'CASH' } as any, 'cashier'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const args = tx.layaway.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: 'l1', tenantId: 't1', status: 'ACTIVE', balanceDue: { gte: 1000 } });
    expect(args.data.balanceDue).toEqual({ decrement: 1000 });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('second completeLayaway call is rejected by the ACTIVE→COMPLETED claim', async () => {
    const { service, tx } = layawayService(0);
    await expect(service.completeLayaway('l1', 'cashier')).rejects.toThrow(/no longer active/);
    expect(tx.layaway.updateMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });
});

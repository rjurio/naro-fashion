import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderExpiryCron } from './order-expiry.cron';
import { PromoCodesService } from '../promo-codes/promo-codes.service';

/**
 * Regression #6 (Oct 2026 review) — online order integrity:
 *  (a) cart read + stock reservation + cart clear in ONE tx, serialized per
 *      user by pg_advisory_xact_lock
 *  (b) cancel restock only when the conditional status flip wins
 *  (c) inactive/archived variants & products rejected
 *  (d) productId derived from the variant, never the cart row
 *  (e) customers can't cancel PAID orders; admin cancel → REFUND_PENDING
 *  (f) server-side shipping fee (+ SiteSetting override, client fee ignored)
 *  (g) promo applied + guarded usage increment inside the tx
 *  (h) flash-sale price used for line items
 *  (i) expiry cron + COD cap
 */
const T = 'tenant_a';
const USER = 'user_1';
const customer = { id: USER, tenantId: T };
const admin = { id: 'admin_1', tenantId: T, isAdmin: true };

function liveVariant(over: any = {}) {
  return {
    id: 'v1',
    tenantId: T,
    productId: 'p_real',
    price: 10000,
    isActive: true,
    stock: 5,
    product: { id: 'p_real', tenantId: T, name: 'Gown', isActive: true, deletedAt: null, archivedAt: null, availabilityMode: 'BOTH' },
    ...over,
  };
}

function makePrisma(cart: any[]) {
  const prisma: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    cartItem: { findMany: jest.fn().mockResolvedValue(cart), deleteMany: jest.fn().mockResolvedValue({ count: cart.length }) },
    order: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'o1', ...a.data })),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue([{ productId: 'p_real', variantId: 'v1', quantity: 2, refundedQuantity: 0 }]) },
    flashSaleItem: { findMany: jest.fn().mockResolvedValue([]) },
    siteSetting: { findFirst: jest.fn().mockResolvedValue(null) },
    tenantModule: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    promoCode: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    promoCodeUsage: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    productVariant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ stock: 3 }),
    },
    inventoryTransaction: { create: jest.fn() },
    address: {
      findFirst: jest.fn().mockResolvedValue({ id: 'addr1' }),
      create: jest.fn().mockResolvedValue({ id: 'addr_new' }),
    },
    payment: { count: jest.fn().mockResolvedValue(0) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

function makeService(prisma: any) {
  const tenantContext: any = { requireId: T };
  const promo = new PromoCodesService(prisma, tenantContext);
  const svc = new OrdersService(prisma, tenantContext, { log: jest.fn() } as any, promo);
  return { svc, promo };
}

describe('OrdersService.create', () => {
  it('(a) takes a per-user advisory lock and reads the cart INSIDE the transaction', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    const order: string[] = [];
    prisma.$executeRaw.mockImplementation(() => { order.push('lock'); return Promise.resolve(1); });
    prisma.cartItem.findMany.mockImplementation(() => { order.push('cart'); return Promise.resolve([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]); });
    prisma.$transaction.mockImplementation((fn: any) => { order.push('tx'); return fn(prisma); });
    const { svc } = makeService(prisma);
    await svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any);
    expect(order.slice(0, 3)).toEqual(['tx', 'lock', 'cart']);
    const sql = (prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(prisma.$executeRaw.mock.calls[0]).toContain(USER);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
  });

  it('(a) a second submit after the cart was cleared gets "Cart is empty"', async () => {
    const prisma = makePrisma([]);
    const { svc } = makeService(prisma);
    await expect(svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any)).rejects.toThrow('Cart is empty');
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('(c) rejects inactive variants and archived products', async () => {
    for (const v of [liveVariant({ isActive: false }), liveVariant({ product: { ...liveVariant().product, isActive: false, archivedAt: new Date() } })]) {
      const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: v }]);
      const { svc } = makeService(prisma);
      await expect(svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    }
  });

  it('(c) rejects a variant from another tenant', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant({ tenantId: 'tenant_b' }) }]);
    const { svc } = makeService(prisma);
    await expect(svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('(d) derives productId from the variant, ignoring a tampered cart productId', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_TAMPERED', quantity: 1, variant: liveVariant() }]);
    const { svc } = makeService(prisma);
    await svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any);
    const items = prisma.order.create.mock.calls[0][0].data.items.create;
    expect(items[0].productId).toBe('p_real');
    expect(prisma.inventoryTransaction.create.mock.calls[0][0].data.productId).toBe('p_real');
  });

  it('(f) computes shipping server-side and ignores client shippingFee', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 2, variant: liveVariant() }]);
    const { svc } = makeService(prisma);
    const res: any = await svc.create(USER, { paymentMethod: 'MOBILE_MONEY', shippingFee: 0, deliveryMethod: 'express' } as any);
    expect(res.subtotal).toBe(20000);
    expect(res.shippingCost).toBe(15000);
    expect(res.shippingFee).toBe(15000);
    expect(res.total).toBe(35000);
  });

  it('(f) defaults: standard 5000, pickup 0; SiteSetting override wins', async () => {
    let prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    let res: any = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any);
    expect(res.shippingFee).toBe(5000);

    prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    res = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', deliveryMethod: 'pickup' } as any);
    expect(res.shippingFee).toBe(0);

    prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    prisma.siteSetting.findFirst.mockResolvedValue({ value: '7000' });
    res = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY' } as any);
    expect(prisma.siteSetting.findFirst.mock.calls[0][0].where).toEqual({ tenantId: T, key: 'delivery_fee_standard' });
    expect(res.shippingFee).toBe(7000);
  });

  it('(h) uses the active flash-sale price when lower than the variant price', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 2, variant: liveVariant() }]);
    prisma.flashSaleItem.findMany.mockResolvedValue([{ productId: 'p_real', salePrice: 6000 }]);
    const res: any = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', deliveryMethod: 'pickup' } as any);
    const where = prisma.flashSaleItem.findMany.mock.calls[0][0].where;
    expect(where.flashSale).toMatchObject({ tenantId: T, isActive: true, deletedAt: null });
    expect(res.items.create[0].unitPrice.toString()).toBe('6000');
    expect(res.subtotal).toBe(12000);
  });

  it('(g) applies a valid promo and records usage with a guarded increment in the same tx', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 2, variant: liveVariant() }]);
    const promoRow = {
      id: 'promo1', code: 'SAVE10', isActive: true, validFrom: new Date(0), validUntil: null,
      maxUses: 5, usedCount: 4, minOrderAmount: null, maxUsesPerUser: 1,
      discountType: 'PERCENTAGE', discountValue: 10, maxDiscountAmount: null,
    };
    prisma.promoCode.findFirst.mockResolvedValue(promoRow);
    const res: any = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', deliveryMethod: 'pickup', promoCode: 'save10' } as any);
    expect(res.discount).toBe(2000);
    expect(res.total).toBe(18000);
    expect(res.promoCodeId).toBe('promo1');
    expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'promo1', tenantId: T, usedCount: { lt: 5 } },
      data: { usedCount: { increment: 1 } },
    });
    expect(prisma.promoCodeUsage.create).toHaveBeenCalledWith({ data: { promoCodeId: 'promo1', userId: USER, orderId: 'o1' } });
  });

  it('(g) losing the last promo use rolls the order back (400)', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    prisma.promoCode.findFirst.mockResolvedValue({
      id: 'promo1', code: 'X', isActive: true, validFrom: new Date(0), validUntil: null, maxUses: 1, usedCount: 0,
      minOrderAmount: null, maxUsesPerUser: 1, discountType: 'FIXED', discountValue: 1000, maxDiscountAmount: null,
    });
    prisma.promoCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', promoCode: 'X' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('(g) an invalid promo is a 400, fixed discounts never exceed subtotal', async () => {
    let prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    prisma.promoCode.findFirst.mockResolvedValue(null);
    await expect(makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', promoCode: 'NOPE' } as any)).rejects.toThrow('Invalid promo code');

    prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    prisma.promoCode.findFirst.mockResolvedValue({
      id: 'p', code: 'BIG', isActive: true, validFrom: new Date(0), validUntil: null, maxUses: null, usedCount: 0,
      minOrderAmount: null, maxUsesPerUser: 1, discountType: 'FIXED', discountValue: 999999, maxDiscountAmount: null,
    });
    const res: any = await makeService(prisma).svc.create(USER, { paymentMethod: 'MOBILE_MONEY', deliveryMethod: 'pickup', promoCode: 'BIG' } as any);
    expect(res.discount).toBe(10000);
    expect(res.total).toBe(0);
    expect(prisma.promoCode.updateMany.mock.calls[0][0].where.usedCount).toBeUndefined();
  });

  it('(i) caps open unpaid COD orders per customer', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    prisma.order.count.mockResolvedValue(3);
    await expect(makeService(prisma).svc.create(USER, { paymentMethod: 'CASH_ON_DELIVERY' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.count.mock.calls[0][0].where).toMatchObject({ tenantId: T, userId: USER, paymentMethod: 'CASH_ON_DELIVERY' });
  });

  it('persists an inline shippingAddress as an Address row and links it', async () => {
    const prisma = makePrisma([{ variantId: 'v1', productId: 'p_real', quantity: 1, variant: liveVariant() }]);
    await makeService(prisma).svc.create(USER, {
      paymentMethod: 'MOBILE_MONEY',
      shippingAddress: { name: 'Asha', phone: '0712', street: 'Mtaa 1', city: 'Dar', region: 'Dar es Salaam' },
    } as any);
    expect(prisma.address.create.mock.calls[0][0].data).toMatchObject({ userId: USER, fullName: 'Asha', city: 'Dar' });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.addressId).toBe('addr_new');
    expect(data.notes).toMatch(/Ship to: Asha/);
  });
});

describe('OrdersService.updateStatus (cancel)', () => {
  function setup(orderRow: any) {
    const prisma = makePrisma([]);
    prisma.order.findFirst.mockResolvedValue(orderRow);
    return { prisma, svc: makeService(prisma).svc };
  }
  const base = { id: 'o1', tenantId: T, userId: USER, status: 'PENDING', paymentStatus: 'PENDING', channel: 'ONLINE', promoCodeId: null };

  it('(e) customer cannot cancel a PAID order', async () => {
    const { prisma, svc } = setup({ ...base, paymentStatus: 'PAID' });
    await expect(svc.updateStatus('o1', 'CANCELLED', customer)).rejects.toThrow('Paid orders must be cancelled by the shop');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('(e) admin cancel of a PAID order sets REFUND_PENDING and restocks', async () => {
    const { prisma, svc } = setup({ ...base, paymentStatus: 'PAID', status: 'CONFIRMED' });
    await svc.updateStatus('o1', 'CANCELLED', admin);
    expect(prisma.order.updateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELLED', paymentStatus: 'REFUND_PENDING' });
    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', tenantId: T },
      data: { stock: { increment: 2 } },
    });
  });

  it('(e) admin cancel keeps refund state: PARTIALLY_REFUNDED → REFUND_PENDING, REFUNDED stays REFUNDED', async () => {
    const a = setup({ ...base, paymentStatus: 'PARTIALLY_REFUNDED', status: 'CONFIRMED' });
    await a.svc.updateStatus('o1', 'CANCELLED', admin);
    expect(a.prisma.order.updateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELLED', paymentStatus: 'REFUND_PENDING' });

    const b = setup({ ...base, paymentStatus: 'REFUNDED', status: 'CONFIRMED' });
    await b.svc.updateStatus('o1', 'CANCELLED', admin);
    expect(b.prisma.order.updateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
  });

  it('(e) customer cannot cancel a PARTIALLY_REFUNDED order (money still held)', async () => {
    const { prisma, svc } = setup({ ...base, paymentStatus: 'PARTIALLY_REFUNDED' });
    await expect(svc.updateStatus('o1', 'CANCELLED', customer)).rejects.toThrow('Paid orders must be cancelled by the shop');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('(b) conditional flip: restocks only when the flip wins', async () => {
    const { prisma, svc } = setup(base);
    await svc.updateStatus('o1', 'CANCELLED', customer);
    const where = prisma.order.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'o1', tenantId: T, userId: USER, paymentStatus: 'PENDING' });
    expect(where.status).toEqual({ in: ['PENDING', 'CONFIRMED', 'PROCESSING'] });
    expect(prisma.productVariant.updateMany).toHaveBeenCalledTimes(1);
  });

  it('(b) a concurrent second cancel (flip count 0) does NOT restock', async () => {
    const { prisma, svc } = setup(base);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.updateStatus('o1', 'CANCELLED', customer)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('cancel releases a promo redemption', async () => {
    const { prisma, svc } = setup({ ...base, promoCodeId: 'promo1' });
    prisma.promoCodeUsage.deleteMany.mockResolvedValue({ count: 1 });
    await svc.updateStatus('o1', 'CANCELLED', customer);
    expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'promo1', tenantId: T, usedCount: { gte: 1 } },
      data: { usedCount: { decrement: 1 } },
    });
  });
});

describe('OrderExpiryCron (i)', () => {
  it('cancels stale unpaid non-COD online orders with the conditional pattern and restocks', async () => {
    const prisma = makePrisma([]);
    prisma.order.findMany = jest.fn().mockResolvedValue([{ id: 'o1', tenantId: T, promoCodeId: null }]);
    const cron = new OrderExpiryCron(prisma);
    const now = new Date('2026-10-04T12:00:00Z');
    const n = await cron.expireStaleOrders(now);
    expect(n).toBe(1);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ channel: 'ONLINE', status: 'PENDING', paymentMethod: { not: 'CASH_ON_DELIVERY' } });
    expect(where.createdAt.lt.toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(prisma.order.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'o1', tenantId: T, status: 'PENDING' });
    expect(prisma.productVariant.updateMany).toHaveBeenCalled();
  });

  it('skips orders with a recent PENDING/PROCESSING payment', async () => {
    const prisma = makePrisma([]);
    prisma.order.findMany = jest.fn().mockResolvedValue([{ id: 'o1', tenantId: T, promoCodeId: null }]);
    prisma.payment.count.mockResolvedValue(1);
    const n = await new OrderExpiryCron(prisma).expireStaleOrders();
    expect(n).toBe(0);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('does not restock when the flip loses (payment landed concurrently)', async () => {
    const prisma = makePrisma([]);
    prisma.order.findMany = jest.fn().mockResolvedValue([{ id: 'o1', tenantId: T, promoCodeId: null }]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    const n = await new OrderExpiryCron(prisma).expireStaleOrders();
    expect(n).toBe(0);
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('honours ORDER_PAYMENT_TTL_HOURS', () => {
    const prev = process.env.ORDER_PAYMENT_TTL_HOURS;
    process.env.ORDER_PAYMENT_TTL_HOURS = '6';
    expect(new OrderExpiryCron({} as any).ttlHours()).toBe(6);
    process.env.ORDER_PAYMENT_TTL_HOURS = prev;
  });
});

describe('PromoCodesService.validate contract', () => {
  it('returns { valid:false, discount:0, message } for an unknown code (HTTP 200)', async () => {
    const prisma: any = { promoCode: { findFirst: jest.fn().mockResolvedValue(null) }, promoCodeUsage: { count: jest.fn() } };
    const svc = new PromoCodesService(prisma, { requireId: T } as any);
    await expect(svc.validate({ code: 'x', subtotal: 1000 } as any)).resolves.toMatchObject({ valid: false, discount: 0, message: 'Invalid promo code' });
  });
  it('accepts legacy orderAmount and returns discount + discountAmount', async () => {
    const prisma: any = {
      promoCode: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p', code: 'TEN', isActive: true, validFrom: new Date(0), validUntil: null, maxUses: null, usedCount: 0,
          minOrderAmount: 5000, maxUsesPerUser: 1, discountType: 'PERCENTAGE', discountValue: 10, maxDiscountAmount: null,
        }),
      },
      promoCodeUsage: { count: jest.fn() },
    };
    const svc = new PromoCodesService(prisma, { requireId: T } as any);
    await expect(svc.validate({ code: 'ten', orderAmount: 20000 } as any)).resolves.toMatchObject({ valid: true, discount: 2000, discountAmount: 2000 });
    await expect(svc.validate({ code: 'ten', subtotal: 1000 } as any)).resolves.toMatchObject({ valid: false });
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OrderRefundsService, nextPaymentStatusAfterRefund } from './order-refunds.service';
import { OrderRefundsController } from './order-refunds.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { SelcomProvider } from '../payments/selcom.provider';
import { ClickPesaProvider } from '../payments/clickpesa.provider';
import { MONEY_COLLECTED_PAYMENT_STATUSES } from './order-lifecycle.util';

/**
 * Order refund workflow (POST/GET /orders/:id/refunds):
 *  - cap: amount ≤ Σ COMPLETED − Σ REFUNDED, computed inside the tx
 *  - serialized with pg_advisory_xact_lock(hashtext('refund:order:'||id))
 *  - status transitions REFUND_PENDING/PAID/PARTIAL → REFUNDED | PARTIALLY_REFUNDED
 *  - GATEWAY refunds 400 while providers report { supported: false }
 *  - tenant-scoped lookups; `orders:refund` permission metadata
 */
const T = 'tenant_a';
const ADMIN = { id: 'admin_1', tenantId: T, isAdmin: true, firstName: 'Faith', lastName: 'Urio' };

function makePrisma(opts: {
  order?: any;
  completed?: number;
  refunded?: number;
  flipCount?: number;
  sourcePayment?: any;
  refClash?: boolean;
} = {}) {
  const order =
    opts.order === undefined
      ? { id: 'o1', orderNumber: 'NARO-1', paymentStatus: 'REFUND_PENDING', channel: 'ONLINE', status: 'CANCELLED' }
      : opts.order;
  const prisma: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: opts.flipCount ?? 1 }),
    },
    payment: {
      aggregate: jest.fn().mockImplementation((a: any) =>
        Promise.resolve({
          _sum: { amount: a.where.status === 'COMPLETED' ? opts.completed ?? 50000 : opts.refunded ?? 0 },
        }),
      ),
      findFirst: jest.fn().mockImplementation((a: any) => {
        if (a.where.transactionRef) return Promise.resolve(opts.refClash ? { id: 'px' } : null);
        if (a.where.providerCode) return Promise.resolve(opts.sourcePayment ?? null);
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'refund_1', createdAt: new Date(), ...a.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentMethod: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

function makeService(prisma: any, registry?: any) {
  const audit = { log: jest.fn() };
  const config: any = { get: (_k: string, d?: any) => d };
  const reg =
    registry ??
    (() => {
      const selcom = new SelcomProvider(config);
      const clickpesa = new ClickPesaProvider(config);
      const map: Record<string, any> = { SELCOM: selcom, CLICKPESA_MIXX: clickpesa };
      return { has: (c: string) => !!map[c], resolve: (c: string) => map[c] };
    })();
  const svc = new OrderRefundsService(prisma, { requireId: T } as any, audit as any, reg);
  return { svc, audit };
}

describe('nextPaymentStatusAfterRefund', () => {
  it('full refund → REFUNDED from any refundable state', () => {
    for (const s of ['REFUND_PENDING', 'PAID', 'PARTIAL', 'PARTIALLY_REFUNDED']) {
      expect(nextPaymentStatusAfterRefund(s, 50000, 50000)).toBe('REFUNDED');
    }
  });
  it('partial refund keeps REFUND_PENDING, otherwise PARTIALLY_REFUNDED', () => {
    expect(nextPaymentStatusAfterRefund('REFUND_PENDING', 50000, 10000)).toBe('REFUND_PENDING');
    expect(nextPaymentStatusAfterRefund('PAID', 50000, 10000)).toBe('PARTIALLY_REFUNDED');
    expect(nextPaymentStatusAfterRefund('PARTIAL', 50000, 10000)).toBe('PARTIALLY_REFUNDED');
    expect(nextPaymentStatusAfterRefund('PARTIALLY_REFUNDED', 40000, 10000)).toBe('PARTIALLY_REFUNDED');
  });
});

describe('OrderRefundsService.createRefund', () => {
  it('takes the per-order advisory lock BEFORE reading the order/balances, inside the tx', async () => {
    const prisma = makePrisma();
    const seq: string[] = [];
    prisma.$transaction.mockImplementation((fn: any) => { seq.push('tx'); return fn(prisma); });
    prisma.$executeRaw.mockImplementation(() => { seq.push('lock'); return Promise.resolve(1); });
    prisma.order.findFirst.mockImplementation(() => {
      seq.push('order');
      return Promise.resolve({ id: 'o1', orderNumber: 'NARO-1', paymentStatus: 'REFUND_PENDING', channel: 'ONLINE' });
    });
    const { svc } = makeService(prisma);
    await svc.createRefund('o1', { amount: 1000, method: 'CASH' } as any, ADMIN);
    expect(seq.slice(0, 3)).toEqual(['tx', 'lock', 'order']);
    const sql = (prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('refund:order:' \|\| \?::text\)\)/);
    expect(prisma.$executeRaw.mock.calls[0]).toContain('o1');
  });

  it('records a positive REFUNDED payment with kind ORDER_REFUND and audits before/after', async () => {
    const prisma = makePrisma({ completed: 50000, refunded: 0 });
    const { svc, audit } = makeService(prisma);
    const res = await svc.createRefund('o1', { amount: 50000, method: 'MOBILE_MONEY', reference: ' MP123 ', note: 'Cancelled' } as any, ADMIN);
    const data = prisma.payment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: T,
      orderId: 'o1',
      amount: 50000,
      method: 'MOBILE_MONEY',
      status: 'REFUNDED',
      transactionRef: 'MP123',
      gatewayResponse: { kind: 'ORDER_REFUND', refundedBy: 'admin_1', note: 'Cancelled' },
    });
    expect(res.paymentStatus).toBe('REFUNDED');
    expect(res.refundable).toBe(0);
    expect(audit.log).toHaveBeenCalledWith(
      'REFUND',
      'Order',
      'o1',
      expect.objectContaining({
        before: { paymentStatus: 'REFUND_PENDING', totalRefunded: 0, refundable: 50000 },
        after: { paymentStatus: 'REFUNDED', totalRefunded: 50000, refundable: 0 },
      }),
    );
  });

  it('stores a null transactionRef when no reference is given', async () => {
    const prisma = makePrisma();
    const { svc } = makeService(prisma);
    await svc.createRefund('o1', { amount: 100, method: 'CASH' } as any, ADMIN);
    expect(prisma.payment.create.mock.calls[0][0].data.transactionRef).toBeNull();
  });

  it('caps at collected − already refunded (COMPLETED and REFUNDED sums, tenant-scoped)', async () => {
    const prisma = makePrisma({ completed: 50000, refunded: 30000 });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 20000.01, method: 'CASH' } as any, ADMIN)).rejects.toThrow(/exceeds the refundable balance \(20000\)/);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    for (const call of prisma.payment.aggregate.mock.calls) {
      expect(call[0].where).toMatchObject({ tenantId: T, orderId: 'o1' });
    }
    const statuses = prisma.payment.aggregate.mock.calls.map((c: any) => c[0].where.status).sort();
    expect(statuses).toEqual(['COMPLETED', 'REFUNDED']);
  });

  it('allows exactly the remaining balance and then reports REFUNDED', async () => {
    const prisma = makePrisma({ completed: 50000, refunded: 30000, order: { id: 'o1', orderNumber: 'N', paymentStatus: 'PARTIALLY_REFUNDED', channel: 'ONLINE' } });
    const { svc } = makeService(prisma);
    const res = await svc.createRefund('o1', { amount: 20000, method: 'BANK_TRANSFER' } as any, ADMIN);
    expect(res.paymentStatus).toBe('REFUNDED');
    expect(prisma.order.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'o1', tenantId: T, paymentStatus: 'PARTIALLY_REFUNDED' },
      data: { paymentStatus: 'REFUNDED' },
    });
  });

  it('rejects when nothing is left to refund', async () => {
    const prisma = makePrisma({ completed: 50000, refunded: 50000, order: { id: 'o1', orderNumber: 'N', paymentStatus: 'PAID', channel: 'ONLINE' } });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 1, method: 'CASH' } as any, ADMIN)).rejects.toThrow(/Nothing left to refund/);
  });

  it('partial refund on a PAID (not cancelled) order → PARTIALLY_REFUNDED', async () => {
    const prisma = makePrisma({ order: { id: 'o1', orderNumber: 'N', paymentStatus: 'PAID', channel: 'ONLINE' } });
    const { svc } = makeService(prisma);
    const res = await svc.createRefund('o1', { amount: 5000, method: 'CASH' } as any, ADMIN);
    expect(res.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(res.refundable).toBe(45000);
  });

  it('partial refund on a REFUND_PENDING order stays REFUND_PENDING', async () => {
    const prisma = makePrisma();
    const { svc } = makeService(prisma);
    const res = await svc.createRefund('o1', { amount: 5000, method: 'CASH' } as any, ADMIN);
    expect(res.paymentStatus).toBe('REFUND_PENDING');
  });

  it.each(['PENDING', 'FAILED', 'CANCELLED', 'REFUNDED', 'UNPAID'])('rejects paymentStatus %s', async (ps) => {
    const prisma = makePrisma({ order: { id: 'o1', orderNumber: 'N', paymentStatus: ps, channel: 'ONLINE' } });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'CASH' } as any, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rejects POS sales (refunded from POS)', async () => {
    const prisma = makePrisma({ order: { id: 'o1', orderNumber: 'N', paymentStatus: 'PAID', channel: 'POS' } });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'CASH' } as any, ADMIN)).rejects.toThrow(/POS/);
  });

  it('rejects zero / negative amounts', async () => {
    for (const amount of [0, -5]) {
      const prisma = makePrisma();
      const { svc } = makeService(prisma);
      await expect(svc.createRefund('o1', { amount, method: 'CASH' } as any, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('tenant scoping: order lookup is by id AND tenantId; another tenant\'s order → 404', async () => {
    const prisma = makePrisma({ order: null });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o_other', { amount: 100, method: 'CASH' } as any, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'o_other', tenantId: T });
  });

  it('CAS on the validated paymentStatus — a racing cancel → 409, no refund row survives', async () => {
    const prisma = makePrisma({ flipCount: 0, order: { id: 'o1', orderNumber: 'N', paymentStatus: 'PAID', channel: 'ONLINE' } });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'CASH' } as any, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('duplicate reference within the tenant → 409', async () => {
    const prisma = makePrisma({ refClash: true });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'CASH', reference: 'MP1' } as any, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    const refLookup = prisma.payment.findFirst.mock.calls.find((c: any) => c[0].where.transactionRef);
    expect(refLookup[0].where).toEqual({ tenantId: T, transactionRef: 'MP1' });
  });

  it.each(['SELCOM', 'CLICKPESA_MIXX'])('GATEWAY via %s → 400 "record a manual refund" (provider unsupported)', async (code) => {
    const prisma = makePrisma({ sourcePayment: { providerCode: code, transactionRef: 'NARO-1', providerTransactionId: 'g1' } });
    const { svc, audit } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'GATEWAY' } as any, ADMIN)).rejects.toThrow(
      `Gateway refunds are not available for ${code}; record a manual refund`,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('GATEWAY with no completed gateway payment → 400 before any write', async () => {
    const prisma = makePrisma({ sourcePayment: null });
    const { svc } = makeService(prisma);
    await expect(svc.createRefund('o1', { amount: 100, method: 'GATEWAY' } as any, ADMIN)).rejects.toThrow(/record a manual refund/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('GATEWAY with a provider that supports refunds records the gateway reference', async () => {
    const provider = { refund: jest.fn().mockResolvedValue({ supported: true, success: true, refundReference: 'GW-R1', rawResponse: { ok: 1 } }) };
    const registry = { has: () => true, resolve: () => provider };
    const prisma = makePrisma({ sourcePayment: { providerCode: 'SELCOM', transactionRef: 'NARO-1', providerTransactionId: 'g1' } });
    const { svc } = makeService(prisma, registry);
    await svc.createRefund('o1', { amount: 100, method: 'GATEWAY' } as any, ADMIN);
    expect(provider.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, transactionRef: 'NARO-1', providerTransactionId: 'g1' }), undefined);
    expect(prisma.payment.updateMany.mock.calls[0][0].where).toEqual({ id: 'refund_1', tenantId: T });
    expect(prisma.payment.updateMany.mock.calls[0][0].data.providerTransactionId).toBe('GW-R1');
  });
});

describe('OrderRefundsService.listRefunds', () => {
  it('is tenant-scoped and lists REFUNDED rows with balances', async () => {
    const prisma = makePrisma({ completed: 50000, refunded: 10000, order: { id: 'o1', orderNumber: 'N', paymentStatus: 'REFUND_PENDING', channel: 'ONLINE' } });
    prisma.payment.findMany.mockResolvedValue([
      { id: 'r1', amount: 10000, method: 'CASH', status: 'REFUNDED', transactionRef: null, gatewayResponse: { kind: 'ORDER_REFUND', note: 'x', refundedBy: 'admin_1' }, createdAt: new Date() },
    ]);
    const { svc } = makeService(prisma);
    const res = await svc.listRefunds('o1');
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'o1', tenantId: T });
    expect(prisma.payment.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, orderId: 'o1', status: 'REFUNDED' });
    expect(res).toMatchObject({ totalCollected: 50000, totalRefunded: 10000, refundable: 40000, canRefund: true });
    expect(res.refunds[0]).toMatchObject({ id: 'r1', amount: 10000, kind: 'ORDER_REFUND', note: 'x' });
  });

  it('404 for an order outside the tenant', async () => {
    const prisma = makePrisma({ order: null });
    const { svc } = makeService(prisma);
    await expect(svc.listRefunds('o_other')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('providers report gateway refunds as unsupported', () => {
  const config: any = { get: (_k: string, d?: any) => d };
  it.each([
    ['Selcom', () => new SelcomProvider(config)],
    ['ClickPesa', () => new ClickPesaProvider(config)],
  ])('%s.refund() → { supported: false, reason }', async (_n, make) => {
    const res = await make().refund({ amount: 100 });
    expect(res.supported).toBe(false);
    expect(res.reason).toBeTruthy();
  });
});

describe('OrderRefundsController wiring', () => {
  it('class-level JwtAuthGuard → AdminGuard → PermissionGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OrderRefundsController)).toEqual([JwtAuthGuard, AdminGuard, PermissionGuard]);
  });
  it("both routes require 'orders:refund'", () => {
    const proto = OrderRefundsController.prototype as any;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.createRefund)).toEqual(['orders:refund']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.listRefunds)).toEqual(['orders:refund']);
  });
  it('service source keeps the advisory lock (concurrency shape)', () => {
    const src = readFileSync(join(__dirname, 'order-refunds.service.ts'), 'utf8');
    expect(src).toMatch(/pg_advisory_xact_lock\(hashtext\('refund:order:'/);
    expect(src).toMatch(/\$transaction\(/);
  });
});

describe('cancel keeps refund state', () => {
  it('PARTIALLY_REFUNDED counts as money still held (cancel → REFUND_PENDING, customers blocked)', () => {
    expect(MONEY_COLLECTED_PAYMENT_STATUSES).toContain('PARTIALLY_REFUNDED');
  });
});

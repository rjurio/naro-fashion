import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertIndependentlyApproved } from './separation';
import { assertWithinApproved, payoutReference } from './payout-controls';
import { RefundRequestsService } from './refund-requests.service';
import { RentalMoneyService } from '../rentals/rental-money.service';
import { OrderRefundsService } from '../orders/order-refunds.service';
import { PosService } from '../pos/pos.service';

// refunds:payout hardening — the owner's enforcement list for BOTH payout
// routes (unified /refund-requests/:id/pay and /rental-money/.../pay):
//  1 only an independently approved request is paid;   2/3/4/10 separation (see
//  refund-payout-permission.spec.ts + separation.spec.ts; SUPER_ADMIN below);
//  5 never more than approved nor than held;  7 references + payer's shift;
//  8 a retried / double payout never writes two rows;  9 audit + reconciliation fields.

const T = 'tenant-a';
const code = async (p: Promise<unknown>) => { try { await p; return 'ALLOWED'; } catch (e: any) { return e.getResponse?.().code ?? e.constructor?.name ?? String(e); } };
beforeAll(() => { jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); });

// ---------------------------------------------------------------- pure rules
describe('1. independent approval on record', () => {
  it('APPROVED with an approver who is not the requester passes; anything else → 409', () => {
    expect(() => assertIndependentlyApproved({ status: 'APPROVED', requestedById: 'a', approvedById: 'b' })).not.toThrow();
    expect(() => assertIndependentlyApproved({ status: 'APPROVED', requestedById: 'SYSTEM:LATE_PAYMENT', approvedById: 'b' })).not.toThrow();
    const c = (r: any) => { try { assertIndependentlyApproved(r); return 'ok'; } catch (e: any) { expect(e).toBeInstanceOf(ConflictException); return e.getResponse().code; } };
    expect(c({ status: 'APPROVED', requestedById: 'a', approvedById: null })).toBe('NOT_INDEPENDENTLY_APPROVED');
    expect(c({ status: 'APPROVED', requestedById: 'a', approvedById: 'a' })).toBe('NOT_INDEPENDENTLY_APPROVED');
    for (const status of ['REQUESTED', 'PAYING', 'PAID', 'FAILED', 'REJECTED']) expect(c({ status, requestedById: 'a', approvedById: 'b' })).toBe('NOT_APPROVED');
  });
});

describe('7. one payout-reference rule', () => {
  it('normalised (spaces out, upper case); malformed → 400 INVALID; non-cash needs one; cash optional', () => {
    expect(payoutReference('MOBILE_MONEY', ' mp 12 345 ', 100)).toBe('MP12345');
    const c = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { expect(e).toBeInstanceOf(BadRequestException); return e.getResponse().code; } };
    expect(c(() => payoutReference('MOBILE_MONEY', 'MP1', 100))).toBe('PAYOUT_REFERENCE_INVALID');
    expect(c(() => payoutReference('CASH', 'bad#ref!', 100))).toBe('PAYOUT_REFERENCE_INVALID');
    expect(c(() => payoutReference('BANK_TRANSFER', undefined, 100))).toBe('PAYOUT_REFERENCE_REQUIRED');
    expect(c(() => payoutReference('MOBILE_MONEY', '   ', 100))).toBe('PAYOUT_REFERENCE_REQUIRED');
    expect(payoutReference('CASH', undefined, 100)).toBeNull();
    expect(payoutReference('MOBILE_MONEY', undefined, 0)).toBeNull(); // retain-only: no money moves
  });
});

describe('5. never more than approved', () => {
  it('paid ≤ approved (to the cent)', () => {
    expect(() => assertWithinApproved(1000, 1000)).not.toThrow();
    expect(() => assertWithinApproved(999.99, 1000)).not.toThrow();
    try { assertWithinApproved(1000.01, 1000); throw new Error('allowed'); } catch (e: any) { expect(e.getResponse().code).toBe('PAYOUT_EXCEEDS_APPROVED'); }
  });
});

// ---------------------------------------------------------------- unified route
function unified(req: any, over: { payment?: any; refundByRef?: any; shift?: any } = {}) {
  const prisma: any = {
    refundRequest: {
      findFirst: jest.fn(async (q: any) => (q?.where?.payoutReference ? over.refundByRef ?? null : req)),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    payment: {
      findMany: jest.fn(async () => []), // no original methods: the same-method rule is not in play here
      findFirst: jest.fn(async () => over.payment ?? null),
      aggregate: jest.fn(async (q: any) => ({ _sum: { amount: q.where.status === 'COMPLETED' ? 50000 : 0 } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'pay-x', ...data })),
    },
    posSession: { findFirst: jest.fn(async () => (over.shift === undefined ? { id: 'shift-payer' } : over.shift)) },
    layaway: { updateMany: jest.fn() },
    $executeRaw: jest.fn(async () => 1),
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const audit = { log: jest.fn() };
  const orderRefunds = { executeRefund: jest.fn(async () => ({ refund: { id: 'pay-1' } })) };
  const pos = { executeSaleRefund: jest.fn(async () => ({ paymentId: 'pay-2', refundAmount: 1000 })) };
  const s = new RefundRequestsService(prisma, { requireId: T } as any, audit as any, orderRefunds as any, pos as any, {} as any);
  return { s, prisma, audit, orderRefunds, pos };
}
const order = { id: 'r1', tenantId: T, subject: 'ORDER', kind: 'ORDER_REFUND', orderId: 'o1', layawayId: null, amount: 1000, reason: 'x', status: 'APPROVED', requestedById: 'cashier', approvedById: 'manager' };
const exch = { ...order, subject: 'POS_SALE', kind: 'EXCHANGE_DIFFERENCE', exchangeNumber: 'EX-1' };

describe('unified payout', () => {
  it('1: APPROVED without an approver on record → 409 NOT_INDEPENDENTLY_APPROVED, nothing claimed or executed', async () => {
    const m = unified({ ...order, approvedById: null });
    expect(await code(m.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP99887766' }, { id: 'owner' }))).toBe('NOT_INDEPENDENTLY_APPROVED');
    expect(m.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
    expect(m.orderRefunds.executeRefund).not.toHaveBeenCalled();
  });
  it('10: a SUPER_ADMIN who approved is still the approver → 403 PAYOUT_BY_APPROVER; a SUPER_ADMIN who requested → 403 PAYOUT_BY_REQUESTER', async () => {
    expect(await code(unified({ ...order, approvedById: 'owner' }).s.pay('r1', { method: 'CASH' }, { id: 'owner', role: 'SUPER_ADMIN' } as any))).toBe('PAYOUT_BY_APPROVER');
    expect(await code(unified({ ...order, requestedById: 'owner' }).s.pay('r1', { method: 'CASH' }, { id: 'owner', role: 'SUPER_ADMIN', isPlatformAdmin: true } as any))).toBe('PAYOUT_BY_REQUESTER');
  });
  it('5: POS return payout passes the APPROVED amount as the cap into the sale transaction', async () => {
    const m = unified({ ...order, kind: 'POS_RETURN', subject: 'POS_SALE', lines: { items: [{ orderItemId: 'i1', quantity: 1 }] } });
    await m.s.pay('r1', { method: 'CASH' }, { id: 'owner' });
    expect((m.pos.executeSaleRefund.mock.calls[0] as unknown[])[5]).toBe(1000);
  });
  it('5: a money-only payout (exchange difference) is capped by what is still held, under the per-sale lock; 409 PAYOUT_EXCEEDS_HELD, request back to APPROVED', async () => {
    const m = unified({ ...exch, amount: 60000 });
    expect(await code(m.s.pay('r1', { method: 'CASH' }, { id: 'owner' }))).toBe('PAYOUT_EXCEEDS_HELD');
    expect(m.prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['refund:order:o1']);
    expect(m.prisma.payment.create).not.toHaveBeenCalled();
    expect(m.prisma.refundRequest.updateMany.mock.calls.at(-1)[0]).toMatchObject({ where: { status: 'PAYING' }, data: { status: 'APPROVED' } });
  });
  it('7: a reference already used by a payment, or by another refund, of this shop → 409 DUPLICATE_PAYOUT_REFERENCE before anything is claimed', async () => {
    const used = unified(order, { payment: { id: 'p-old' } });
    expect(await code(used.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'mp 1234 5678' }, { id: 'owner' }))).toBe('DUPLICATE_PAYOUT_REFERENCE');
    expect(used.prisma.payment.findFirst.mock.calls[0][0].where).toEqual({ tenantId: T, transactionRef: 'MP12345678' });
    expect(used.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
    const other = unified(order, { refundByRef: { id: 'r-other' } });
    expect(await code(other.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP12345678' }, { id: 'owner' }))).toBe('DUPLICATE_PAYOUT_REFERENCE');
  });
  it('7: the race-proof backstop (unique key, P2002) maps to the same 409 and puts the request back to APPROVED', async () => {
    const m = unified(order);
    m.orderRefunds.executeRefund.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    expect(await code(m.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP12345678' }, { id: 'owner' }))).toBe('DUPLICATE_PAYOUT_REFERENCE');
    expect(m.prisma.refundRequest.updateMany.mock.calls.at(-1)[0]).toMatchObject({ data: { status: 'APPROVED' } });
  });
  it('7: cash needs the PAYER\'s own open shift (looked up by the payer, shop-scoped) → 400 before any claim', async () => {
    const m = unified(exch, { shift: null });
    expect(await m.s.pay('r1', { method: 'CASH' }, { id: 'owner' }).catch((e) => e)).toBeInstanceOf(BadRequestException);
    expect(m.prisma.posSession.findFirst.mock.calls[0][0].where).toEqual({ adminUserId: 'owner', status: 'OPEN', tenantId: T });
    expect(m.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });
  it('8: a retried payout (request already PAID or PAYING) → 409, nothing executed; a lost claim → 409', async () => {
    for (const status of ['PAID', 'PAYING']) {
      const m = unified({ ...order, status, paidById: 'owner' });
      expect(await code(m.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP55554444' }, { id: 'cashier2' }))).toBe('NOT_APPROVED');
      expect(m.orderRefunds.executeRefund).not.toHaveBeenCalled();
    }
    const lost = unified(order);
    lost.prisma.refundRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await code(lost.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP55554444' }, { id: 'owner' }))).toBe('NOT_APPROVED');
    expect(lost.orderRefunds.executeRefund).not.toHaveBeenCalled();
  });
  it('9: money-only payout row: linked to the request, payer recorded, tagged with the payer\'s shift for non-cash too; audit has actor ids, amount, method, reference, payment, shift', async () => {
    const m = unified({ ...exch, amount: 20000 });
    await m.s.pay('r1', { method: 'MOBILE_MONEY', reference: 'MP20000001' }, { id: 'owner' });
    const row = m.prisma.payment.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ refundRequestId: 'r1', status: 'REFUNDED', amount: 20000, method: 'MOBILE_MONEY', transactionRef: 'MP20000001' });
    expect(row.gatewayResponse).toMatchObject({ posSessionId: 'shift-payer', paidByAdminId: 'owner', refundRequestId: 'r1' });
    expect(m.audit.log).toHaveBeenCalledWith('REFUND_PAID', 'RefundRequest', 'r1', expect.objectContaining({
      amount: 20000, approvedAmount: 20000, method: 'MOBILE_MONEY', reference: 'MP20000001', paymentId: 'pay-x', posSessionId: 'shift-payer',
      requestedById: 'cashier', approvedById: 'manager', paidById: 'owner',
    }));
  });
  it('9: fail is audited with the payout it reverses (method, reference, payment, payer, actor)', async () => {
    const m = unified({ ...order, status: 'PAID', paidById: 'owner', payoutMethod: 'MOBILE_MONEY', payoutReference: 'MP1', payout: { id: 'pay-1' } });
    m.prisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });
    (m.prisma as any).order = { updateMany: jest.fn() };
    m.prisma.payment.updateMany = jest.fn();
    await m.s.fail('r1', { reason: 'number not registered' }, { id: 'cashier2' });
    expect(m.audit.log).toHaveBeenCalledWith('REFUND_FAILED', 'RefundRequest', 'r1', expect.objectContaining({
      amount: 1000, method: 'MOBILE_MONEY', reference: 'MP1', paymentId: 'pay-1', paidById: 'owner', failedById: 'cashier2',
    }));
  });
});

// ---------------------------------------------------------------- rental route
function rental(request: any, opts: { payment?: any; shift?: any; requests?: any[] } = {}) {
  const audit = { log: jest.fn() };
  const r = { id: 'ro1', tenantId: T, rentalNumber: 'RNT-1', status: 'CANCELLED', holdState: 'REFUND_DUE', totalRentalPrice: 100000, damageDeposit: 0, lateFee: 0, downPaymentAmount: 25000 };
  const db: any = {
    $executeRaw: jest.fn(async () => 1),
    rentalOrder: { findFirst: jest.fn(async () => r), updateMany: jest.fn(async () => ({ count: 1 })) },
    payment: {
      findMany: jest.fn(async () => [{ id: 'p1', amount: 100000, status: 'COMPLETED', component: 'RENTAL_FEE', method: 'CASH', createdAt: new Date() }]),
      findFirst: jest.fn(async () => opts.payment ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'refund1', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    refundRequest: {
      findMany: jest.fn(async () => opts.requests ?? [request]),
      findFirst: jest.fn(async (q: any) => (q?.where?.payoutReference ? null : request)),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    posSession: { findFirst: jest.fn(async () => (opts.shift === undefined ? { id: 'shift-payer' } : opts.shift)) },
    rentalDiscrepancy: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(async (cb: any) => cb(db));
  return { svc: new RentalMoneyService(db, { requireId: T } as any, audit as any), db, audit };
}
const rq = { id: 'q1', tenantId: T, subject: 'RENTAL', rentalOrderId: 'ro1', kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'APPROVED', requestedById: 'cashier', approvedById: 'manager' };

describe('rental payout', () => {
  it('1: re-read under the lock: no independent approval → 409, no payout row', async () => {
    for (const bad of [{ approvedById: null }, { approvedById: 'cashier' }]) {
      const m = rental({ ...rq, ...bad });
      expect(await code(m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000001' }, { id: 'owner' }))).toBe('NOT_INDEPENDENTLY_APPROVED');
      expect(m.db.payment.create).not.toHaveBeenCalled();
    }
  });
  it('5: two requests on one booking — the lock serialises them and the second is capped by what the first left held (409 PAYOUT_EXCEEDS_HELD)', async () => {
    const other = { ...rq, id: 'q2', status: 'PAID', amount: 60000 };
    const m = rental({ ...rq, amount: 60000 }, { requests: [{ ...rq, amount: 60000 }, other] });
    m.db.payment.findMany.mockResolvedValue([
      { id: 'p1', amount: 100000, status: 'COMPLETED', component: 'RENTAL_FEE', method: 'CASH', createdAt: new Date() },
      { id: 'p2', amount: 60000, status: 'REFUNDED', component: 'RENTAL_FEE', method: 'CASH', createdAt: new Date(), refundOfPaymentId: 'p1' },
    ]);
    expect(await code(m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000002' }, { id: 'owner' }))).toBe('PAYOUT_EXCEEDS_HELD');
    expect(m.db.$executeRaw.mock.calls[0].slice(1)).toEqual(['refund:rental:ro1']);
    expect(m.db.payment.create).not.toHaveBeenCalled();
  });
  it('7: reference reused in the shop → 409 DUPLICATE_PAYOUT_REFERENCE (checked under the lock), no row; malformed → 400', async () => {
    const m = rental(rq, { payment: { id: 'p-old' } });
    expect(await code(m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000003' }, { id: 'owner' }))).toBe('DUPLICATE_PAYOUT_REFERENCE');
    expect(m.db.payment.create).not.toHaveBeenCalled();
    expect(await code(rental(rq).svc.pay('q1', { method: 'CASH', sessionId: 'shift-payer', reference: 'R#1' }, { id: 'owner' }))).toBe('PAYOUT_REFERENCE_INVALID');
    const p2002 = rental(rq);
    p2002.db.payment.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    expect(await code(p2002.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000004' }, { id: 'owner' }))).toBe('DUPLICATE_PAYOUT_REFERENCE');
  });
  it('7: a named shift must be the payer\'s own OPEN one, whatever the method', async () => {
    const m = rental(rq, { shift: null });
    expect(await m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000005', sessionId: 'someone-elses' }, { id: 'owner' }).catch((e) => e)).toBeInstanceOf(BadRequestException);
    expect(m.db.posSession.findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses', tenantId: T, adminUserId: 'owner', status: 'OPEN' });
  });
  it('8: a retried payout after PAID → 409, no second row', async () => {
    const m = rental({ ...rq, status: 'PAID', paidById: 'owner' });
    expect(await code(m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000006' }, { id: 'cashier2' }))).toBe('NOT_APPROVED');
    expect(m.db.payment.create).not.toHaveBeenCalled();
  });
  it('9: non-cash payout row tagged with the payer\'s open shift + payer + approver; audit carries the full record', async () => {
    const m = rental(rq);
    await m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'mp 1000 0007' }, { id: 'owner' });
    const row = m.db.payment.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ refundRequestId: 'q1', status: 'REFUNDED', transactionRef: 'MP10000007', component: 'RENTAL_FEE' });
    expect(row.gatewayResponse).toMatchObject({ posSessionId: 'shift-payer', paidByAdminId: 'owner', approvedById: 'manager', refundRequestId: 'q1' });
    expect(m.audit.log).toHaveBeenCalledWith('REFUND_PAID', 'RefundRequest', 'q1', expect.objectContaining({
      amount: 100000, method: 'MOBILE_MONEY', reference: 'MP10000007', paymentId: 'refund1', posSessionId: 'shift-payer',
      requestedById: 'cashier', approvedById: 'manager', paidById: 'owner',
    }));
  });
  it('9: a payer with no open shift: non-cash payout still recorded, untagged (R4 lists it as not attributed with the payer)', async () => {
    const m = rental(rq, { shift: null });
    await m.svc.pay('q1', { method: 'BANK_TRANSFER', reference: 'BNK-778899' }, { id: 'owner' });
    expect(m.db.payment.create.mock.calls[0][0].data.gatewayResponse.posSessionId).toBeUndefined();
    expect(m.db.payment.create.mock.calls[0][0].data.gatewayResponse.paidByAdminId).toBe('owner');
  });
  it('10: SUPER_ADMIN as approver / requester / deduction decider gets no shortcut', async () => {
    expect(await code(rental({ ...rq, approvedById: 'owner' }).svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000008' }, { id: 'owner', role: 'SUPER_ADMIN' } as any))).toBe('PAYOUT_BY_APPROVER');
    const dep = { ...rq, kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', retainedAmount: 5000, requestedById: 'mgr2' };
    const m = rental(dep);
    m.db.rentalDiscrepancy.findMany.mockResolvedValue([{ resolvedById: 'owner' }]);
    expect(await code(m.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP10000009' }, { id: 'owner', role: 'SUPER_ADMIN' } as any))).toBe('DEDUCTION_DECIDER');
  });
});

// ---------------------------------------------------------------- order + POS executors
describe('executors', () => {
  it('order refund (online): a non-cash payout is tagged with the payer\'s open shift; payer + request recorded', async () => {
    const prisma: any = {
      $executeRaw: jest.fn(async () => 1),
      order: { findFirst: jest.fn(async () => ({ id: 'o1', orderNumber: 'N-1', paymentStatus: 'PAID', channel: 'ONLINE', status: 'DELIVERED' })), updateMany: jest.fn(async () => ({ count: 1 })) },
      payment: {
        aggregate: jest.fn(async (a: any) => ({ _sum: { amount: a.where.status === 'COMPLETED' ? 50000 : 0 } })),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async (a: any) => ({ id: 'refund_1', createdAt: new Date(), ...a.data })),
      },
      posSession: { findFirst: jest.fn(async () => ({ id: 'shift-payer' })) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const svc = new OrderRefundsService(prisma, { requireId: T } as any, { log: jest.fn() } as any, { has: () => false, resolve: () => null } as any);
    await svc.executeRefund('o1', { amount: 1000, method: 'MOBILE_MONEY', reference: 'MP77776666' } as any, { id: 'owner' }, 'r1');
    const row = prisma.payment.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ refundRequestId: 'r1', transactionRef: 'MP77776666' });
    expect(row.gatewayResponse).toMatchObject({ posSessionId: 'shift-payer', paidByAdminId: 'owner', refundRequestId: 'r1' });
  });

  function posTx(order: any) {
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      order: { findFirst: jest.fn(async () => order), updateMany: jest.fn(async () => ({ count: 1 })) },
      orderItem: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => [{ quantity: 1, refundedQuantity: 1 }]) },
      productVariant: { updateMany: jest.fn(async () => ({ count: 1 })), findFirst: jest.fn(async () => ({ stock: 1 })) },
      inventoryTransaction: { create: jest.fn() },
      payment: { create: jest.fn(async () => ({ id: 'pay-pos' })) },
    };
    const prisma: any = { posSession: { findFirst: jest.fn(async () => ({ id: 'shift-payer' })) }, $transaction: jest.fn((cb: any) => cb(tx)) };
    return { svc: new PosService(prisma, { requireId: T } as any), tx };
  }
  const sale = {
    id: 'o1', tenantId: T, channel: 'POS', status: 'DELIVERED', paymentStatus: 'PAID', subtotal: 1000, discount: 0, total: 1000,
    items: [{ id: 'i1', productId: 'p1', variantId: 'v1', quantity: 1, unitPrice: 1000, total: 1000, refundedQuantity: 0 }],
    payments: [{ status: 'COMPLETED', amount: 1000, method: 'CASH' }],
  };
  it('POS return: re-valued above the approved amount → 409 PAYOUT_EXCEEDS_APPROVED inside the sale transaction, no payout row', async () => {
    const { svc, tx } = posTx(sale);
    expect(await code(svc.executeSaleRefund('o1', { refundMethod: 'CASH' } as any, 'owner', 'r1', null, 900))).toBe('PAYOUT_EXCEEDS_APPROVED');
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
  it('POS return: takes the per-sale lock first; the payout row carries the request, the payer and the shift', async () => {
    const { svc, tx } = posTx(sale);
    await svc.executeSaleRefund('o1', { refundMethod: 'MOBILE_MONEY' } as any, 'owner', 'r1', 'MP12341234', 1000);
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['refund:order:o1']);
    const row = tx.payment.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ refundRequestId: 'r1', transactionRef: 'MP12341234', amount: 1000 });
    expect(row.gatewayResponse).toMatchObject({ posSessionId: 'shift-payer', paidByAdminId: 'owner', refundRequestId: 'r1' });
  });
});

// ---------------------------------------------------------------- database backstop
describe('migration 20261117130000_refund_payout_guard (database backstop)', () => {
  const dir = path.join(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'migrations');
  const sql = fs.readFileSync(path.join(dir, '20261117130000_refund_payout_guard', 'migration.sql'), 'utf8');
  const body = sql.replace(/--.*$/gm, '');
  it('sorts after the separation migration it extends, and is expand-only (no table / column / data change)', () => {
    const all = fs.readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all.indexOf('20261117130000_refund_payout_guard')).toBeGreaterThan(all.indexOf('20261117120000_refund_separation'));
    expect(body).not.toMatch(/\b(DROP|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|TRUNCATE)\b/i);
  });
  it('refund requests: paid only from APPROVED / PAYING with an independent approver; decided rows fixed; amount only down', () => {
    expect(sql).toMatch(/NEW\.status = 'PAID' AND OLD\.status IN \('APPROVED', 'PAYING'\)/);
    expect(sql).toMatch(/NEW\."approvedById" IS NULL OR NEW\."approvedById" = NEW\."requestedById"/);
    expect(sql).toMatch(/IF NEW\.amount > OLD\.amount THEN/);
    expect(sql).toMatch(/NEW\."paidById" = NEW\."requestedById" OR NEW\."paidById" = NEW\."approvedById"/); // the G2 rule kept
    expect(body).not.toMatch(/Permission|payments:manage|refunds:payout|SUPER_ADMIN/); // about people, never roles
  });
  it('payout rows: linked to an independently approved request of the same shop and target, never above the approved amount', () => {
    expect(sql).toMatch(/CREATE TRIGGER naro_r3_refund_payout_guard BEFORE INSERT OR UPDATE ON "Payment"/);
    expect(sql).toMatch(/q\.status NOT IN \('APPROVED', 'PAYING'\)/);
    expect(sql).toMatch(/IF NEW\.amount > q\.amount THEN/);
    expect(sql).toMatch(/SECURITY DEFINER SET search_path/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  });
});

describe('no grant anywhere', () => {
  it('refunds:payout is granted by no seeder or migration', () => {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const files = [
      path.join(root, 'apps', 'api', 'src', 'roles', 'system-roles.seeder.ts'),
      path.join(root, 'apps', 'api', 'src', 'permissions', 'permissions.service.ts'),
      ...fs.readdirSync(path.join(root, 'packages', 'database', 'prisma', 'migrations')).filter((d) => /^\d/.test(d))
        .map((d) => path.join(root, 'packages', 'database', 'prisma', 'migrations', d, 'migration.sql')).filter((f) => fs.existsSync(f)),
    ];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      if (f.endsWith('.sql')) expect(s.replace(/--.*$/gm, '')).not.toMatch(/refunds:payout/);
    }
    const seeder = fs.readFileSync(files[0], 'utf8');
    expect(seeder.match(/'refunds:payout'/g)?.length).toBe(1); // only in MANAGER_EXCLUDED
    expect(seeder).toMatch(/MANAGER_EXCLUDED = \[[\s\S]*'refunds:payout'/);
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { openClaimedAmount, openClaimedQuantities, payoutProblems, REFUND_KINDS } from './refund-rules';
import { RefundRequestsService } from './refund-requests.service';
import { PosService } from '../pos/pos.service';

// R1b unified refund workflow: money back to a customer is always request →
// independent approval → payout by someone other than the requester.

describe('refund rules', () => {
  it('open requests reserve money and POS units; closed ones do not', () => {
    const reqs = [
      { id: 'a', status: 'REQUESTED', amount: 100, kind: REFUND_KINDS.POS_RETURN, lines: { items: [{ orderItemId: 'i1', quantity: 2 }] } },
      { id: 'b', status: 'APPROVED', amount: 50, kind: REFUND_KINDS.EXCHANGE_DIFFERENCE },
      { id: 'c', status: 'PAYING', amount: 25, kind: REFUND_KINDS.POS_RETURN, lines: { items: [{ orderItemId: 'i1', quantity: 1 }] } },
      { id: 'd', status: 'PAID', amount: 999, kind: REFUND_KINDS.POS_RETURN, lines: { items: [{ orderItemId: 'i1', quantity: 9 }] } },
      { id: 'e', status: 'REJECTED', amount: 999 },
    ];
    expect(openClaimedAmount(reqs)).toBe(175);
    expect(openClaimedAmount(reqs, 'a')).toBe(75);
    expect(openClaimedQuantities(reqs).get('i1')).toBe(3);
  });

  it('payout: a reference for non-cash; a verified note to pay back by another method (e.g. a card sale)', () => {
    expect(payoutProblems({ method: 'MOBILE_MONEY', reference: null, originalMethods: ['MPESA'] })).toHaveLength(1);
    expect(payoutProblems({ method: 'MOBILE_MONEY', reference: 'MP1', originalMethods: ['MPESA'] })).toEqual([]);
    expect(payoutProblems({ method: 'CASH', originalMethods: ['CASH'] })).toEqual([]);
    expect(payoutProblems({ method: 'CASH', originalMethods: ['CARD'] })[0]).toMatch(/different method/);
    expect(payoutProblems({ method: 'CASH', originalMethods: ['CARD'], verificationNote: 'ID seen, card holder in person' })).toEqual([]);
    expect(payoutProblems({ method: 'CHEQUE' as any, reference: 'x', originalMethods: [] })[0]).toMatch(/method must be/);
  });
});

describe('RefundRequestsService', () => {
  function make(req: any, over: any = {}) {
    const prisma: any = {
      refundRequest: {
        findFirst: jest.fn().mockResolvedValue(req),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      payment: { findMany: jest.fn().mockResolvedValue([{ method: 'CASH' }]) },
      posSession: { findFirst: jest.fn().mockResolvedValue({ id: 'shift-1' }) },
      layaway: { updateMany: jest.fn() },
      ...over,
    };
    const audit = { log: jest.fn() };
    const orderRefunds = { executeRefund: jest.fn().mockResolvedValue({ refund: { id: 'pay-1' } }) };
    const pos = { executeSaleRefund: jest.fn().mockResolvedValue({ paymentId: 'pay-2', refundAmount: 900 }) };
    const rentalMoney = { approve: jest.fn(), reject: jest.fn(), pay: jest.fn(), fail: jest.fn() };
    const s = new RefundRequestsService(prisma, { requireId: 't1' } as any, audit as any, orderRefunds as any, pos as any, rentalMoney as any);
    return { s, prisma, audit, orderRefunds, pos, rentalMoney };
  }
  const order = { id: 'r1', tenantId: 't1', subject: 'ORDER', kind: 'ORDER_REFUND', orderId: 'o1', layawayId: null, amount: 1000, reason: 'damaged', status: 'APPROVED', requestedById: 'cashier' };

  it('the requester can never approve (403, audited) and never pay out (403, audited)', async () => {
    const a = make({ ...order, status: 'REQUESTED' });
    expect(await a.s.approve('r1', {}, { id: 'cashier' }).catch((e) => e)).toBeInstanceOf(ForbiddenException);
    expect(a.audit.log).toHaveBeenCalledWith('REFUND_APPROVAL_DENIED', 'RefundRequest', 'r1', { reason: 'SELF_APPROVAL' });
    const p = make(order);
    const err: any = await p.s.pay('r1', { method: 'CASH' }, { id: 'cashier' }).catch((e) => e);
    expect(err.getResponse().code).toBe('PAYOUT_BY_REQUESTER');
    expect(p.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
    expect(p.orderRefunds.executeRefund).not.toHaveBeenCalled();
  });

  it('pay: only APPROVED; an invalid payout is refused before claiming', async () => {
    expect(await make({ ...order, status: 'REQUESTED' }).s.pay('r1', { method: 'CASH' }, { id: 'finance' }).catch((e) => e)).toBeInstanceOf(ConflictException);
    const m = make(order);
    m.prisma.payment.findMany.mockResolvedValue([{ method: 'MPESA' }]);
    expect(await m.s.pay('r1', { method: 'MOBILE_MONEY' }, { id: 'finance' }).catch((e) => e)).toBeInstanceOf(BadRequestException);
    expect(m.prisma.refundRequest.updateMany).not.toHaveBeenCalled();
  });

  it('pay: a second payer loses the APPROVED → PAYING claim (409), nothing executed', async () => {
    const m = make(order);
    m.prisma.refundRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await m.s.pay('r1', { method: 'CASH' }, { id: 'finance' }).catch((e) => e)).toBeInstanceOf(ConflictException);
    expect(m.orderRefunds.executeRefund).not.toHaveBeenCalled();
  });

  it('pay ORDER: executes through the order refund logic, linked to the request; then PAID + audit', async () => {
    const m = make(order);
    await m.s.pay('r1', { method: 'CASH' }, { id: 'finance' });
    expect(m.orderRefunds.executeRefund).toHaveBeenCalledWith('o1', expect.objectContaining({ amount: 1000, method: 'CASH' }), { id: 'finance' }, 'r1');
    expect(m.prisma.refundRequest.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'r1', tenantId: 't1', status: 'PAYING' }, data: expect.objectContaining({ status: 'PAID', paidById: 'finance' }) });
    expect(m.audit.log).toHaveBeenCalledWith('REFUND_PAID', 'RefundRequest', 'r1', expect.objectContaining({ paymentId: 'pay-1' }));
  });

  it('pay POS_RETURN: the restock + refund run at payout with the stored lines; the actual amount is recorded', async () => {
    const m = make({ ...order, subject: 'POS_SALE', kind: 'POS_RETURN', lines: { items: [{ orderItemId: 'i1', quantity: 1 }], reason: 'size' } });
    await m.s.pay('r1', { method: 'CASH' }, { id: 'finance' });
    expect(m.pos.executeSaleRefund).toHaveBeenCalledWith('o1', expect.objectContaining({ items: [{ orderItemId: 'i1', quantity: 1 }], refundMethod: 'CASH' }), 'finance', 'r1', null);
    expect(m.prisma.refundRequest.updateMany.mock.calls[1][0].data.amount).toBe(900);
  });

  it('a payout error puts the request back to APPROVED (never left PAYING, never PAID)', async () => {
    const m = make(order);
    m.orderRefunds.executeRefund.mockRejectedValue(new BadRequestException('A cash payout needs your OPEN POS shift'));
    await expect(m.s.pay('r1', { method: 'CASH' }, { id: 'finance' })).rejects.toThrow(/OPEN POS shift/);
    expect(m.prisma.refundRequest.updateMany.mock.calls[1][0]).toMatchObject({ where: { status: 'PAYING' }, data: { status: 'APPROVED' } });
  });

  it('RENTAL requests are delegated to the rental workflow (same rules)', async () => {
    const m = make({ ...order, subject: 'RENTAL', orderId: null, rentalOrderId: 'ro1' });
    await m.s.approve('r1', {}, { id: 'mgr' });
    await m.s.pay('r1', { method: 'CASH' }, { id: 'finance' });
    expect(m.rentalMoney.approve).toHaveBeenCalled();
    expect(m.rentalMoney.pay).toHaveBeenCalledWith('r1', expect.objectContaining({ method: 'CASH', sessionId: 'shift-1' }), { id: 'finance' });
  });

  it('every lookup is shop-scoped', async () => {
    const m = make(order);
    await m.s.get('r1');
    expect(m.prisma.refundRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 'r1', tenantId: 't1' });
  });
});

describe('PosService: a POS refund is only a request; a layaway cancellation never forfeits', () => {
  function pos(tx: any) {
    const s: any = Object.create(PosService.prototype);
    s.tenantContext = { requireId: 't1' };
    s.audit = { log: jest.fn() };
    s.prisma = { $transaction: (fn: any) => fn(tx), layaway: { findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: 'CANCELLED' }) } };
    return s;
  }
  const sale = {
    id: 'o1', tenantId: 't1', channel: 'POS', status: 'COMPLETED', paymentStatus: 'PAID', subtotal: 1000, discount: 0, total: 1000,
    items: [{ id: 'i1', quantity: 2, refundedQuantity: 0, total: 1000, variantId: 'v1', productId: 'p1' }],
    payments: [{ status: 'COMPLETED', amount: 1000, method: 'CASH' }],
  };

  it('refundSale writes a REQUEST only: no restock, no payment, units reserved', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      order: { findFirst: jest.fn().mockResolvedValue(sale) },
      refundRequest: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation((a: any) => ({ id: 'rq', ...a.data })) },
      payment: { create: jest.fn() },
      orderItem: { updateMany: jest.fn() },
    };
    const s = pos(tx);
    const out = await s.refundSale('o1', { items: [{ orderItemId: 'i1', quantity: 1 }], refundMethod: 'CASH', reason: 'wrong size' }, 'cashier');
    expect(out).toMatchObject({ status: 'REQUESTED', estimatedAmount: 500 });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.refundRequest.create.mock.calls[0][0].data).toMatchObject({ subject: 'POS_SALE', kind: 'POS_RETURN', requestedById: 'cashier' });
  });

  it('refundSale: units already in an open request cannot be requested again; a reason is required', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      order: { findFirst: jest.fn().mockResolvedValue(sale) },
      refundRequest: { findMany: jest.fn().mockResolvedValue([{ status: 'REQUESTED', amount: 1000, kind: 'POS_RETURN', lines: { items: [{ orderItemId: 'i1', quantity: 2 }] } }]), create: jest.fn() },
    };
    await expect(pos(tx).refundSale('o1', { items: [{ orderItemId: 'i1', quantity: 1 }], refundMethod: 'CASH', reason: 'x' }, 'cashier')).rejects.toThrow(/remaining 0/);
    await expect(pos(tx).refundSale('o1', { refundMethod: 'CASH' }, 'cashier')).rejects.toThrow(/reason/);
  });

  it('cancelLayaway: reason required; money held → full refund request + disposition; payments kept', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      layaway: {
        findFirst: jest.fn().mockResolvedValue({ id: 'l1', layawayNumber: 'LAY-1', payments: [{ status: 'COMPLETED', amount: 30000 }, { status: 'COMPLETED', amount: 20000 }] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refundRequest: { create: jest.fn().mockImplementation((a: any) => ({ id: 'rq', ...a.data })) },
      payment: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    const s = pos(tx);
    await expect(s.cancelLayaway('l1', '', 'mgr')).rejects.toThrow(/reason/);
    const out = await s.cancelLayaway('l1', 'customer moved away', 'mgr');
    expect(tx.layaway.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', financialDisposition: 'REFUND_REQUESTED', cancelledByAdminId: 'mgr' });
    expect(tx.refundRequest.create.mock.calls[0][0].data).toMatchObject({ subject: 'LAYAWAY', kind: 'LAYAWAY_CANCELLATION', amount: 50000, status: 'REQUESTED' });
    expect(tx.payment.deleteMany).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(out.refundRequest.id).toBe('rq');
  });

  it('cancelLayaway with nothing paid: NO_PAYMENTS, no request', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      layaway: { findFirst: jest.fn().mockResolvedValue({ id: 'l1', layawayNumber: 'LAY-2', payments: [] }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      refundRequest: { create: jest.fn() },
    };
    await pos(tx).cancelLayaway('l1', 'customer changed mind', 'mgr');
    expect(tx.layaway.updateMany.mock.calls[0][0].data.financialDisposition).toBe('NO_PAYMENTS');
    expect(tx.refundRequest.create).not.toHaveBeenCalled();
  });
});

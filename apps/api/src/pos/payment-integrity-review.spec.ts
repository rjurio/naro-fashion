import { BadRequestException, ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PaymentsService } from '../payments/payments.service';
import { PosService } from './pos.service';

/**
 * P0c review (Nov 2026): manual edits can't rewrite payment history, refunds
 * can't pay out money that was reversed, and the POS explains BEFORE taking
 * money that an operator can't confirm non-cash payments.
 */
const T = 't1';

describe('PATCH /payments/:id (PaymentsService.updateStatus) — no silent history rewrite', () => {
  function make(payment: any, claimCount = 1) {
    const prisma: any = {
      payment: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(payment)
          .mockResolvedValue({ ...payment, status: 'COMPLETED' }),
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        update: jest.fn(),
      },
    };
    const settlement = { settleParents: jest.fn() };
    const svc = new PaymentsService(prisma, {} as any, { requireId: T } as any, settlement as any);
    return { svc, prisma, settlement };
  }
  const gateway = (over: any = {}) => ({ id: 'p1', tenantId: T, status: 'PENDING', gatewayResponse: { provider: 'selcom', ref: 'S1' }, ...over });

  it('PENDING → COMPLETED is a compare-and-swap that MERGES evidence and settles parents', async () => {
    const { svc, prisma, settlement } = make(gateway());
    await svc.updateStatus('p1', { status: 'COMPLETED', gatewayResponse: { note: 'bank statement 12 Nov' } } as any);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: T, status: 'PENDING' },
      data: { status: 'COMPLETED', gatewayResponse: { provider: 'selcom', ref: 'S1', note: 'bank statement 12 Nov' } },
    });
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(settlement.settleParents).toHaveBeenCalled();
  });

  it.each([['COMPLETED', 'PENDING'], ['COMPLETED', 'FAILED'], ['REFUNDED', 'COMPLETED'], ['FAILED', 'COMPLETED']])(
    '%s → %s is refused (409 INVALID_PAYMENT_TRANSITION)', async (from, to) => {
      const { svc, prisma } = make(gateway({ status: from }));
      let err: any;
      try { await svc.updateStatus('p1', { status: to } as any); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().code).toBe('INVALID_PAYMENT_TRANSITION');
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

  it('POS payments (shift-tagged or manual evidence) can never be edited here', async () => {
    for (const gr of [{ posSessionId: 's1' }, { verification: { evidence: 'manual' } }]) {
      const { svc, prisma } = make(gateway({ status: 'COMPLETED', gatewayResponse: gr }));
      await expect(svc.updateStatus('p1', { status: 'REFUNDED' } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    }
  });

  it('a concurrent change (lost compare-and-swap) is refused, not overwritten', async () => {
    const { svc } = make(gateway(), 0);
    await expect(svc.updateStatus('p1', { status: 'COMPLETED' } as any)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('POS refunds after a reversal', () => {
  function make(order: any) {
    const tx: any = {
      order: { findFirst: jest.fn().mockResolvedValue(order), update: jest.fn() },
      orderItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ quantity: 1, refundedQuantity: 1 }]),
      },
      productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue({ stock: 1 }) },
      inventoryTransaction: { create: jest.fn() },
      payment: { create: jest.fn() },
    };
    const prisma: any = { posSession: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) }, $transaction: jest.fn((cb: any) => cb(tx)) };
    return { svc: new PosService(prisma, { requireId: T } as any), tx };
  }
  const order = (payments: any[]) => ({
    id: 'o1', tenantId: T, channel: 'POS', status: 'DELIVERED', paymentStatus: 'PAYMENT_REVERSED', subtotal: 1000, discount: 0, total: 1000,
    items: [{ id: 'i1', productId: 'p1', variantId: 'v1', quantity: 1, unitPrice: 1000, total: 1000, refundedQuantity: 0 }],
    payments,
  });

  it('a sale paid 100% by a REVERSED card can NOT be refunded in cash', async () => {
    const { svc, tx } = make(order([{ status: 'REVERSED', amount: 1000, method: 'CARD' }]));
    await expect(svc.refundSale('o1', { refundMethod: 'CASH' } as any, 'cashier')).rejects.toThrow(/exceed the amount paid/);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('split sale: cash 400 kept + card 600 reversed → refunding the whole 1000 is refused', async () => {
    const { svc, tx } = make(order([{ status: 'COMPLETED', amount: 400, method: 'CASH' }, { status: 'REVERSED', amount: 600, method: 'CARD' }]));
    await expect(svc.refundSale('o1', { refundMethod: 'CASH' } as any, 'cashier')).rejects.toThrow(/exceed the amount paid/);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});

describe('cashiers without the permission get an explanation BEFORE taking money', () => {
  it('GET /pos/capabilities reports what the operator may confirm', async () => {
    const prisma: any = {
      adminUserRole: { findMany: jest.fn(async () => [{ role: { permissions: [{ permission: { code: 'payments:confirm-manual' } }] } }]) },
    };
    const svc = new PosService(prisma, { requireId: T } as any);
    expect(await svc.getCapabilities({ id: 'u1', role: 'STAFF', isAdmin: true, tenantId: T })).toEqual({ canConfirmManualPayments: true, canReversePayments: false });
    prisma.adminUserRole.findMany.mockResolvedValue([]);
    expect(await svc.getCapabilities({ id: 'u2', role: 'STAFF', isAdmin: true, tenantId: T })).toEqual({ canConfirmManualPayments: false, canReversePayments: false });
  });

  const C = join(__dirname, '..', '..', '..', 'admin', 'app', 'dashboard', 'pos');
  it('PaymentPanel disables card / mobile money with the explanation; unknown + offline = cash only', () => {
    const s = readFileSync(join(C, 'components', 'PaymentPanel.tsx'), 'utf8');
    expect(s).toMatch(/const manualAllowed = canConfirmManual === true \|\| \(canConfirmManual == null && !offline\);/);
    expect(s).toMatch(/const noPermission = key !== 'CASH' && !manualAllowed;/);
    expect(s).toMatch(/Confirm payments manually/);
  });
  it('the POS page fetches capabilities online and caches them per user for offline', () => {
    const s = readFileSync(join(C, 'page.tsx'), 'utf8');
    expect(s).toMatch(/adminApi\s*\.posGetCapabilities\(\)/);
    expect(s).toMatch(/naro-pos-caps:\$\{user\.id\}/);
    expect(s).toMatch(/canConfirmManual=\{canConfirmManual\}/);
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { MANAGER_DEFAULT_GRANTS } from '../permissions/permissions.service';
import { MANAGER_EXCLUDED, STAFF_CODES } from '../roles/system-roles.seeder';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import {
  DUPLICATE_PAYMENT_REFERENCE,
  MANUAL_CONFIRMATION_NOT_PERMITTED,
  PAYMENT_NOT_VERIFIED,
  canTransitionPayment,
  normalizeReference,
  verifyTenders,
} from './payment-verification';

/**
 * P0c (Nov 2026): choosing Card / M-Pesa no longer marks a POS payment paid.
 * Non-cash tenders need evidence + an authorised operator, are recorded as
 * MANUAL (never as provider-verified), audited, de-duplicated, and can be
 * reversed by finance.
 */

const T = 't1';
const SUPER = { id: 'boss', role: 'SUPER_ADMIN', isAdmin: true, tenantId: T };
const STAFF = { id: 'cashier-1', role: 'STAFF', isAdmin: true, tenantId: T };
const codeOf = (e: any) => e?.getResponse?.()?.code;

describe('verifyTenders (evidence rules)', () => {
  const ok = { canConfirmManually: true, actorAdminId: 'u1', now: new Date('2026-11-10T10:00:00Z') };

  it('cash needs no evidence and gets no verification record', () => {
    expect(verifyTenders([{ method: 'CASH', amount: 1000 }], ok)).toEqual([{ method: 'CASH', transactionRef: null, verification: null }]);
  });

  it('card needs BOTH the terminal reference and the approval code', () => {
    const e1 = (() => { try { verifyTenders([{ method: 'CARD', amount: 1 }], ok); } catch (e) { return e; } })();
    expect(e1).toBeInstanceOf(BadRequestException);
    expect(codeOf(e1)).toBe(PAYMENT_NOT_VERIFIED);
    expect(() => verifyTenders([{ method: 'CARD', amount: 1, transactionRef: 'RRN123' }], ok)).toThrow(/approval code/);
    const [v] = verifyTenders([{ method: 'card', amount: 1, transactionRef: ' rrn 123 ', approvalCode: 'ab12cd' }], ok);
    expect(v.transactionRef).toBe('RRN123');
    expect(v.verification).toEqual({
      method: 'MANUAL_TERMINAL', providerVerified: false, evidence: 'manual', reference: 'RRN123', approvalCode: 'AB12CD',
      confirmedByAdminId: 'u1', confirmedAt: '2026-11-10T10:00:00.000Z',
    });
  });

  it('mobile money needs the SMS reference', () => {
    expect(() => verifyTenders([{ method: 'MPESA', amount: 1 }], ok)).toThrow(/transaction reference/);
    const [v] = verifyTenders([{ method: 'MPESA', amount: 1, transactionRef: 'QK12AB34' }], ok);
    expect(v.verification?.method).toBe('MANUAL_MOBILE_MONEY');
    expect(v.verification?.providerVerified).toBe(false);
  });

  it('unknown methods are refused (no silent "paid")', () => {
    expect(() => verifyTenders([{ method: 'VOUCHER', amount: 1, transactionRef: 'ABCD1' }], ok)).toThrow(/not a supported POS payment method/);
  });

  it('an operator without payments:confirm-manual can take cash but not record non-cash', () => {
    expect(() => verifyTenders([{ method: 'CASH', amount: 1 }], { ...ok, canConfirmManually: false })).not.toThrow();
    let err: any;
    try { verifyTenders([{ method: 'MPESA', amount: 1, transactionRef: 'QK12AB34' }], { ...ok, canConfirmManually: false }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(codeOf(err)).toBe(MANUAL_CONFIRMATION_NOT_PERMITTED);
  });

  it('the same reference twice in one payment is refused', () => {
    let err: any;
    try {
      verifyTenders([
        { method: 'MPESA', amount: 1, transactionRef: 'QK12AB34' },
        { method: 'AIRTEL_MONEY', amount: 1, transactionRef: 'qk12ab34' },
      ], ok);
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictException);
    expect(codeOf(err)).toBe(DUPLICATE_PAYMENT_REFERENCE);
  });

  it('references are normalised and length/charset bounded', () => {
    expect(normalizeReference(' qk 12-ab/9 ')).toBe('QK12-AB/9');
    expect(normalizeReference('ab')).toBeNull();
    expect(normalizeReference('<script>')).toBeNull();
  });
});

describe('explicit payment states', () => {
  it('forward-only: pending → confirmed|failed; confirmed → reversed|refunded; never back', () => {
    expect(canTransitionPayment('PENDING', 'COMPLETED')).toBe(true);
    expect(canTransitionPayment('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionPayment('COMPLETED', 'REVERSED')).toBe(true);
    expect(canTransitionPayment('COMPLETED', 'REFUNDED')).toBe(true);
    expect(canTransitionPayment('COMPLETED', 'PENDING')).toBe(false);
    expect(canTransitionPayment('COMPLETED', 'FAILED')).toBe(false);
    expect(canTransitionPayment('REVERSED', 'COMPLETED')).toBe(false);
    expect(canTransitionPayment('FAILED', 'COMPLETED')).toBe(false);
  });
});

function makePos(opts: { grantedCodes?: string[]; existingRef?: string | null; p2002?: boolean; payment?: any; layawayActive?: boolean } = {}) {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const tx: any = {
    // Forward-compatible with P0b (reserved-gown guard): product lock + open-rental lookup.
    $executeRaw: jest.fn().mockResolvedValue(1),
    rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
    order: { create: jest.fn(async ({ data }: any) => ({ id: 'o1', ...data, items: [] })), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payment: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.p2002) { const e: any = new Error('unique'); e.code = 'P2002'; e.meta = { target: ['tenantId', 'transactionRef'] }; throw e; }
        return { id: `pay-${tx.payment.create.mock.calls.length}`, ...data };
      }),
      findFirst: jest.fn(async () => opts.payment ?? null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
    },
    refundRequest: { count: jest.fn(async () => 0) },
    productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn(async () => ({ stock: 9 })) },
    inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
    posSession: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    layaway: {
      create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })),
      updateMany: jest.fn(async () => ({ count: opts.layawayActive === false ? 0 : 1 })),
      findFirst: jest.fn(async () => ({ id: 'l1', status: 'ACTIVE', payments: [] })),
    },
  };
  const prisma: any = {
    posSession: { findFirst: jest.fn(async () => ({ id: 's1', adminUserId: 'cashier-1', status: 'OPEN', tenantId: T, openedAt: new Date(Date.now() - 3600_000), closedAt: null })) },
    productVariant: {
      findMany: jest.fn(async () => [{ id: 'v1', productId: 'p1', stock: 10, price: 1000, name: 'S', product: { id: 'p1', name: 'Shirt', availabilityMode: 'PURCHASE_ONLY' } }]),
      count: jest.fn(async () => 1),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    payment: { findFirst: jest.fn(async () => (opts.existingRef ? { transactionRef: opts.existingRef } : null)) },
    adminUserRole: {
      findMany: jest.fn(async () => [{ role: { permissions: (opts.grantedCodes ?? []).map((code) => ({ permission: { code } })) } }]),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const service = new PosService(prisma, { requireId: T } as any, audit as any);
  return { service, prisma, tx, audit };
}

const sale = (payments: any[]) => ({ items: [{ productId: 'p1', variantId: 'v1', quantity: 1, unitPrice: 1000 }], payments });

describe('POS sale: non-cash needs evidence + authorisation', () => {
  it('M-Pesa with no reference is refused online — nothing is written', async () => {
    const { service, tx } = makePos();
    await expect(service.createSale(sale([{ method: 'MPESA', amount: 1000 }]) as any, 'cashier-1', SUPER)).rejects.toThrow(/transaction reference/);
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('STAFF without payments:confirm-manual → 403, nothing written; cash still works for them', async () => {
    const { service, tx } = makePos({ grantedCodes: [] });
    let err: any;
    try { await service.createSale(sale([{ method: 'MPESA', amount: 1000, transactionRef: 'QK12AB34' }]) as any, 'cashier-1', STAFF); } catch (e) { err = e; }
    expect(codeOf(err)).toBe(MANUAL_CONFIRMATION_NOT_PERMITTED);
    expect(tx.payment.create).not.toHaveBeenCalled();
    await service.createSale(sale([{ method: 'CASH', amount: 1000 }]) as any, 'cashier-1', STAFF);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
  });

  it('STAFF granted the code: recorded COMPLETED as MANUAL evidence (not provider) and audited', async () => {
    const { service, tx, audit } = makePos({ grantedCodes: ['payments:confirm-manual'] });
    await service.createSale(sale([{ method: 'MPESA', amount: 1000, transactionRef: 'qk12ab34' }]) as any, 'cashier-1', STAFF);
    const data = tx.payment.create.mock.calls[0][0].data;
    expect(data.status).toBe('COMPLETED');
    expect(data.transactionRef).toBe('QK12AB34');
    expect(data.gatewayResponse.verification).toMatchObject({ method: 'MANUAL_MOBILE_MONEY', providerVerified: false, evidence: 'manual', confirmedByAdminId: 'cashier-1' });
    expect(data.gatewayResponse.posSessionId).toBe('s1'); // still tagged for shift reconciliation
    expect(audit.log).toHaveBeenCalledWith('PAYMENT_MANUALLY_CONFIRMED', 'Payment', 'pay-1', expect.objectContaining({ providerVerified: false, reference: 'QK12AB34', kind: 'POS_SALE' }));
  });

  it('a reference already recorded is refused (409) before anything is written', async () => {
    const { service, tx } = makePos({ existingRef: 'QK12AB34' });
    let err: any;
    try { await service.createSale(sale([{ method: 'MPESA', amount: 1000, transactionRef: 'QK12AB34' }]) as any, 'cashier-1', SUPER); } catch (e) { err = e; }
    expect(codeOf(err)).toBe(DUPLICATE_PAYMENT_REFERENCE);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('a concurrent reuse caught by the unique index (P2002) also becomes a clean 409', async () => {
    const { service } = makePos({ p2002: true });
    let err: any;
    try { await service.createSale(sale([{ method: 'MPESA', amount: 1000, transactionRef: 'QK12AB34' }]) as any, 'cashier-1', SUPER); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictException);
    expect(codeOf(err)).toBe(DUPLICATE_PAYMENT_REFERENCE);
  });

  it('cash-only sales are unchanged and write no verification/audit', async () => {
    const { service, tx, audit } = makePos();
    await service.createSale(sale([{ method: 'CASH', amount: 1000 }]) as any, 'cashier-1', STAFF);
    expect(tx.payment.create.mock.calls[0][0].data.gatewayResponse.verification).toBeUndefined();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('layaways and exchanges follow the same rule', () => {
  it('layaway deposit by card without the approval code is refused', async () => {
    const { service, tx } = makePos();
    await expect(
      service.createLayaway({ customerId: 'u1', items: sale([]).items, depositAmount: 500, depositMethod: 'CARD', depositTransactionRef: 'RRN1', dueDate: '2026-12-01' } as any, 'cashier-1', SUPER),
    ).rejects.toThrow(/approval code/);
    expect(tx.layaway.create).not.toHaveBeenCalled();
  });

  it('layaway instalment by mobile money needs the reference and the permission', async () => {
    const { service, tx } = makePos({ grantedCodes: [] });
    await expect(service.layawayPayment('l1', { amount: 100, method: 'AIRTEL_MONEY' } as any, 'cashier-1', SUPER)).rejects.toThrow(/transaction reference/);
    let err: any;
    try { await service.layawayPayment('l1', { amount: 100, method: 'AIRTEL_MONEY', transactionRef: 'AM12345' } as any, 'cashier-1', STAFF); } catch (e) { err = e; }
    expect(codeOf(err)).toBe(MANUAL_CONFIRMATION_NOT_PERMITTED);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('layaway instalment with evidence is recorded with the verification record', async () => {
    const { service, tx, audit } = makePos();
    await service.layawayPayment('l1', { amount: 100, method: 'AIRTEL_MONEY', transactionRef: 'AM12345' } as any, 'cashier-1', SUPER);
    expect(tx.payment.create.mock.calls[0][0].data.gatewayResponse.verification.method).toBe('MANUAL_MOBILE_MONEY');
    expect(audit.log).toHaveBeenCalledWith('PAYMENT_MANUALLY_CONFIRMED', 'Payment', expect.any(String), expect.objectContaining({ kind: 'LAYAWAY_PAYMENT' }));
  });
});

describe('reversal of a manually confirmed payment', () => {
  const manual = (over: any = {}) => ({
    id: 'pay-9', tenantId: T, orderId: 'o9', layawayId: null, amount: 1000, method: 'CARD', status: 'COMPLETED',
    gatewayResponse: { posSessionId: 's1', verification: { method: 'MANUAL_TERMINAL', evidence: 'manual', providerVerified: false } },
    ...over,
  });

  it('COMPLETED manual card → REVERSED, order flagged, audited', async () => {
    const { service, tx, audit } = makePos({ payment: manual() });
    const r = await service.reversePayment('pay-9', 'Not on terminal settlement report', 'boss');
    expect(r.status).toBe('REVERSED');
    expect(tx.payment.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'pay-9', tenantId: T, status: 'COMPLETED' }, data: { status: 'REVERSED' } });
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o9', tenantId: T }, data: { paymentStatus: 'PAYMENT_REVERSED' } });
    expect(audit.log).toHaveBeenCalledWith('PAYMENT_REVERSED', 'Payment', 'pay-9', expect.objectContaining({ reason: 'Not on terminal settlement report' }));
  });

  it('a layaway payment reversal puts the amount back on the balance', async () => {
    const { service, tx } = makePos({ payment: manual({ orderId: null, layawayId: 'l1', method: 'MPESA' }) });
    await service.reversePayment('pay-9', 'SMS was fake', 'boss');
    expect(tx.layaway.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'l1', tenantId: T, status: 'ACTIVE' }, data: { depositPaid: { decrement: 1000 }, balanceDue: { increment: 1000 } } });
  });

  it.each([
    ['cash', manual({ method: 'CASH' })],
    ['provider-verified / legacy (no manual evidence)', manual({ gatewayResponse: { posSessionId: 's1' } })],
  ])('refuses %s', async (_l, payment) => {
    const { service } = makePos({ payment });
    await expect(service.reversePayment('pay-9', 'some reason', 'boss')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a payment that is not COMPLETED (no double reversal) and requires a reason', async () => {
    const { service } = makePos({ payment: manual({ status: 'REVERSED' }) });
    await expect(service.reversePayment('pay-9', 'again please', 'boss')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reversePayment('pay-9', 'x', 'boss')).rejects.toThrow(/reason/);
  });
});

describe('route + permission wiring', () => {
  it('the reversal routes require payments:reverse (round 25F E: the old route now only REQUESTS)', () => {
    for (const m of ['requestReversal', 'approveReversal', 'rejectReversal', 'withdrawReversal', 'listReversalRequests']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, (PosController.prototype as any)[m])).toEqual(['payments:reverse']);
    }
    expect((PosController.prototype as any).reversePayment).toBeUndefined();
  });
  it('defaults: nobody but SUPER_ADMIN may confirm or reverse until the owner grants it per person', () => {
    expect(MANAGER_DEFAULT_GRANTS).not.toContain('payments:confirm-manual');
    expect(MANAGER_EXCLUDED).toContain('payments:confirm-manual');
    expect(MANAGER_EXCLUDED).toContain('payments:reverse');
    expect(STAFF_CODES).not.toContain('payments:confirm-manual');
    expect(STAFF_CODES).not.toContain('payments:reverse');
  });
});

describe('POS UI asks for the evidence (the API is authoritative)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path');
  const C = join(__dirname, '..', '..', '..', 'admin', 'app', 'dashboard', 'pos', 'components');
  it('PaymentPanel requires the reference online too, plus the approval code for card', () => {
    const s = readFileSync(join(C, 'PaymentPanel.tsx'), 'utf8');
    expect(s).toMatch(/const refMissing = !!requiresRef && \(!refOk\(transactionRef\) \|\| \(isCard && !approvalOk\(approvalCode\)\)\);/);
    expect(s).not.toMatch(/const refMissing = offline &&/);
    expect(s).toMatch(/approvalCode: isCard \?/);
  });
  it('layaway instalments and exchange settlements send the evidence', () => {
    expect(readFileSync(join(C, 'LayawayModal.tsx'), 'utf8')).toMatch(/approvalCode: payMethod === 'CARD'/);
    const ex = readFileSync(join(C, 'ExchangeModal.tsx'), 'utf8');
    expect(ex).toMatch(/settlementRef:/);
    expect(ex).toMatch(/settlementApprovalCode:/);
  });
});

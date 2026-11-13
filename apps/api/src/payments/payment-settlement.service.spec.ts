import * as fs from 'fs';
import * as path from 'path';
import {
  PaymentSettlementService,
  assessCollectedAmount,
  extractReportedAmount,
  mapGatewayStatus,
  sha256Hex,
} from './payment-settlement.service';

function makePrisma(overrides: Record<string, any> = {}) {
  const payment: any = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
  };
  // Rental money ledger: settlement reads the rows; mirror the mocked sum as
  // one unallocated COMPLETED row (= what the old aggregate represented).
  payment.findMany = jest.fn(async () => {
    const a = await payment.aggregate();
    return [{ amount: a?._sum?.amount ?? 0, status: 'COMPLETED', component: null }];
  });
  return {
    payment,
    order: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rentalOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Default: the rental's customer holds an approved National ID.
    customerIDDocument: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1' }) },
    // The rental roll-up decides + writes under the booking's money locks (round 25F).
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async function (this: any, cb: any) { return cb(this); }),
    ...overrides,
  } as any;
}

const basePayment = {
  id: 'p1',
  status: 'PROCESSING',
  amount: 50000,
  orderId: 'o1',
  rentalOrderId: null,
};

describe('payment settlement helpers', () => {
  it('mapGatewayStatus returns null for unknown/missing statuses (ignored, not PENDING)', () => {
    expect(mapGatewayStatus(undefined)).toBeNull();
    expect(mapGatewayStatus('WHATEVER')).toBeNull();
    expect(mapGatewayStatus('success')).toBe('COMPLETED');
    expect(mapGatewayStatus('SETTLED')).toBe('COMPLETED');
    expect(mapGatewayStatus('CANCELLED')).toBe('FAILED');
    expect(mapGatewayStatus('PENDING')).toBe('PROCESSING');
  });

  it('extractReportedAmount reads common fields and arrays', () => {
    expect(extractReportedAmount({ collectedAmount: '1000' })).toBe(1000);
    expect(extractReportedAmount({ amount: 5 })).toBe(5);
    expect(extractReportedAmount([{ collectedAmount: 7 }])).toBe(7);
    expect(extractReportedAmount({})).toBeNull();
    expect(extractReportedAmount({ amount: 'abc' })).toBeNull();
  });

  it('assessCollectedAmount holds a short COMPLETED as PROCESSING', () => {
    expect(assessCollectedAmount({ status: 'COMPLETED', reportedAmount: 100, expectedAmount: 50000 }))
      .toEqual({ status: 'PROCESSING', amountShort: true });
    expect(assessCollectedAmount({ status: 'COMPLETED', reportedAmount: 50000, expectedAmount: 50000 }))
      .toEqual({ status: 'COMPLETED', amountShort: false });
    expect(assessCollectedAmount({ status: 'COMPLETED', reportedAmount: null, expectedAmount: 50000 }))
      .toEqual({ status: 'COMPLETED', amountShort: false });
  });

  it('sha256Hex is a stable 64-hex digest', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});

describe('PaymentSettlementService.applyGatewayResult', () => {
  it('COMPLETED uses a CAS that excludes COMPLETED/REFUNDED and is tenant-scoped', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNumber: 'N1', status: 'PENDING', paymentStatus: 'PENDING', total: 50000 });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 50000 } });
    const svc = new PaymentSettlementService(prisma);

    const res = await svc.applyGatewayResult({
      payment: basePayment, tenantId: 't1', status: 'COMPLETED', reportedAmount: 50000, source: 'test',
    });

    expect(res).toEqual({ applied: true, status: 'COMPLETED', amountShort: false });
    const where = prisma.payment.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'p1', tenantId: 't1', status: { notIn: ['COMPLETED', 'REFUNDED'] } });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', tenantId: 't1' }, data: { paymentStatus: 'PAID' } });
  });

  it('FAILED/PROCESSING may only move from PENDING/PROCESSING (never downgrades COMPLETED)', async () => {
    const prisma = makePrisma();
    prisma.payment.updateMany.mockResolvedValue({ count: 0 }); // row is COMPLETED in DB
    const svc = new PaymentSettlementService(prisma);

    const res = await svc.applyGatewayResult({
      payment: { ...basePayment, status: 'COMPLETED' }, tenantId: 't1', status: 'FAILED', reportedAmount: null, source: 'test',
    });

    expect(res.applied).toBe(false);
    expect(prisma.payment.updateMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'PROCESSING'] });
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('unknown status is ignored — no status write at all', async () => {
    const prisma = makePrisma();
    const svc = new PaymentSettlementService(prisma);
    const res = await svc.applyGatewayResult({
      payment: basePayment, tenantId: 't1', status: null, reportedAmount: null, source: 'test',
    });
    expect(res.applied).toBe(false);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('short collection is held as PROCESSING and does not settle the order', async () => {
    const prisma = makePrisma();
    const svc = new PaymentSettlementService(prisma);
    const res = await svc.applyGatewayResult({
      payment: basePayment, tenantId: 't1', status: 'COMPLETED', reportedAmount: 100, gatewayResponse: { a: 1 }, source: 'test',
    });
    expect(res).toEqual({ applied: true, status: 'PROCESSING', amountShort: true });
    const data = prisma.payment.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('PROCESSING');
    expect(data.gatewayResponse._amountMismatch).toEqual({ reportedAmount: 100, expectedAmount: 50000 });
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('PaymentSettlementService parent roll-up', () => {
  it('never flips a CANCELLED order to PAID', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNumber: 'N1', status: 'CANCELLED', paymentStatus: 'CANCELLED', total: 1000 });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    const svc = new PaymentSettlementService(prisma);
    await svc.updateOrderPaymentStatus('o1', 't1');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('PARTIAL when completed sum is below total', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNumber: 'N1', status: 'PENDING', paymentStatus: 'PENDING', total: 1000 });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 400 } });
    const svc = new PaymentSettlementService(prisma);
    await svc.updateOrderPaymentStatus('o1', 't1');
    expect(prisma.order.updateMany.mock.calls[0][0].data).toEqual({ paymentStatus: 'PARTIAL' });
  });

  it('rental advances ID_VERIFIED → DOWN_PAYMENT_PAID only', async () => {
    const prisma = makePrisma();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 250 } });
    const svc = new PaymentSettlementService(prisma);

    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'PENDING_ID_VERIFICATION', downPaymentAmount: 250, totalRentalPrice: 1000 });
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();

    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'ID_VERIFIED', userId: 'u1', downPaymentAmount: 250, totalRentalPrice: 1000 });
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', tenantId: 't1', status: 'ID_VERIFIED' },
      data: { status: 'DOWN_PAYMENT_PAID' },
    });
  });

  it('concurrent roll-ups (round 25F): the write is decided under the money locks from a FRESH read, so a stale snapshot never loses the complete roll-up', async () => {
    // This settlement's unlocked snapshot: ID_VERIFIED + only the 100 down payment.
    // Under the lock: the other settlement already wrote DOWN_PAYMENT_PAID and
    // the balance (300) is committed → this one must write FULLY_PAID from
    // DOWN_PAYMENT_PAID (before: CAS on the stale ID_VERIFIED → 0 rows, lost).
    const prisma = makePrisma();
    const order: string[] = [];
    const base = { id: 'r1', rentalNumber: 'R1', userId: 'u1', downPaymentAmount: 100, totalRentalPrice: 400, damageDeposit: 200, lateFee: 0 };
    let locked = false;
    prisma.$executeRaw.mockImplementation(async () => { order.push('lock'); locked = true; return 1; });
    prisma.rentalOrder.findFirst.mockImplementation(async () => { order.push(locked ? 'fresh-read' : 'read'); return { ...base, status: locked ? 'DOWN_PAYMENT_PAID' : 'ID_VERIFIED' }; });
    prisma.payment.findMany = jest.fn(async () => (locked
      ? [{ amount: 100, status: 'COMPLETED', component: null }, { amount: 300, status: 'COMPLETED', component: null }]
      : [{ amount: 100, status: 'COMPLETED', component: null }]));
    const svc = new PaymentSettlementService(prisma);
    jest.spyOn(svc, 'sumCompleted').mockResolvedValue(100);
    await svc.updateRentalPaymentStatus('r1', 't1');
    const writes = prisma.rentalOrder.updateMany.mock.calls.map((c: any) => c[0]).filter((a: any) => a.data.status);
    expect(writes).toEqual([{ where: { id: 'r1', tenantId: 't1', status: 'DOWN_PAYMENT_PAID' }, data: { status: 'FULLY_PAID' } }]);
    expect(order.lastIndexOf('lock')).toBeLessThan(order.lastIndexOf('fresh-read'));
  });

  it('never confirms a paid ID_VERIFIED rental whose customer has no approved National ID', async () => {
    const prisma = makePrisma();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 250 } });
    prisma.customerIDDocument.findFirst.mockResolvedValue(null);
    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'ID_VERIFIED', userId: 'u1', downPaymentAmount: 250, totalRentalPrice: 1000 });
    await new PaymentSettlementService(prisma).updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerIDDocument.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't1', userId: 'u1', verificationStatus: 'APPROVED' },
      select: { id: true },
    });
  });

  it("no payments code writes the non-workflow rental status 'CONFIRMED' or keeps a private roll-up copy", () => {
    const dir = __dirname;
    for (const f of ['payments.service.ts', 'payments.reconciliation.ts', 'payment-settlement.service.ts']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/status:\s*'CONFIRMED'/);
      if (f !== 'payment-settlement.service.ts') {
        expect(src).not.toMatch(/private async update(Order|Rental)PaymentStatus/);
      }
    }
  });
});

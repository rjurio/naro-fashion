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
  return {
    payment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    order: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rentalOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
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

    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'PENDING_ID_VERIFICATION', downPaymentAmount: 250 });
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();

    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'ID_VERIFIED', downPaymentAmount: 250 });
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', tenantId: 't1', status: 'ID_VERIFIED' },
      data: { status: 'DOWN_PAYMENT_PAID' },
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

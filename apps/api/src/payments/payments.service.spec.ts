import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsReconciliationService } from './payments.reconciliation';

/**
 * Regression specs for the payments review fixes:
 *  - Selcom webhook signature verification is mandatory (no rawBody → 403)
 *  - webhook lookup is scoped by providerCode
 *  - initiate rejects cancelled/paid orders + closed rentals, enforces the
 *    cumulative cap, and serializes with an advisory lock
 *  - ClickPesa dedup fallback id is a sha256, final updateMany tenant-scoped
 *  - reconciliation routes through the shared settlement + conditional age-fail
 */

const TENANT = 't1';
const admin = { id: 'a1', isAdmin: true };
const customer = { id: 'u1' };

function makeProvider(overrides: Record<string, any> = {}) {
  return {
    code: 'SELCOM',
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    initiatePayment: jest.fn().mockResolvedValue({ success: true, transactionId: 'gw1' }),
    checkPaymentStatus: jest.fn(),
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    order: { findFirst: jest.fn() },
    rentalOrder: { findFirst: jest.fn() },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pNew', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentMethod: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ integrationParams: { clientId: 'c', apiKey: 'k', checksumSecret: 's' } }),
    },
    tenant: { findUnique: jest.fn() },
    webhookEvent: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

function makeService(prisma: any, provider: any) {
  const registry = {
    resolve: jest.fn().mockReturnValue(provider),
    has: jest.fn().mockReturnValue(true),
    list: jest.fn().mockReturnValue(['SELCOM', 'CLICKPESA_MIXX']),
  };
  const settlement = {
    applyGatewayResult: jest.fn().mockResolvedValue({ applied: true, status: 'COMPLETED', amountShort: false }),
    settleParents: jest.fn(),
  };
  const tenantContext = { requireId: TENANT };
  const svc = new PaymentsService(prisma, registry as any, tenantContext as any, settlement as any);
  return { svc, registry, settlement };
}

const dto = { orderId: 'o1', amount: 1000, method: 'CARD' } as any;
const openOrder = { id: 'o1', orderNumber: 'N1', status: 'PENDING', paymentStatus: 'PENDING', total: 1000 };

describe('PaymentsService.handleWebhook — signature + provider scoping', () => {
  it('rejects when no raw body is available (verification is mandatory)', async () => {
    const prisma = makePrisma();
    const provider = makeProvider();
    const { svc } = makeService(prisma, provider);
    await expect(svc.handleWebhook({ order_id: 'NARO-1-2', status: 'SUCCESS' }, undefined, 'sig'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    const prisma = makePrisma();
    const provider = makeProvider({ verifyWebhookSignature: jest.fn().mockReturnValue(false) });
    const { svc } = makeService(prisma, provider);
    await expect(svc.handleWebhook({ order_id: 'x', status: 'SUCCESS' }, '{"raw":1}', 'bad'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('{"raw":1}', 'bad', undefined);
  });

  it('looks the payment up by providerCode (Selcom cannot settle a ClickPesa payment)', async () => {
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1', status: 'PROCESSING', amount: 1000, orderId: 'o1', rentalOrderId: null, providerTransactionId: null });
    const { svc, settlement } = makeService(prisma, makeProvider());
    await svc.handleWebhook({ order_id: 'NARO-1-2', status: 'SUCCESS', amount: 1000 }, '{}', 'sig');
    expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT,
      providerCode: 'SELCOM',
      transactionRef: { in: ['NARO-1-2'] },
    });
    const call = settlement.applyGatewayResult.mock.calls[0][0];
    expect(call.status).toBe('COMPLETED');
    expect(call.reportedAmount).toBe(1000);
  });

  it('denormalizes ClickPesa refs correctly (13-digit timestamp)', () => {
    const { svc } = makeService(makePrisma(), makeProvider());
    expect(svc.denormalizeClickPesaRef('NARO17123456789011234')).toBe('NARO-1712345678901-1234');
  });
});

describe('PaymentsService.initiateGatewayPayment — payable checks, cap, lock', () => {
  it('takes a per-order advisory lock inside the transaction', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue(openOrder);
    const { svc } = makeService(prisma, makeProvider());
    await svc.initiateGatewayPayment(dto, admin);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const sqlParts = prisma.$executeRaw.mock.calls[0][0].join('?');
    expect(sqlParts).toContain('pg_advisory_xact_lock(hashtext(');
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('payment:order:o1');
  });

  it.each([
    [{ status: 'CANCELLED' }],
    [{ status: 'REFUNDED' }],
    [{ paymentStatus: 'PAID' }],
    [{ paymentStatus: 'CANCELLED' }],
  ])('rejects an unpayable order %j', async (patch) => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue({ ...openOrder, ...patch });
    const { svc } = makeService(prisma, makeProvider());
    await expect(svc.initiateGatewayPayment(dto, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a cancelled/closed rental', async () => {
    const prisma = makePrisma();
    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'CLOSED', totalRentalPrice: 1000, damageDeposit: 0, lateFee: 0 });
    const { svc } = makeService(prisma, makeProvider());
    await expect(svc.initiateGatewayPayment({ rentalOrderId: 'r1', amount: 500, method: 'CARD' } as any, customer))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the cumulative cap: COMPLETED + in-flight + new ≤ total', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue(openOrder);
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 600 } }) // completed
      .mockResolvedValueOnce({ _sum: { amount: 0 } }); // in-flight
    const { svc } = makeService(prisma, makeProvider());
    await expect(svc.initiateGatewayPayment({ ...dto, amount: 500 }, admin))
      .rejects.toThrow(/outstanding balance \(400\)/);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rental cap allows price + deposit + late fee', async () => {
    const prisma = makePrisma();
    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', rentalNumber: 'R1', status: 'RETURNED', totalRentalPrice: 1000, damageDeposit: 300, lateFee: 200 });
    const { svc } = makeService(prisma, makeProvider());
    const res = await svc.initiateGatewayPayment({ rentalOrderId: 'r1', amount: 1500, method: 'CARD' } as any, customer);
    expect(res.status).toBe('PROCESSING');
  });

  it('returns a recent in-flight payment instead of charging twice', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue(openOrder);
    prisma.payment.findFirst.mockResolvedValue({ id: 'pOld', transactionRef: 'NARO-OLD', status: 'PROCESSING', providerCode: 'SELCOM' });
    const provider = makeProvider();
    const { svc } = makeService(prisma, provider);
    const res: any = await svc.initiateGatewayPayment(dto, admin);
    expect(res.duplicate).toBe(true);
    expect(res.paymentId).toBe('pOld');
    expect(provider.initiatePayment).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('gateway result write is conditional on PENDING (never overwrites a raced webhook)', async () => {
    const prisma = makePrisma();
    prisma.order.findFirst.mockResolvedValue(openOrder);
    const { svc } = makeService(prisma, makeProvider());
    await svc.initiateGatewayPayment(dto, admin);
    expect(prisma.payment.updateMany.mock.calls[0][0].where).toEqual({ id: 'pNew', tenantId: TENANT, status: 'PENDING' });
  });
});

describe('PaymentsService.handleClickPesaWebhook — tenant-scoped dedup', () => {
  it('uses a sha256 fallback event id and tenant-scoped processed flag', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT, status: 'ACTIVE' });
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1', status: 'PROCESSING', amount: 1000, orderId: 'o1', rentalOrderId: null });
    const provider = makeProvider({ code: 'CLICKPESA_MIXX' });
    const { svc } = makeService(prisma, provider);

    const rawBody = '{"event":"PAYMENT RECEIVED","data":{"status":"SUCCESS"},"checksum":"c"}';
    await svc.handleClickPesaWebhook({
      tenantSlug: 'naro', payload: JSON.parse(rawBody), rawBody, signature: undefined,
    }).catch(() => undefined);

    const created = prisma.webhookEvent.create.mock.calls[0][0].data;
    expect(created.tenantId).toBe(TENANT);
    expect(created.providerEventId).toMatch(/^[0-9a-f]{64}$/);
    expect(created.providerEventId).not.toBe(String(rawBody.length));
  });

  it('marks processed with a tenant-scoped updateMany', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT, status: 'ACTIVE' });
    prisma.payment.findFirst.mockResolvedValue({ id: 'p1', status: 'PROCESSING', amount: 1000, orderId: 'o1', rentalOrderId: null });
    const { svc } = makeService(prisma, makeProvider({ code: 'CLICKPESA_MIXX' }));
    const payload = { event: 'PAYMENT RECEIVED', data: { id: 'evt1', orderReference: 'NARO17123456789011234', status: 'SUCCESS' }, checksum: 'c' };
    await svc.handleClickPesaWebhook({ tenantSlug: 'naro', payload, rawBody: JSON.stringify(payload), signature: undefined });

    expect(prisma.webhookEvent.updateMany.mock.calls[0][0].where).toEqual({
      tenantId: TENANT, providerCode: 'CLICKPESA_MIXX', providerEventId: 'evt1', eventType: 'PAYMENT RECEIVED',
    });
    // ClickPesa lookup is provider-scoped and includes the denormalized ref.
    expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT,
      providerCode: 'CLICKPESA_MIXX',
      transactionRef: { in: ['NARO17123456789011234', 'NARO-1712345678901-1234'] },
    });
  });
});

describe('PaymentsReconciliationService — shared settlement + conditional timeout', () => {
  const config = { get: (_k: string, d: string) => d } as any;
  const pay = {
    id: 'p1', tenantId: TENANT, transactionRef: 'NARO-1-2', orderId: 'o1', rentalOrderId: null,
    createdAt: new Date(0), providerCode: 'CLICKPESA_MIXX', status: 'PROCESSING', amount: 1000,
  };

  it('applies a terminal gateway status through PaymentSettlementService with the collected amount', async () => {
    const prisma = makePrisma();
    const provider = makeProvider({
      checkPaymentStatus: jest.fn().mockResolvedValue({ success: true, status: 'COMPLETED', collectedAmount: 10 }),
    });
    const settlement = { applyGatewayResult: jest.fn().mockResolvedValue({}) };
    const registry = { resolve: () => provider } as any;
    const svc = new PaymentsReconciliationService(prisma, registry, config, settlement as any);
    await svc.reconcileOne(pay, new Date());
    expect(settlement.applyGatewayResult).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, status: 'COMPLETED', reportedAmount: 10, source: 'reconcile' }),
    );
  });

  it('age-fail is conditional on PENDING/PROCESSING (never downgrades COMPLETED)', async () => {
    const prisma = makePrisma();
    const provider = makeProvider({
      checkPaymentStatus: jest.fn().mockResolvedValue({ success: true, status: 'PROCESSING' }),
    });
    const settlement = new PaymentSettlementService(prisma);
    const svc = new PaymentsReconciliationService(prisma, { resolve: () => provider } as any, config, settlement);
    await svc.reconcileOne(pay, new Date());
    const failCall = prisma.payment.updateMany.mock.calls.find((c: any[]) => c[0].data.status === 'FAILED');
    expect(failCall[0].where).toEqual({ id: 'p1', tenantId: TENANT, status: { in: ['PENDING', 'PROCESSING'] } });
  });
});

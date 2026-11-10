import { readFileSync } from 'fs';
import { join } from 'path';
import { paymentConfirmationState, withConfirmation, PAYMENT_CONFIRMATION_LABELS } from './payment-confirmation';
import { PaymentsService } from './payments.service';
import { PaymentSettlementService } from './payment-settlement.service';

/**
 * P0c: pending, manually confirmed, provider-confirmed, reversed and refunded
 * payments stay DISTINCT, and a manual confirmation is never presented as
 * provider confirmation.
 */
const T = 't1';
const manualPos = { verification: { method: 'MANUAL_TERMINAL', providerVerified: false, evidence: 'manual', reference: 'R1', confirmedByAdminId: 'a1' }, posSessionId: 's1' };
const provider = { provider: 'selcom', _settlement: { providerVerified: true, source: 'webhook:SELCOM', at: '2026-11-10T00:00:00Z' } };

describe('paymentConfirmationState', () => {
  it.each([
    ['PENDING', 'MOBILE_MONEY', {}, 'PENDING'],
    ['PROCESSING', 'MOBILE_MONEY', provider, 'PENDING'],
    ['COMPLETED', 'CARD', manualPos, 'MANUALLY_CONFIRMED'],
    ['COMPLETED', 'MOBILE_MONEY', { manualStatusChange: { to: 'COMPLETED', byAdminId: 'a1', providerVerified: false } }, 'MANUALLY_CONFIRMED'],
    ['COMPLETED', 'MOBILE_MONEY', provider, 'PROVIDER_CONFIRMED'],
    ['COMPLETED', 'CASH', { posSessionId: 's1', tendered: 5000 }, 'CASH_RECEIVED'],
    ['COMPLETED', 'CARD', { posSessionId: 's1' }, 'UNVERIFIED'], // pre-P0c POS card "paid on click"
    ['COMPLETED', 'MOBILE_MONEY', { provider: 'selcom' }, 'UNVERIFIED'], // legacy row: no settlement stamp
    ['COMPLETED', 'MOBILE_MONEY', null, 'UNVERIFIED'],
    ['REVERSED', 'CARD', { ...manualPos, reversal: { reason: 'not on terminal report' } }, 'REVERSED'],
    ['REFUNDED', 'MOBILE_MONEY', provider, 'REFUNDED'],
    ['FAILED', 'MOBILE_MONEY', {}, 'FAILED'],
    ['CANCELLED', 'MOBILE_MONEY', {}, 'CANCELLED'],
  ])('%s %s %j → %s', (status, method, gatewayResponse, want) => {
    expect(paymentConfirmationState({ status, method, gatewayResponse })).toBe(want);
  });

  it('manual evidence always wins: a row with both a manual record and a provider stamp is MANUALLY_CONFIRMED', () => {
    expect(paymentConfirmationState({ status: 'COMPLETED', method: 'CARD', gatewayResponse: { ...manualPos, ...provider } })).toBe('MANUALLY_CONFIRMED');
    expect(paymentConfirmationState({ status: 'COMPLETED', method: 'CARD', gatewayResponse: { ...provider, manualStatusChange: { providerVerified: false } } })).toBe('MANUALLY_CONFIRMED');
  });

  it('the five required states are all distinct, with distinct labels', () => {
    const states = ['PENDING', 'MANUALLY_CONFIRMED', 'PROVIDER_CONFIRMED', 'REVERSED', 'REFUNDED'] as const;
    const labels = states.map((s) => PAYMENT_CONFIRMATION_LABELS[s]);
    expect(new Set(labels).size).toBe(5);
    expect(PAYMENT_CONFIRMATION_LABELS.MANUALLY_CONFIRMED).toMatch(/not verified by the provider/);
    expect(PAYMENT_CONFIRMATION_LABELS.MANUALLY_CONFIRMED).not.toMatch(/^Confirmed by the payment provider/);
  });

  it('withConfirmation only adds read-side fields', () => {
    const row = { id: 'p1', status: 'COMPLETED', method: 'CARD', gatewayResponse: manualPos, amount: 1 };
    const out = withConfirmation(row);
    expect(out).toEqual({ ...row, confirmationState: 'MANUALLY_CONFIRMED', confirmationLabel: PAYMENT_CONFIRMATION_LABELS.MANUALLY_CONFIRMED });
  });
});

describe('admin status edits are recorded as MANUAL confirmations', () => {
  function make(payment: any) {
    const prisma: any = {
      payment: {
        findFirst: jest.fn().mockResolvedValueOnce(payment).mockResolvedValue({ ...payment, status: 'COMPLETED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const svc = new PaymentsService(prisma, {} as any, { requireId: T } as any, { settleParents: jest.fn() } as any);
    return { svc, prisma };
  }
  const gw = { id: 'p1', tenantId: T, status: 'PENDING', method: 'MOBILE_MONEY', gatewayResponse: { provider: 'selcom', ref: 'S1' } };

  it('PENDING → COMPLETED stamps who did it, providerVerified:false, keeping the provider record', async () => {
    const { svc, prisma } = make(gw);
    await svc.updateStatus('p1', { status: 'COMPLETED', gatewayResponse: { note: 'bank statement' } } as any, 'admin-9');
    const data = prisma.payment.updateMany.mock.calls[0][0].data;
    expect(data.gatewayResponse).toMatchObject({ provider: 'selcom', ref: 'S1', note: 'bank statement' });
    expect(data.gatewayResponse.manualStatusChange).toMatchObject({ from: 'PENDING', to: 'COMPLETED', byAdminId: 'admin-9', providerVerified: false });
    expect(paymentConfirmationState({ status: 'COMPLETED', method: gw.method, gatewayResponse: data.gatewayResponse })).toBe('MANUALLY_CONFIRMED');
  });

  it('the stamp is written even with no gatewayResponse in the request', async () => {
    const { svc, prisma } = make(gw);
    await svc.updateStatus('p1', { status: 'COMPLETED' } as any, 'admin-9');
    expect(prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse.manualStatusChange.providerVerified).toBe(false);
  });

  it('an admin can NOT fake provider confirmation: a supplied _settlement is dropped and the manual stamp wins', async () => {
    const { svc, prisma } = make(gw);
    await svc.updateStatus('p1', {
      status: 'COMPLETED',
      gatewayResponse: { _settlement: { providerVerified: true }, manualStatusChange: { providerVerified: true } },
    } as any, 'admin-9');
    const gr = prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse;
    expect(gr._settlement).toBeUndefined();
    expect(gr.manualStatusChange.providerVerified).toBe(false);
    expect(paymentConfirmationState({ status: 'COMPLETED', gatewayResponse: gr })).toBe('MANUALLY_CONFIRMED');
  });

  it('a non-confirming edit (PENDING → FAILED) adds no stamp', async () => {
    const { svc, prisma } = make(gw);
    await svc.updateStatus('p1', { status: 'FAILED' } as any, 'admin-9');
    expect(prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse).toBeUndefined();
  });

  it('the controller passes the signed-in admin as the actor', () => {
    const src = readFileSync(join(__dirname, 'payments.controller.ts'), 'utf8');
    expect(src).toMatch(/@CurrentUser\('id'\) actorId: string,\s*\)\s*\{\s*return this\.paymentsService\.updateStatus\(id, dto, actorId\);/);
  });
});

describe('gateway settlement is the only source of PROVIDER_CONFIRMED', () => {
  const basePayment = { id: 'p1', status: 'PENDING', amount: 50000, orderId: null, rentalOrderId: null };
  const make = () => {
    const prisma: any = {
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
      order: { findFirst: jest.fn(), updateMany: jest.fn() },
      rentalOrder: { findFirst: jest.fn(), updateMany: jest.fn() },
    };
    return { prisma, svc: new PaymentSettlementService(prisma) };
  };

  it('a full COMPLETED from the gateway stamps _settlement.providerVerified', async () => {
    const { prisma, svc } = make();
    await svc.applyGatewayResult({ payment: basePayment as any, tenantId: T, status: 'COMPLETED', reportedAmount: 50000, gatewayResponse: { result: 'SUCCESS', ref: 'X' }, source: 'webhook:SELCOM' });
    const gr = prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse;
    expect(gr).toMatchObject({ result: 'SUCCESS', ref: 'X', _settlement: { providerVerified: true, source: 'webhook:SELCOM' } });
    expect(paymentConfirmationState({ status: 'COMPLETED', gatewayResponse: gr })).toBe('PROVIDER_CONFIRMED');
  });

  it('a SHORT amount is held as PROCESSING and never stamped', async () => {
    const { prisma, svc } = make();
    await svc.applyGatewayResult({ payment: basePayment as any, tenantId: T, status: 'COMPLETED', reportedAmount: 100, gatewayResponse: { ref: 'X' }, source: 'poll' });
    const data = prisma.payment.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('PROCESSING');
    expect(data.gatewayResponse._settlement).toBeUndefined();
    expect(data.gatewayResponse._amountMismatch).toBeDefined();
  });

  it('PROCESSING / FAILED updates are not stamped', async () => {
    for (const status of ['PROCESSING', 'FAILED'] as const) {
      const { prisma, svc } = make();
      await svc.applyGatewayResult({ payment: basePayment as any, tenantId: T, status, reportedAmount: null, gatewayResponse: { s: status }, source: 'poll' });
      expect(prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse).toEqual({ s: status });
    }
  });

  it('with no gateway payload nothing is written to gatewayResponse (no record is replaced)', async () => {
    const { prisma, svc } = make();
    await svc.applyGatewayResult({ payment: basePayment as any, tenantId: T, status: 'COMPLETED', reportedAmount: 50000, source: 'reconcile' });
    expect(prisma.payment.updateMany.mock.calls[0][0].data.gatewayResponse).toBeUndefined();
  });
});

describe('where the states are shown', () => {
  it('order and rental payment lists carry the state; the POS receipt shows the label for non-cash', () => {
    const svc = readFileSync(join(__dirname, 'payments.service.ts'), 'utf8');
    expect(svc.match(/return rows\.map\(withConfirmation\);/g)).toHaveLength(2);
    const pos = readFileSync(join(__dirname, '..', 'pos', 'pos.service.ts'), 'utf8');
    expect(pos).toMatch(/confirmationLabel: c\.confirmationLabel/);
    const receipt = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'app', 'dashboard', 'pos', 'components', 'ReceiptModal.tsx'), 'utf8');
    expect(receipt).toMatch(/p\.confirmationState !== 'CASH_RECEIVED'/);
    expect(receipt).toMatch(/\{p\.confirmationLabel\}/);
  });
});

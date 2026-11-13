import { readFileSync } from 'fs';
import { join } from 'path';
import { CANCELLATION_REASONS, holdExpiryCancellationReason, requestCancellationRefunds, SYSTEM_REQUESTER } from './cancellation';

// Round 25C F — full refund before collection, no forfeiture; the cancellation
// and the refund are separate; requests are idempotent and race-safe.
function fakeTx(opts: { status?: string; payments?: any[]; requests?: any[] } = {}) {
  const requests = [...(opts.requests ?? [])];
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    rentalOrder: {
      findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'RNT-1', status: opts.status ?? 'CANCELLED', totalRentalPrice: 400000, damageDeposit: 200000, downPaymentAmount: 100000 })),
    },
    payment: { findMany: jest.fn(async () => opts.payments ?? []) },
    refundRequest: {
      findMany: jest.fn(async () => requests),
      create: jest.fn(async ({ data }: any) => { const row = { id: `rq${requests.length + 1}`, status: 'REQUESTED', ...data }; requests.push(row); return row; }),
    },
  };
  return { tx, requests };
}
const paid = (component: string, amount: number, status = 'COMPLETED') => ({ component, amount, status });

describe('requestCancellationRefunds', () => {
  it('raises one CANCELLATION request per component for the money actually received (fee + deposit), under the rental refund lock', async () => {
    const { tx } = fakeTx({ payments: [paid('RENTAL_FEE', 100000), paid('DEPOSIT', 200000)] });
    const out = await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'CUSTOMER_REQUEST');
    expect(out.map((r) => [r.component, r.amount])).toEqual([['RENTAL_FEE', 100000], ['DEPOSIT', 200000]]);
    expect(tx.refundRequest.create.mock.calls[0][0].data).toMatchObject({ kind: 'CANCELLATION', retainedAmount: 0, requestedById: 'staff1', tenantId: 't1', rentalOrderId: 'r1' });
    expect(String(tx.$executeRaw.mock.calls[0][1])).toBe('refund:rental:r1');
  });

  it('is idempotent: a second call (replayed webhook, double click, cron re-run) creates nothing', async () => {
    const { tx } = fakeTx({ payments: [paid('RENTAL_FEE', 100000)] });
    await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'CUSTOMER_REQUEST');
    expect(await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'CUSTOMER_REQUEST')).toEqual([]);
    expect(tx.refundRequest.create).toHaveBeenCalledTimes(1);
  });

  it('pending and failed payments are not received money; a late completion raises only the new part', async () => {
    const payments = [paid('RENTAL_FEE', 100000), paid('RENTAL_FEE', 50000, 'PENDING'), paid('DEPOSIT', 200000, 'FAILED')];
    const { tx } = fakeTx({ payments });
    expect((await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'X')).map((r) => r.amount)).toEqual([100000]);
    payments[1].status = 'COMPLETED'; // the gateway confirms later (late arrival)
    const late = await requestCancellationRefunds(tx, 't1', 'r1', SYSTEM_REQUESTER.LATE_PAYMENT, 'X');
    expect(late.map((r) => [r.component, r.amount])).toEqual([['RENTAL_FEE', 50000]]);
  });

  it('no duplicate liability: open (REQUESTED / APPROVED / PAYING) and paid requests already cover the money', async () => {
    const { tx } = fakeTx({
      payments: [paid('RENTAL_FEE', 100000), paid('DEPOSIT', 200000), { component: 'DEPOSIT', amount: 50000, status: 'REFUNDED' }],
      requests: [
        { component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'PAYING' },
        { component: 'DEPOSIT', amount: 100000, retainedAmount: 0, status: 'APPROVED' },
      ],
    });
    expect((await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'X')).map((r) => [r.component, r.amount])).toEqual([['DEPOSIT', 50000]]);
  });

  it('a FAILED payout makes the money owed again: re-raising requests it (REJECTED / FAILED are not open)', async () => {
    const { tx } = fakeTx({ payments: [paid('RENTAL_FEE', 100000)], requests: [{ component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'FAILED' }] });
    expect((await requestCancellationRefunds(tx, 't1', 'r1', 'staff2', 'X')).map((r) => r.amount)).toEqual([100000]);
  });

  it('nothing for a booking that is not CANCELLED (e.g. handed over: the return process applies)', async () => {
    const { tx } = fakeTx({ status: 'ACTIVE', payments: [paid('RENTAL_FEE', 400000)] });
    expect(await requestCancellationRefunds(tx, 't1', 'r1', 'staff1', 'X')).toEqual([]);
  });
});

describe('structured reasons and where they are set', () => {
  it('reason list, and the hold job maps an expired ID hold to ID_FAILED, anything else to PAYMENT_EXPIRED', () => {
    expect(CANCELLATION_REASONS).toEqual(['CUSTOMER_REQUEST', 'SHOP', 'PAYMENT_EXPIRED', 'ID_FAILED', 'DUPLICATE', 'NO_SHOW', 'OTHER']);
    for (const s of ['AWAITING_ID', 'ID_REJECTED', 'ID_UNDER_REVIEW']) expect(holdExpiryCancellationReason(s)).toBe('ID_FAILED');
    for (const s of ['AWAITING_DOWN_PAYMENT', 'NO_DOWN_PAYMENT', null]) expect(holdExpiryCancellationReason(s)).toBe('PAYMENT_EXPIRED');
  });

  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
  it('staff cancel, the hold job and late payments all raise the requests; no path forfeits or pays out', () => {
    const svc = read('rentals.service.ts');
    expect(svc).toMatch(/status === 'CANCELLED'\) \{\s*\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s*cancellationRefunds = await requestCancellationRefunds\(tx,/);
    expect(svc).toMatch(/status === 'CANCELLED' \? await this\.prisma\.\$transaction\(write\)/);
    expect(read('../scheduler/scheduler.service.ts')).toMatch(/requestCancellationRefunds\(tx, r\.tenantId, r\.id, SYSTEM_REQUESTER\.HOLD_EXPIRY/);
    expect(read('../payments/payment-settlement.service.ts')).toMatch(/requestCancellationRefunds\(\s*tx, tenantId, rental\.id, SYSTEM_REQUESTER\.LATE_PAYMENT/);
    const core = read('cancellation.ts');
    expect(core).not.toMatch(/payment\.create|status: 'PAID'|REFUNDED'/);
    expect(core).toMatch(/retainedAmount: 0/);
  });
});

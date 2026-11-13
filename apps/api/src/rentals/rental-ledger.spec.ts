import { ConflictException, ForbiddenException } from '@nestjs/common';
import { collectable, refundableNow, rentalBalances } from './rental-ledger';
import { RentalMoneyService } from './rental-money.service';

const rental = { totalRentalPrice: 400000, damageDeposit: 200000, lateFee: 0, downPaymentAmount: 100000 };
const pay = (amount: number, component: string | null = null, status = 'COMPLETED') => ({ amount, component, status });

describe('rentalBalances (pure ledger)', () => {
  it('splits components; a DEPOSIT payment never counts towards the fee / down payment', () => {
    const b = rentalBalances(rental, [pay(200000, 'DEPOSIT')]);
    expect(b.collected).toEqual({ RENTAL_FEE: 0, DEPOSIT: 200000, LATE_FEE: 0 });
    expect([b.downPaymentCovered, b.depositFullyPaid, b.feeFullyPaid]).toEqual([false, true, false]);
    expect(b.held.DEPOSIT).toBe(200000);
  });

  it('unallocated (online / legacy) money goes fee first, then deposit, then late fee, then overpaid', () => {
    const b = rentalBalances({ ...rental, lateFee: 40000 }, [pay(700000)]);
    expect(b.collected).toEqual({ RENTAL_FEE: 400000, DEPOSIT: 200000, LATE_FEE: 40000 });
    expect(b.overpaid).toBe(60000);
    expect(b.totalHeld).toBe(700000);
  });

  it('down payment covered only by fee money; pending / failed / reversed rows are not money', () => {
    const b = rentalBalances(rental, [pay(100000, 'RENTAL_FEE'), pay(300000, 'RENTAL_FEE', 'PENDING'), pay(5, null, 'REVERSED'), pay(5, null, 'FAILED')]);
    expect([b.downPaymentCovered, b.feeFullyPaid, b.outstanding.RENTAL_FEE]).toEqual([true, false, 300000]);
  });

  it('refund rows reduce what is held for their component; never below 0; cents exact', () => {
    const b = rentalBalances(rental, [pay(200000.01, 'DEPOSIT'), pay(150000, 'DEPOSIT', 'REFUNDED')]);
    expect(b.held.DEPOSIT).toBe(50000.01);
    expect(b.refunded.DEPOSIT).toBe(150000);
  });

  it('a PAID deposit return that retained damage: the kept part is no longer held (it is income)', () => {
    const b = rentalBalances(rental, [pay(200000, 'DEPOSIT'), pay(150000, 'DEPOSIT', 'REFUNDED')], [
      { component: 'DEPOSIT', amount: 150000, retainedAmount: 50000, status: 'PAID' },
    ]);
    expect([b.held.DEPOSIT, b.retained.DEPOSIT]).toEqual([0, 50000]);
    // an unpaid / failed request keeps nothing
    const f = rentalBalances(rental, [pay(200000, 'DEPOSIT')], [{ component: 'DEPOSIT', retainedAmount: 50000, status: 'FAILED' }]);
    expect(f.held.DEPOSIT).toBe(200000);
  });

  it('collectable and refundableNow (minus what open requests already claim)', () => {
    const b = rentalBalances(rental, [pay(100000, 'RENTAL_FEE'), pay(200000, 'DEPOSIT')]);
    expect(collectable(b, 'RENTAL_FEE')).toBe(300000);
    expect(collectable(b, 'DEPOSIT')).toBe(0);
    expect(refundableNow(b, 'DEPOSIT', [{ component: 'DEPOSIT', amount: 120000, retainedAmount: 30000, status: 'APPROVED' }])).toBe(50000);
    expect(refundableNow(b, 'DEPOSIT', [{ component: 'DEPOSIT', amount: 120000, status: 'REJECTED' }])).toBe(200000);
  });
});

// ---------------------------------------------------------------------------
describe('RentalMoneyService (refund workflow)', () => {
  const tenant = { requireId: 't1' } as any;
  function make(opts: { rental?: any; payments?: any[]; requests?: any[]; request?: any; cas?: number; session?: any } = {}) {
    const audit = { log: jest.fn() };
    const r = opts.rental ?? { id: 'r1', rentalNumber: 'RNT-1', status: 'CANCELLED', holdState: 'REFUND_DUE', ...rental };
    const db: any = {
      $executeRaw: jest.fn(),
      rentalOrder: { findFirst: jest.fn(async () => r), updateMany: jest.fn(async () => ({ count: 1 })) },
      payment: {
        findMany: jest.fn(async () => opts.payments ?? [{ id: 'p1', ...pay(100000, 'RENTAL_FEE') }]),
        create: jest.fn(async ({ data }: any) => ({ id: 'refund1', ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => null),
      },
      refundRequest: {
        findMany: jest.fn(async () => opts.requests ?? []),
        create: jest.fn(async ({ data }: any) => ({ id: 'q1', ...data })),
        // a payoutReference lookup is the duplicate-reference check (none here)
        findFirst: jest.fn(async (q: any) => (q?.where?.payoutReference ? null : opts.request ?? null)),
        updateMany: jest.fn(async () => ({ count: opts.cas ?? 1 })),
      },
      posSession: { findFirst: jest.fn(async () => opts.session ?? null) },
    };
    db.$transaction = jest.fn(async (cb: any) => cb(db));
    return { svc: new RentalMoneyService(db, tenant, audit as any), db, audit };
  }

  it('request: capped at what is held for the component, under the per-rental lock; audited', async () => {
    const { svc, db, audit } = make();
    await svc.createRequest('r1', { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'Customer cancelled' }, { id: 'a1' });
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.refundRequest.create.mock.calls[0][0].data).toMatchObject({ amount: 100000, requestedById: 'a1' }); // status defaults to REQUESTED in the DB
    expect(audit.log).toHaveBeenCalledWith('REFUND_REQUESTED', 'RefundRequest', 'q1', expect.objectContaining({ amount: 100000 }));
    await expect(make().svc.createRequest('r1', { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100001, reason: 'x' }, { id: 'a1' })).rejects.toThrow(/more than the 100000 TZS/);
    // already claimed by an open request → partial left
    const claimed = make({ requests: [{ component: 'RENTAL_FEE', amount: 60000, status: 'REQUESTED' }] });
    await expect(claimed.svc.createRequest('r1', { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 50000, reason: 'x' }, { id: 'a1' })).rejects.toThrow(/40000 TZS/);
  });

  it('request rules: cancellation needs CANCELLED; deposit return needs a returned item and the DEPOSIT component; retain only on deposit returns', async () => {
    await expect(make({ rental: { id: 'r1', rentalNumber: 'R', status: 'ID_VERIFIED', ...rental } }).svc.createRequest('r1', { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 1, reason: 'x' }, { id: 'a' })).rejects.toThrow(/CANCELLED/);
    await expect(make({ rental: { id: 'r1', rentalNumber: 'R', status: 'ACTIVE', ...rental } }).svc.createRequest('r1', { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 1, reason: 'x' }, { id: 'a' })).rejects.toThrow(/returned/);
    await expect(make().svc.createRequest('r1', { kind: 'DEPOSIT_RETURN', component: 'RENTAL_FEE', amount: 1, reason: 'x' }, { id: 'a' })).rejects.toThrow(/DEPOSIT component/);
    await expect(make().svc.createRequest('r1', { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 1, retainedAmount: 1, reason: 'x' }, { id: 'a' })).rejects.toThrow(/Only a deposit return/);
  });

  it('approve: four-eyes (requester can never approve), CAS on REQUESTED, audited', async () => {
    const req = { id: 'q1', rentalOrderId: 'r1', requestedById: 'a1', amount: 100000, retainedAmount: 0, status: 'REQUESTED' };
    const self = make({ request: req });
    await expect(self.svc.approve('q1', { id: 'a1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(self.audit.log).toHaveBeenCalledWith('REFUND_APPROVAL_DENIED', 'RefundRequest', 'q1', { reason: 'SELF_APPROVAL' });
    expect(self.db.refundRequest.updateMany).not.toHaveBeenCalled();
    const ok = make({ request: req });
    await ok.svc.approve('q1', { id: 'a2' });
    expect(ok.db.refundRequest.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'REQUESTED' }, data: { status: 'APPROVED', approvedById: 'a2' } });
    await expect(make({ request: req, cas: 0 }).svc.approve('q1', { id: 'a2' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('pay: a NEW linked REFUNDED row (component, source payment, request), request PAID, settled flag; never edits the collection', async () => {
    const req = { id: 'q1', rentalOrderId: 'r1', requestedById: 'a1', approvedById: 'a2', kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'APPROVED' };
    const { svc, db } = make({ request: req, requests: [req] });
    await svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'mp 12345' }, { id: 'fin' });
    const row = db.payment.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ status: 'REFUNDED', amount: 100000, component: 'RENTAL_FEE', refundOfPaymentId: 'p1', refundRequestId: 'q1', transactionRef: 'MP12345' });
    expect(db.payment.updateMany).not.toHaveBeenCalled();
    expect(db.rentalOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { holdState: 'REFUND_SETTLED' } }));
  });

  it('pay guards: non-cash needs a reference; cash needs the payer\'s OPEN shift; only APPROVED; re-capped under the lock', async () => {
    const req = { id: 'q1', rentalOrderId: 'r1', requestedById: 'a1', approvedById: 'a2', kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'APPROVED' };
    await expect(make({ request: req }).svc.pay('q1', { method: 'BANK_TRANSFER' }, { id: 'fin' })).rejects.toThrow(/payout reference/);
    await expect(make({ request: req }).svc.pay('q1', { method: 'CASH' }, { id: 'fin' })).rejects.toThrow(/OPEN POS shift/);
    const cash = make({ request: req, requests: [req], session: { id: 's1' } });
    await cash.svc.pay('q1', { method: 'CASH', sessionId: 's1' }, { id: 'fin' });
    expect(cash.db.payment.create.mock.calls[0][0].data.gatewayResponse.posSessionId).toBe('s1');
    await expect(make({ request: { ...req, status: 'REQUESTED' } }).svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP1234' }, { id: 'fin' })).rejects.toThrow(/Only an APPROVED/);
    const over = make({ request: { ...req, amount: 150000 }, requests: [{ ...req, amount: 150000 }] });
    await expect(over.svc.pay('q1', { method: 'MOBILE_MONEY', reference: 'MP1234' }, { id: 'fin' })).rejects.toThrow(/still held/);
    expect(over.db.payment.create).not.toHaveBeenCalled();
  });

  it('fail: PAID → FAILED, the refund row REVERSED (liability back), settled flag reopened; audited', async () => {
    const req = { id: 'q1', rentalOrderId: 'r1', status: 'PAID', amount: 100000, retainedAmount: 0 };
    const { svc, db, audit } = make({ request: req });
    await svc.fail('q1', { reason: 'Mobile money reversed' }, { id: 'fin' });
    expect(db.payment.updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1', refundRequestId: 'q1', status: 'REFUNDED' }, data: { status: 'REVERSED' } });
    expect(db.rentalOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { holdState: 'REFUND_DUE' } }));
    expect(audit.log).toHaveBeenCalledWith('REFUND_FAILED', 'RefundRequest', 'q1', expect.objectContaining({ reason: 'Mobile money reversed', failedById: 'fin', amount: 100000 }));
  });
});

describe('round 25D E (R1): overpayment claims are claims on the surplus, not on a component', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { rentalBalances, refundableNow, overpaymentRefundableNow } = require('./rental-ledger');
  const rental = { totalRentalPrice: 400000, damageDeposit: 200000, lateFee: 0, downPaymentAmount: 100000 };
  const pays = [{ amount: 100000, status: 'COMPLETED', component: 'RENTAL_FEE' }, { amount: 600000, status: 'COMPLETED', component: null }];
  it('an open OVERPAYMENT request leaves the fee fully refundable and claims the surplus once', () => {
    const b = rentalBalances(rental, pays);
    const open = [{ kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 100000, retainedAmount: 0, status: 'APPROVED' }];
    expect([b.overpaid, refundableNow(b, 'RENTAL_FEE', open), overpaymentRefundableNow(b, open), overpaymentRefundableNow(b, [])]).toEqual([100000, 400000, 0, 100000]);
  });
  it('an overpayment payout without a component comes off the surplus, not the fee held', () => {
    const b = rentalBalances(rental, [...pays, { amount: 100000, status: 'REFUNDED', component: null }]);
    expect([b.held.RENTAL_FEE, b.held.DEPOSIT, b.overpaid]).toEqual([400000, 200000, 0]);
  });
});

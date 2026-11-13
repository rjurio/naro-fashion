import { payoutSubject, receiptCategory, reconcileShift, ReconPayment } from './shift-reconciliation';

const S = 'shift-1';
const T0 = new Date('2026-11-13T06:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60000);
let n = 0;
const pay = (o: Partial<ReconPayment>): ReconPayment => ({
  id: `p${++n}`,
  amount: 0,
  method: 'CASH',
  status: 'COMPLETED',
  createdAt: at(5),
  gatewayResponse: { posSessionId: S },
  ...o,
});
const session = {
  id: S,
  adminUserId: 'cashier',
  openedAt: T0,
  closedAt: at(600),
  openingCash: 50000,
  closingCash: null as unknown,
  expectedCash: null as unknown,
  cashDifference: null as unknown,
  status: 'CLOSED',
};
const emptyLiab = { rentals: [], layaways: [], refundRequests: [] };
const run = (tagged: ReconPayment[], extra: any = {}) =>
  reconcileShift({
    session: { ...session, ...(extra.session ?? {}) },
    tagged,
    untaggedInWindow: extra.untagged ?? [],
    retainedDeposits: extra.retained ?? [],
    rentalsTouched: extra.rentalsTouched ?? [],
    liabilities: extra.liabilities ?? emptyLiab,
    now: at(700),
  });

describe('shift reconciliation (R4)', () => {
  const rental = 'r1';
  const shift = () => [
    pay({ orderId: 'o1', orderChannel: 'POS', amount: 30000 }), // cash sale
    pay({ orderId: 'o2', orderChannel: 'POS', amount: 45000, method: 'CARD' }), // card sale
    pay({ rentalOrderId: rental, component: 'RENTAL_FEE', amount: 100000 }),
    pay({ rentalOrderId: rental, component: 'DEPOSIT', amount: 200000 }),
    pay({ rentalOrderId: rental, component: 'LATE_FEE', amount: 10000 }),
    pay({ layawayId: 'l1', amount: 15000 }),
    pay({ rentalOrderId: rental, component: 'RENTAL_FEE', amount: 20000, method: 'MPESA' }),
    pay({ rentalOrderId: rental, component: 'DEPOSIT', amount: 150000, status: 'REFUNDED', refundSubject: 'RENTAL' }), // deposit returned in cash
    pay({ orderId: 'o1', orderChannel: 'POS', amount: 5000, status: 'REFUNDED', refundSubject: 'POS_SALE' }),
  ];

  it('expected cash = opening + cash in − cash out over rows tagged with the shift', () => {
    const r = run(shift(), { session: { closingCash: 205000, expectedCash: 205000, cashDifference: 0 } });
    // cash in: 30000 + 100000 + 200000 + 10000 + 15000 = 355000; out: 150000 + 5000
    expect(r.drawer.cashIn).toBe(355000);
    expect(r.drawer.cashOut).toBe(155000);
    expect(r.drawer.expectedCash).toBe(250000);
    expect(r.drawer.countedCash).toBe(205000);
    expect(r.drawer.difference).toBe(-45000);
    expect(r.checks.expectedMatchesClose).toBe(false); // stored 205000 ≠ recomputed 250000
  });

  it('puts each receipt in one category, split cash / non-cash and by method', () => {
    const r = run(shift());
    expect(r.receipts.POS_SALE).toMatchObject({ cash: 30000, nonCash: 45000, total: 75000, count: 2, byMethod: { CASH: 30000, CARD: 45000 } });
    expect(r.receipts.RENTAL_FEE).toMatchObject({ cash: 100000, nonCash: 20000, count: 2 });
    expect(r.receipts.DEPOSIT).toMatchObject({ cash: 200000, nonCash: 0 });
    expect(r.receipts.LATE_FEE.total).toBe(10000);
    expect(r.receipts.LAYAWAY.total).toBe(15000);
    expect(r.byMethod.MPESA).toEqual({ in: 20000, out: 0, net: 20000 });
    expect(r.checks).toMatchObject({ everyTaggedRowAccounted: true, receiptsAddUp: true, payoutsAddUp: true, expectedMatchesClose: null });
  });

  it('deposits and layaway instalments are liabilities, never income', () => {
    const r = run(shift());
    expect(r.receipts.DEPOSIT.nature).toBe('LIABILITY');
    expect(r.receipts.LAYAWAY.nature).toBe('LIABILITY');
    // income = sales 75000 + fee 120000 + late 10000; refunded: POS 5000
    expect(r.books.incomeReceived).toBe(205000);
    expect(r.books.incomeRefunded).toBe(5000);
    expect(r.books.netIncome).toBe(200000);
    expect(r.books.depositsReceived).toBe(200000);
    expect(r.books.depositsReturned).toBe(150000);
    expect(r.books.layawayPrepaymentsReceived).toBe(15000);
  });

  it('payouts by subject; a rental payout splits by component', () => {
    const r = run([
      ...shift(),
      pay({ orderId: 'o9', orderChannel: 'ONLINE', amount: 7000, status: 'REFUNDED' }),
      pay({ layawayId: 'l2', amount: 3000, status: 'REFUNDED', refundSubject: 'LAYAWAY' }),
      pay({ rentalOrderId: rental, component: 'RENTAL_FEE', amount: 1000, status: 'REFUNDED', method: 'MOBILE_MONEY' }),
    ]);
    expect(r.payouts.RENTAL).toMatchObject({ cash: 150000, nonCash: 1000, count: 2 });
    expect(r.payouts.POS_SALE.total).toBe(5000);
    expect(r.payouts.ORDER.total).toBe(7000);
    expect(r.payouts.LAYAWAY.total).toBe(3000);
    expect(r.rentalPayoutsByComponent.DEPOSIT.total).toBe(150000);
    expect(r.rentalPayoutsByComponent.RENTAL_FEE.total).toBe(1000);
    expect(r.books.incomeRefunded).toBe(5000 + 7000 + 1000);
    expect(r.books.layawayPrepaymentsReturned).toBe(3000);
  });

  it('a retained deposit becomes income only through a PAID request (no cash moves)', () => {
    const r = run(shift(), { retained: [{ refundRequestId: 'rr1', rentalOrderId: rental, retainedAmount: 50000 }] });
    expect(r.books.depositsRetainedAsIncome.amount).toBe(50000);
    expect(r.books.depositsRetainedAsIncome.refundRequestIds).toEqual(['rr1']);
    expect(r.drawer.cashOut).toBe(155000); // unchanged
  });

  it('reversed and non-money rows are listed, never counted', () => {
    const r = run([pay({ amount: 9000, status: 'REVERSED', orderId: 'o3' }), pay({ amount: 4000, status: 'PENDING', method: 'MPESA' })]);
    expect(r.drawer.cashIn).toBe(0);
    expect(r.reversed).toHaveLength(1);
    expect(r.ignored).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    expect(r.checks.everyTaggedRowAccounted).toBe(true);
  });

  it('rows without a shift tag are reported as not attributed, not guessed into the drawer', () => {
    const untagged = [
      pay({ gatewayResponse: {}, amount: 12000, rentalOrderId: 'r2', component: 'DEPOSIT' }), // cash, no drawer
      pay({ gatewayResponse: { recordedByAdminId: 'cashier' }, method: 'MPESA', amount: 8000, rentalOrderId: 'r2', component: 'RENTAL_FEE' }),
      pay({ gatewayResponse: { recordedByAdminId: 'someone-else' }, method: 'MPESA', amount: 1, rentalOrderId: 'r3', component: 'RENTAL_FEE' }),
    ];
    const r = run(shift(), { untagged });
    expect(r.drawer.expectedCash).toBe(250000); // unchanged
    expect(r.notAttributed.cashWithoutShift.net).toBe(12000);
    expect(r.notAttributed.cashWithoutShift.rows.map((x) => x.category)).toEqual(['DEPOSIT']);
    expect(r.notAttributed.nonCashByThisCashier.rows).toHaveLength(1);
    expect(r.notAttributed.nonCashByThisCashier.rows[0].amount).toBe(8000);
  });

  it('a row tagged with another shift is ignored', () => {
    const r = run([pay({ amount: 999, gatewayResponse: { posSessionId: 'other' } })]);
    expect(r.drawer.cashIn).toBe(0);
    expect(r.ignored[0].reason).toMatch(/not tagged/);
  });

  it('sums in integer cents (no float drift)', () => {
    const rows = Array.from({ length: 10 }, () => pay({ orderId: 'o', amount: 0.1 }));
    const r = run(rows, { session: { openingCash: 0.2 } });
    expect(r.drawer.cashIn).toBe(1);
    expect(r.drawer.expectedCash).toBe(1.2);
  });

  it('cross-checks touched rentals against the ledger, and reports shop liabilities now', () => {
    const rentalRow = {
      id: rental, rentalNumber: 'RNT-1', status: 'CANCELLED', holdState: 'REFUND_DUE',
      totalRentalPrice: 120000, damageDeposit: 200000, lateFee: 10000, lateFeeWaived: 0, downPaymentAmount: 30000,
      payments: [
        { amount: 100000, status: 'COMPLETED', component: 'RENTAL_FEE' },
        { amount: 20000, status: 'COMPLETED', component: 'RENTAL_FEE' },
        { amount: 200000, status: 'COMPLETED', component: 'DEPOSIT' },
        { amount: 10000, status: 'COMPLETED', component: 'LATE_FEE' },
        { amount: 150000, status: 'REFUNDED', component: 'DEPOSIT' },
      ],
      refundRequests: [],
    };
    const r = run(shift(), {
      rentalsTouched: [rentalRow],
      liabilities: {
        rentals: [rentalRow],
        layaways: [{ id: 'l1', status: 'ACTIVE', payments: [{ amount: 15000, status: 'COMPLETED' }, { amount: 2000, status: 'REFUNDED' }] }],
        refundRequests: [
          { id: 'a', subject: 'RENTAL', status: 'APPROVED', amount: 50000 },
          { id: 'b', subject: 'POS_SALE', status: 'PAYING', amount: 1000 },
          { id: 'c', subject: 'ORDER', status: 'REQUESTED', amount: 700 },
        ],
      },
    });
    expect(r.rentals[0].thisShift).toEqual({ feeReceived: 120000, depositReceived: 200000, lateFeeReceived: 10000, depositReturned: 150000 });
    expect(r.rentals[0].ledgerNow).toMatchObject({ depositHeld: 50000, feeOutstanding: 0, depositOutstanding: 0 });
    expect(r.liabilitiesNow.depositsHeld).toEqual({ amount: 50000, rentals: 1 });
    expect(r.liabilitiesNow.layawayPrepaymentsHeld).toEqual({ amount: 13000, layaways: 1 });
    expect(r.liabilitiesNow.refundRequestsApprovedUnpaid).toMatchObject({ count: 2, amount: 51000, bySubject: { RENTAL: 50000, POS_SALE: 1000 } });
    expect(r.liabilitiesNow.refundRequestsAwaitingApproval).toMatchObject({ count: 1, amount: 700 });
    expect(r.liabilitiesNow.cancelledRentalsRefundDue).toMatchObject({ count: 1, held: 180000 });
  });

  it('category helpers', () => {
    expect(receiptCategory(pay({ orderId: 'o', gatewayResponse: { exchangeNumber: 'EX-1' } }))).toBe('EXCHANGE_TOPUP');
    expect(receiptCategory(pay({ rentalOrderId: 'r' }))).toBe('RENTAL_UNALLOCATED');
    expect(receiptCategory(pay({}))).toBe('OTHER');
    expect(payoutSubject(pay({ status: 'REFUNDED', orderId: 'o', orderChannel: 'ONLINE' }))).toBe('ORDER');
    expect(payoutSubject(pay({ status: 'REFUNDED', orderId: 'o', refundSubject: 'POS_SALE' }))).toBe('POS_SALE');
  });
});

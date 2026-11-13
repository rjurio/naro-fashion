/**
 * Shift reconciliation (R4, round 25D F). Pure functions — no DI, no Prisma.
 *
 * ONE shift (PosSession) is reconciled from the Payment ledger:
 *
 *  - The DRAWER: every Payment row whose `gatewayResponse.posSessionId` names
 *    the shift is money that moved through that drawer (POS sales, exchange
 *    top-ups, layaway instalments, rental fee / deposit / late fee taken at the
 *    till, refunds paid out of the drawer). Expected cash =
 *        opening float + Σ CASH COMPLETED − Σ CASH REFUNDED   (tagged rows)
 *    — the same formula closeSession stores (PosService.computeExpectedCash),
 *    recomputed here so a late row (offline sale replayed into a closed shift)
 *    shows up as a difference against the figure saved at close.
 *    REVERSED rows are voided money: listed, never counted (as at close).
 *  - Each tagged row is put in exactly ONE category (checked: `checks`).
 *  - Deposits and layaway instalments are LIABILITIES (customer money held),
 *    never income. A deposit becomes income only through a PAID refund
 *    request with a retainedAmount (damage) — reported separately; no cash
 *    moves for that part.
 *  - Rows that touch the drawer's cashier/time window but carry NO shift tag
 *    are reported as "not attributed" instead of being guessed into a shift.
 *
 * All money is summed in integer cents.
 */
import { rentalBalances } from '../rentals/rental-ledger';

const c = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const tzs = (cents: number) => cents / 100;

export type ReceiptCategory =
  | 'POS_SALE'
  | 'EXCHANGE_TOPUP'
  | 'RENTAL_FEE'
  | 'DEPOSIT'
  | 'LATE_FEE'
  | 'RENTAL_UNALLOCATED'
  | 'LAYAWAY'
  | 'OTHER';
export type PayoutSubject = 'RENTAL' | 'ORDER' | 'POS_SALE' | 'LAYAWAY' | 'OTHER';

/** What each receipt category is for the books. */
export const RECEIPT_NATURE: Record<ReceiptCategory, 'INCOME' | 'LIABILITY' | 'UNCLASSIFIED'> = {
  POS_SALE: 'INCOME',
  EXCHANGE_TOPUP: 'INCOME',
  RENTAL_FEE: 'INCOME',
  LATE_FEE: 'INCOME',
  DEPOSIT: 'LIABILITY', // refundable security deposit
  LAYAWAY: 'LIABILITY', // prepayment held until the layaway completes
  RENTAL_UNALLOCATED: 'UNCLASSIFIED', // the rental ledger allocates it (fee → deposit → late fee)
  OTHER: 'UNCLASSIFIED',
};

export interface ReconSession {
  id: string;
  adminUserId: string;
  openedAt: Date | string;
  closedAt?: Date | string | null;
  openingCash: unknown;
  closingCash?: unknown;
  expectedCash?: unknown;
  cashDifference?: unknown;
  status: string;
}

export interface ReconPayment {
  id: string;
  amount: unknown;
  method: string;
  status: string;
  component?: string | null;
  orderId?: string | null;
  rentalOrderId?: string | null;
  layawayId?: string | null;
  refundRequestId?: string | null;
  createdAt: Date | string;
  gatewayResponse?: any;
  /** Order.channel of orderId (POS / ONLINE), when known. */
  orderChannel?: string | null;
  /** RefundRequest.subject of refundRequestId, when known. */
  refundSubject?: string | null;
  /** RefundRequest.component (rental payouts), when known. */
  refundComponent?: string | null;
}

interface Bucket {
  cash: number;
  nonCash: number;
  count: number;
  byMethod: Record<string, number>;
  paymentIds: string[];
}
const bucket = (): Bucket => ({ cash: 0, nonCash: 0, count: 0, byMethod: {}, paymentIds: [] });
const add = (b: Bucket, p: ReconPayment) => {
  const a = c(p.amount);
  if (isCash(p.method)) b.cash += a;
  else b.nonCash += a;
  b.count += 1;
  b.byMethod[p.method] = (b.byMethod[p.method] ?? 0) + a;
  b.paymentIds.push(p.id);
};
const out = (b: Bucket) => ({
  cash: tzs(b.cash),
  nonCash: tzs(b.nonCash),
  total: tzs(b.cash + b.nonCash),
  count: b.count,
  byMethod: Object.fromEntries(Object.entries(b.byMethod).map(([k, v]) => [k, tzs(v)])),
  paymentIds: b.paymentIds,
});

export const isCash = (method: string | null | undefined) => String(method ?? '').toUpperCase() === 'CASH';
export const sessionTag = (p: { gatewayResponse?: any }): string | null => {
  const g = p.gatewayResponse;
  return g && typeof g === 'object' && typeof g.posSessionId === 'string' && g.posSessionId ? g.posSessionId : null;
};

/** The single receipt category of a COMPLETED row. */
export function receiptCategory(p: ReconPayment): ReceiptCategory {
  if (p.rentalOrderId) {
    if (p.component === 'RENTAL_FEE' || p.component === 'DEPOSIT' || p.component === 'LATE_FEE') return p.component;
    return 'RENTAL_UNALLOCATED';
  }
  if (p.layawayId) return 'LAYAWAY';
  if (p.orderId) {
    const g = p.gatewayResponse ?? {};
    if (g.exchangeNumber) return 'EXCHANGE_TOPUP';
    return 'POS_SALE';
  }
  return 'OTHER';
}

/** The single payout subject of a REFUNDED row. */
export function payoutSubject(p: ReconPayment): PayoutSubject {
  const s = String(p.refundSubject ?? '').toUpperCase();
  if (s === 'RENTAL' || s === 'ORDER' || s === 'POS_SALE' || s === 'LAYAWAY') return s;
  if (p.rentalOrderId) return 'RENTAL';
  if (p.layawayId) return 'LAYAWAY';
  if (p.orderId) return p.orderChannel === 'POS' ? 'POS_SALE' : 'ORDER';
  return 'OTHER';
}

export interface RetainedDeposit {
  refundRequestId: string;
  rentalOrderId?: string | null;
  retainedAmount: unknown;
  paidAt?: Date | string | null;
}

export interface LiabilityInputs {
  /** Rentals with money (payments + refund requests), for deposits held. */
  rentals: Array<{
    id: string;
    rentalNumber?: string | null;
    status: string;
    holdState?: string | null;
    totalRentalPrice: unknown;
    damageDeposit: unknown;
    lateFee: unknown;
    lateFeeWaived?: unknown;
    downPaymentAmount: unknown;
    payments: Array<{ amount: unknown; status: string; component?: string | null }>;
    refundRequests: Array<{ component: string | null; amount?: unknown; retainedAmount?: unknown; status: string }>;
  }>;
  /** Layaways not COMPLETED (ACTIVE / CANCELLED / EXPIRED) with their payments. */
  layaways: Array<{ id: string; status: string; payments: Array<{ amount: unknown; status: string }> }>;
  /** Refund requests not yet paid out. */
  refundRequests: Array<{ id: string; subject: string; status: string; amount: unknown }>;
}

export interface ReconcileInput {
  session: ReconSession;
  /** Every Payment row tagged gatewayResponse.posSessionId = session.id. */
  tagged: ReconPayment[];
  /**
   * Rows created inside the shift's window that carry NO shift tag: cash rows
   * shop-wide, and non-cash rows recorded/paid by this shift's cashier.
   */
  untaggedInWindow: ReconPayment[];
  /** PAID refund requests with retainedAmount > 0 paid inside the window. */
  retainedDeposits: RetainedDeposit[];
  /** For the rentals the shift touched: the ledger now (rental-ledger.ts). */
  rentalsTouched: LiabilityInputs['rentals'];
  liabilities: LiabilityInputs;
  now?: Date;
}

const actorOf = (p: ReconPayment): string | null => {
  const g = p.gatewayResponse ?? {};
  return g.recordedByAdminId ?? g.paidByAdminId ?? g.payerId ?? g.cashierId ?? g.refundedBy ?? null;
};

export function reconcileShift(input: ReconcileInput) {
  const { session } = input;
  const receipts: Record<ReceiptCategory, Bucket> = {
    POS_SALE: bucket(), EXCHANGE_TOPUP: bucket(), RENTAL_FEE: bucket(), DEPOSIT: bucket(),
    LATE_FEE: bucket(), RENTAL_UNALLOCATED: bucket(), LAYAWAY: bucket(), OTHER: bucket(),
  };
  const payouts: Record<PayoutSubject, Bucket> = {
    RENTAL: bucket(), ORDER: bucket(), POS_SALE: bucket(), LAYAWAY: bucket(), OTHER: bucket(),
  };
  // Rental payouts by what they returned (deposit returned is a liability going out, not an expense).
  const rentalPayoutByComponent: Record<string, Bucket> = {};
  const reversed: Array<{ id: string; amount: number; method: string; kind: string }> = [];
  const ignored: Array<{ id: string; status: string; reason: string }> = [];
  let cashIn = 0;
  let cashOut = 0;
  const methods: Record<string, { in: number; out: number }> = {};
  const accounted = new Set<string>();

  for (const p of input.tagged) {
    if (sessionTag(p) !== session.id) {
      ignored.push({ id: p.id, status: p.status, reason: 'not tagged with this shift' });
      continue;
    }
    const m = (methods[p.method] ??= { in: 0, out: 0 });
    if (p.status === 'COMPLETED') {
      add(receipts[receiptCategory(p)], p);
      m.in += c(p.amount);
      if (isCash(p.method)) cashIn += c(p.amount);
      accounted.add(p.id);
    } else if (p.status === 'REFUNDED') {
      const s = payoutSubject(p);
      add(payouts[s], p);
      if (s === 'RENTAL') add((rentalPayoutByComponent[p.component ?? p.refundComponent ?? 'UNALLOCATED'] ??= bucket()), p);
      m.out += c(p.amount);
      if (isCash(p.method)) cashOut += c(p.amount);
      accounted.add(p.id);
    } else if (p.status === 'REVERSED') {
      reversed.push({ id: p.id, amount: tzs(c(p.amount)), method: p.method, kind: p.gatewayResponse?.kind ?? (p.refundRequestId ? 'PAYOUT' : 'RECEIPT') });
      accounted.add(p.id);
    } else {
      // PENDING / PROCESSING / FAILED / CANCELLED: not money.
      ignored.push({ id: p.id, status: p.status, reason: 'not money (status)' });
      accounted.add(p.id);
    }
  }

  const opening = c(session.openingCash);
  const expected = opening + cashIn - cashOut;
  const counted = session.closingCash == null ? null : c(session.closingCash);
  const storedExpected = session.expectedCash == null ? null : c(session.expectedCash);

  // Income vs liabilities for this shift (cash + non-cash).
  const sumNature = (nature: 'INCOME' | 'LIABILITY' | 'UNCLASSIFIED') =>
    (Object.keys(receipts) as ReceiptCategory[])
      .filter((k) => RECEIPT_NATURE[k] === nature)
      .reduce((s, k) => s + receipts[k].cash + receipts[k].nonCash, 0);
  const comp = (k: string) => {
    const b = rentalPayoutByComponent[k];
    return b ? b.cash + b.nonCash : 0;
  };
  const depositReturned = comp('DEPOSIT');
  const incomeRefunded =
    payouts.POS_SALE.cash + payouts.POS_SALE.nonCash + payouts.ORDER.cash + payouts.ORDER.nonCash + comp('RENTAL_FEE') + comp('LATE_FEE');
  const layawayReturned = payouts.LAYAWAY.cash + payouts.LAYAWAY.nonCash;
  const retained = input.retainedDeposits.reduce((s, r) => s + c(r.retainedAmount), 0);

  // Not attributed to any shift (never guessed into this one).
  const winCash = input.untaggedInWindow.filter((p) => isCash(p.method) && (p.status === 'COMPLETED' || p.status === 'REFUNDED'));
  const winNonCash = input.untaggedInWindow.filter(
    (p) => !isCash(p.method) && (p.status === 'COMPLETED' || p.status === 'REFUNDED') && actorOf(p) === session.adminUserId,
  );
  const listRow = (p: ReconPayment) => ({
    id: p.id,
    status: p.status,
    method: p.method,
    amount: tzs(c(p.amount)),
    createdAt: p.createdAt,
    category: p.status === 'COMPLETED' ? receiptCategory(p) : payoutSubject(p),
    rentalOrderId: p.rentalOrderId ?? null,
    orderId: p.orderId ?? null,
    layawayId: p.layawayId ?? null,
    recordedBy: actorOf(p),
  });
  const unattributedCashNet = winCash.reduce((s, p) => s + (p.status === 'COMPLETED' ? c(p.amount) : -c(p.amount)), 0);

  // Ledger cross-check for the rentals this shift touched.
  const rentals = input.rentalsTouched.map((r) => {
    const b = rentalBalances(r, r.payments, r.refundRequests);
    const mine = input.tagged.filter((p) => p.rentalOrderId === r.id && sessionTag(p) === session.id);
    const sum = (status: string, component: string) =>
      tzs(mine.filter((p) => p.status === status && p.component === component).reduce((s, p) => s + c(p.amount), 0));
    return {
      rentalOrderId: r.id,
      rentalNumber: r.rentalNumber ?? null,
      status: r.status,
      thisShift: {
        feeReceived: sum('COMPLETED', 'RENTAL_FEE'),
        depositReceived: sum('COMPLETED', 'DEPOSIT'),
        lateFeeReceived: sum('COMPLETED', 'LATE_FEE'),
        depositReturned: sum('REFUNDED', 'DEPOSIT'),
      },
      ledgerNow: {
        depositHeld: b.held.DEPOSIT,
        feeOutstanding: b.outstanding.RENTAL_FEE,
        depositOutstanding: b.outstanding.DEPOSIT,
        lateFeeOutstanding: b.outstanding.LATE_FEE,
        totalHeld: b.totalHeld,
      },
    };
  });

  // Shop-wide liabilities as of now.
  let depositsHeld = 0;
  let depositRentals = 0;
  const refundDue = { count: 0, held: 0, rentalOrderIds: [] as string[] };
  for (const r of input.liabilities.rentals) {
    const b = rentalBalances(r, r.payments, r.refundRequests);
    const d = c(b.held.DEPOSIT);
    if (d > 0) { depositsHeld += d; depositRentals += 1; }
    if (r.status === 'CANCELLED' && r.holdState === 'REFUND_DUE') {
      refundDue.count += 1;
      refundDue.held += c(b.totalHeld);
      refundDue.rentalOrderIds.push(r.id);
    }
  }
  let layawayHeld = 0;
  let layawayCount = 0;
  for (const l of input.liabilities.layaways) {
    const held = l.payments.reduce((s, p) => s + (p.status === 'COMPLETED' ? c(p.amount) : p.status === 'REFUNDED' ? -c(p.amount) : 0), 0);
    if (held > 0) { layawayHeld += held; layawayCount += 1; }
  }
  const reqBy = (statuses: string[]) => {
    const rows = input.liabilities.refundRequests.filter((r) => statuses.includes(r.status));
    const bySubject: Record<string, number> = {};
    for (const r of rows) bySubject[r.subject] = (bySubject[r.subject] ?? 0) + c(r.amount);
    return {
      count: rows.length,
      amount: tzs(rows.reduce((s, r) => s + c(r.amount), 0)),
      bySubject: Object.fromEntries(Object.entries(bySubject).map(([k, v]) => [k, tzs(v)])),
      refundRequestIds: rows.map((r) => r.id),
    };
  };

  const checks = {
    /** Every tagged row landed in exactly one place. */
    everyTaggedRowAccounted: input.tagged.every((p) => accounted.has(p.id) || sessionTag(p) !== session.id),
    /** Receipt categories add up to the money in. */
    receiptsAddUp:
      (Object.values(receipts) as Bucket[]).reduce((s, b) => s + b.cash + b.nonCash, 0) ===
      Object.values(methods).reduce((s, m) => s + m.in, 0),
    /** Payout subjects add up to the money out. */
    payoutsAddUp:
      (Object.values(payouts) as Bucket[]).reduce((s, b) => s + b.cash + b.nonCash, 0) ===
      Object.values(methods).reduce((s, m) => s + m.out, 0),
    /** The expected cash recomputed now equals the figure saved at close (null while open). */
    expectedMatchesClose: storedExpected == null ? null : storedExpected === expected,
  };

  return {
    session: {
      id: session.id,
      cashierId: session.adminUserId,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt ?? null,
    },
    drawer: {
      openingCash: tzs(opening),
      cashIn: tzs(cashIn),
      cashOut: tzs(cashOut),
      expectedCash: tzs(expected),
      countedCash: counted == null ? null : tzs(counted),
      difference: counted == null ? null : tzs(counted - expected),
      expectedCashAtClose: storedExpected == null ? null : tzs(storedExpected),
      differenceAtClose: session.cashDifference == null ? null : tzs(c(session.cashDifference)),
      formula: 'opening + CASH COMPLETED − CASH REFUNDED (rows tagged with this shift)',
    },
    receipts: Object.fromEntries((Object.keys(receipts) as ReceiptCategory[]).map((k) => [k, { nature: RECEIPT_NATURE[k], ...out(receipts[k]) }])),
    payouts: Object.fromEntries((Object.keys(payouts) as PayoutSubject[]).map((k) => [k, out(payouts[k])])),
    rentalPayoutsByComponent: Object.fromEntries(Object.entries(rentalPayoutByComponent).map(([k, b]) => [k, out(b)])),
    byMethod: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, { in: tzs(v.in), out: tzs(v.out), net: tzs(v.in - v.out) }])),
    books: {
      incomeReceived: tzs(sumNature('INCOME')),
      incomeRefunded: tzs(incomeRefunded),
      netIncome: tzs(sumNature('INCOME') - incomeRefunded),
      depositsReceived: tzs(receipts.DEPOSIT.cash + receipts.DEPOSIT.nonCash),
      depositsReturned: tzs(depositReturned),
      layawayPrepaymentsReceived: tzs(receipts.LAYAWAY.cash + receipts.LAYAWAY.nonCash),
      layawayPrepaymentsReturned: tzs(layawayReturned),
      unclassified: tzs(sumNature('UNCLASSIFIED')),
      depositsRetainedAsIncome: {
        amount: tzs(retained),
        refundRequestIds: input.retainedDeposits.filter((r) => c(r.retainedAmount) > 0).map((r) => r.refundRequestId),
        note: 'Deposit kept for damage by a PAID refund request: becomes income; no cash moves for this part.',
      },
    },
    reversed,
    ignored,
    notAttributed: {
      cashWithoutShift: {
        net: tzs(unattributedCashNet),
        rows: winCash.map(listRow),
        note: 'Cash recorded during this shift with no drawer tag (any cashier). It is NOT in the expected cash; check whether it went through this drawer.',
      },
      nonCashByThisCashier: {
        rows: winNonCash.map(listRow),
        note: 'Non-cash money this cashier recorded or paid during the shift without a shift tag. It does not affect the drawer.',
      },
    },
    rentals,
    liabilitiesNow: {
      asOf: (input.now ?? new Date()).toISOString(),
      depositsHeld: { amount: tzs(depositsHeld), rentals: depositRentals },
      layawayPrepaymentsHeld: { amount: tzs(layawayHeld), layaways: layawayCount },
      refundRequestsAwaitingApproval: reqBy(['REQUESTED']),
      refundRequestsApprovedUnpaid: reqBy(['APPROVED', 'PAYING']),
      cancelledRentalsRefundDue: { count: refundDue.count, held: tzs(refundDue.held), rentalOrderIds: refundDue.rentalOrderIds },
    },
    checks,
  };
}

export type ShiftReconciliation = ReturnType<typeof reconcileShift>;

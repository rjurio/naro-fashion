/**
 * Rental money ledger (POS rental MVP, phase M1). Pure functions — no DI, no
 * Prisma. The ONE place that says what a rental owes and what has been
 * received, refunded and is still held, PER COMPONENT:
 *
 *   RENTAL_FEE  the flat rental price (incl. the down payment, which is the
 *               first part of the fee — not a separate charge)
 *   DEPOSIT     the refundable security deposit: a LIABILITY, never revenue,
 *               returned after inspection unless part is retained (damage)
 *               by an approved refund request
 *   LATE_FEE    assessed on return (rental.lateFee)
 *
 * Payment rows:
 *   COMPLETED   money received. `component` says what it pays for; NULL
 *               (online / legacy rows) is "unallocated" and is applied fee
 *               first, then deposit, then late fee, then overpayment.
 *   REFUNDED    a payout row (positive amount) — reduces what is held for its
 *               component (NULL: the most recently funded component first).
 *   PENDING / PROCESSING / FAILED / CANCELLED / REVERSED: not money.
 *
 * Money is computed in integer cents to avoid float drift.
 */
export const RENTAL_COMPONENTS = ['RENTAL_FEE', 'DEPOSIT', 'LATE_FEE'] as const;
export type RentalComponent = (typeof RENTAL_COMPONENTS)[number];

export type ComponentAmounts = Record<RentalComponent, number>;

export interface LedgerRental {
  totalRentalPrice: unknown;
  damageDeposit: unknown;
  lateFee: unknown;
  downPaymentAmount: unknown;
}

export interface LedgerPayment {
  amount: unknown;
  status: string;
  component?: string | null;
}

export interface RentalBalances {
  due: ComponentAmounts;
  collected: ComponentAmounts;
  refunded: ComponentAmounts;
  /** Kept by PAID refund requests (deposit damage): income, no longer held. */
  retained: ComponentAmounts;
  /** collected − refunded − retained: money the shop holds for each component. */
  held: ComponentAmounts;
  /** due − collected, never negative. */
  outstanding: ComponentAmounts;
  /** Money received beyond everything due (unallocated surplus). */
  overpaid: number;
  totalHeld: number;
  downPaymentCovered: boolean;
  feeFullyPaid: boolean;
  depositFullyPaid: boolean;
  lateFeePaid: boolean;
}

const c = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const z = (): ComponentAmounts => ({ RENTAL_FEE: 0, DEPOSIT: 0, LATE_FEE: 0 });
const toTzs = (o: ComponentAmounts): ComponentAmounts => ({
  RENTAL_FEE: o.RENTAL_FEE / 100,
  DEPOSIT: o.DEPOSIT / 100,
  LATE_FEE: o.LATE_FEE / 100,
});

export function isRentalComponent(v: unknown): v is RentalComponent {
  return typeof v === 'string' && (RENTAL_COMPONENTS as readonly string[]).includes(v);
}

export interface LedgerRefundRequest {
  component: string;
  amount?: unknown;
  retainedAmount?: unknown;
  status: string;
}

export function rentalBalances(
  rental: LedgerRental,
  payments: LedgerPayment[],
  requests: LedgerRefundRequest[] = [],
): RentalBalances {
  const due: ComponentAmounts = {
    RENTAL_FEE: Math.max(0, c(rental.totalRentalPrice)),
    DEPOSIT: Math.max(0, c(rental.damageDeposit)),
    LATE_FEE: Math.max(0, c(rental.lateFee)),
  };
  const collected = z();
  let unallocated = 0;
  for (const p of payments) {
    if (p.status !== 'COMPLETED') continue;
    if (isRentalComponent(p.component)) collected[p.component] += c(p.amount);
    else unallocated += c(p.amount);
  }
  // Unallocated money: fee first, then deposit, then late fee.
  let overpaid = 0;
  for (const k of RENTAL_COMPONENTS) {
    const room = Math.max(0, due[k] - collected[k]);
    const take = Math.min(room, unallocated);
    collected[k] += take;
    unallocated -= take;
  }
  overpaid = unallocated;

  const refunded = z();
  let unallocatedRefund = 0;
  for (const p of payments) {
    if (p.status !== 'REFUNDED') continue;
    if (isRentalComponent(p.component)) refunded[p.component] += c(p.amount);
    else unallocatedRefund += c(p.amount);
  }
  // Legacy refunds without a component: overpayment first, then late fee,
  // deposit, fee (the reverse of the collection order).
  const fromOver = Math.min(overpaid, unallocatedRefund);
  overpaid -= fromOver;
  unallocatedRefund -= fromOver;
  for (const k of ['LATE_FEE', 'DEPOSIT', 'RENTAL_FEE'] as RentalComponent[]) {
    const room = Math.max(0, collected[k] - refunded[k]);
    const take = Math.min(room, unallocatedRefund);
    refunded[k] += take;
    unallocatedRefund -= take;
  }

  const retained = z();
  for (const r of requests) {
    if (r.status === 'PAID' && isRentalComponent(r.component)) retained[r.component] += c(r.retainedAmount);
  }

  const held = z();
  const outstanding = z();
  for (const k of RENTAL_COMPONENTS) {
    held[k] = Math.max(0, collected[k] - refunded[k] - retained[k]);
    outstanding[k] = Math.max(0, due[k] - collected[k]);
  }
  const totalHeld = held.RENTAL_FEE + held.DEPOSIT + held.LATE_FEE + overpaid;
  return {
    due: toTzs(due),
    collected: toTzs(collected),
    refunded: toTzs(refunded),
    retained: toTzs(retained),
    held: toTzs(held),
    outstanding: toTzs(outstanding),
    overpaid: overpaid / 100,
    totalHeld: totalHeld / 100,
    downPaymentCovered: collected.RENTAL_FEE >= c(rental.downPaymentAmount),
    feeFullyPaid: collected.RENTAL_FEE >= due.RENTAL_FEE,
    depositFullyPaid: collected.DEPOSIT >= due.DEPOSIT,
    lateFeePaid: collected.LATE_FEE >= due.LATE_FEE,
  };
}

/** How much more can be collected for a component (never over-collect). */
export function collectable(b: RentalBalances, component: RentalComponent): number {
  return b.outstanding[component];
}

/**
 * The money a refund request may pay back + retain for a component:
 * what is held minus what open (REQUESTED / APPROVED) requests already claim.
 */
export function refundableNow(
  b: RentalBalances,
  component: RentalComponent,
  openRequests: Array<{ component: string; amount: unknown; retainedAmount?: unknown; status: string }>,
): number {
  const claimed = openRequests
    .filter((r) => r.component === component && (r.status === 'REQUESTED' || r.status === 'APPROVED'))
    .reduce((s, r) => s + c(r.amount) + c(r.retainedAmount), 0);
  return Math.max(0, c(b.held[component]) - claimed) / 100;
}

import { refundableNow, rentalBalances, RENTAL_COMPONENTS, overpaymentRefundableNow } from './rental-ledger';

/**
 * Rental cancellation policy proposal (round 25C F, CANCELLATION_POLICY.md):
 * before the item is collected, a cancellation ALWAYS refunds everything
 * actually received — nothing is forfeited automatically.
 *
 * The cancellation (booking status) and the refund (money) are separate:
 * cancelling records WHY (structured reason + note, who, when); the money
 * held becomes ordinary refund REQUESTS (kind CANCELLATION, one per
 * component), which still need an independent approval and a payout by
 * someone other than the requester. Nothing here moves money.
 *
 * Plain functions on a Prisma client / transaction so request-scoped services,
 * the hold-expiry cron and payment settlement share one implementation.
 */
export const CANCELLATION_REASONS = [
  'CUSTOMER_REQUEST', // customer cancels before collection
  'SHOP', // shop-caused (item damaged, double-booked by the shop, shop closed…)
  'PAYMENT_EXPIRED', // down payment not received in time (hold job) / payment review window ended
  'ID_FAILED', // National ID not approved in time (hold job)
  'DUPLICATE', // duplicate booking
  'NO_SHOW', // confirmed but not collected
  'OTHER',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
/** Recorded when an older client (e.g. an offline replay) cancels without a reason. */
export const UNSPECIFIED_REASON = 'UNSPECIFIED';

/** System requesters for refund requests created without a person (never a real admin id). */
export const SYSTEM_REQUESTER = {
  HOLD_EXPIRY: 'SYSTEM:HOLD_EXPIRY',
  LATE_PAYMENT: 'SYSTEM:LATE_PAYMENT',
} as const;

/** The hold job's reason, from the hold state at expiry (rentals/rental-hold.ts). */
export function holdExpiryCancellationReason(holdState: string | null | undefined): CancellationReason {
  return holdState === 'AWAITING_ID' || holdState === 'ID_REJECTED' || holdState === 'ID_UNDER_REVIEW' ? 'ID_FAILED' : 'PAYMENT_EXPIRED';
}

const OPEN = ['REQUESTED', 'APPROVED', 'PAYING'];

/**
 * Raise CANCELLATION refund requests for every component of money actually
 * received and still held on a CANCELLED booking, minus what open requests
 * already claim. Idempotent (a second call finds nothing left to request) and
 * race-safe (same advisory lock as RentalMoneyService). Pending / failed
 * payments are not "received": a payment completing later calls this again
 * (late arrival) and only the new money is requested. Returns the created rows.
 */
export async function requestCancellationRefunds(
  tx: any,
  tenantId: string,
  rentalOrderId: string,
  requestedById: string,
  reason: string,
): Promise<Array<{ id: string; component: string; amount: number }>> {
  const lockKey = `refund:rental:${rentalOrderId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const rental = await tx.rentalOrder.findFirst({ where: { id: rentalOrderId, tenantId } });
  if (!rental || rental.status !== 'CANCELLED') return [];
  const [payments, requests] = await Promise.all([
    tx.payment.findMany({ where: { rentalOrderId, tenantId }, select: { amount: true, status: true, component: true } }),
    tx.refundRequest.findMany({ where: { rentalOrderId, tenantId }, select: { kind: true, component: true, amount: true, retainedAmount: true, status: true } }),
  ]);
  const balances = rentalBalances(rental, payments, requests);
  // PAYING counts as open too (a payout in progress already claims its amount).
  const open = requests.filter((r: any) => OPEN.includes(r.status)).map((r: any) => ({ ...r, status: r.status === 'PAYING' ? 'APPROVED' : r.status }));
  const created: Array<{ id: string; component: string; amount: number }> = [];
  for (const component of RENTAL_COMPONENTS) {
    const room = refundableNow(balances, component, open);
    if (room <= 0) continue;
    const row = await tx.refundRequest.create({
      data: {
        tenantId,
        rentalOrderId,
        kind: 'CANCELLATION',
        component,
        amount: room,
        retainedAmount: 0,
        reason: `Booking ${rental.rentalNumber} cancelled (${reason}): full refund of the money received, as the policy requires before collection.`,
        requestedById,
      },
    });
    created.push({ id: row.id, component, amount: room });
  }
  // Money paid beyond everything due (no component) is the customer's too:
  // requested once, without a component, so its payout is taken off the
  // surplus (round 25D E).
  const surplus = overpaymentRefundableNow(balances, open);
  if (surplus > 0) {
    const row = await tx.refundRequest.create({
      data: {
        tenantId,
        rentalOrderId,
        kind: 'CANCELLATION',
        component: null,
        amount: surplus,
        retainedAmount: 0,
        reason: `Booking ${rental.rentalNumber} cancelled (${reason}): money paid beyond the fee and deposit, returned in full.`,
        requestedById,
      },
    });
    created.push({ id: row.id, component: 'OVERPAID', amount: surplus });
  }
  return created;
}

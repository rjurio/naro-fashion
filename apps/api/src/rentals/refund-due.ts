/**
 * Round 25D E (R1): the REFUND_DUE liability flag on a CANCELLED booking is
 * decided under the booking's money locks, from a status and a balance read
 * INSIDE those locks.
 *
 * Before: the staff cancellation computed the money held BEFORE its status
 * write (no transaction, no lock), and payment settlement read the status
 * BEFORE deciding. A gateway payment confirmed in between left a CANCELLED
 * booking holding money with no REFUND_DUE flag (no recorded liability).
 *
 * Lock order is always payment:rental -> refund:rental (the hold-expiry job
 * takes product -> payment:rental; RentalMoneyService takes refund:rental),
 * so no cycle is possible.
 */
export async function lockRentalMoney(tx: any, rentalOrderId: string): Promise<void> {
  const paymentKey = `payment:rental:${rentalOrderId}`;
  const refundKey = `refund:rental:${rentalOrderId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentKey}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${refundKey}))`;
}

/** COMPLETED minus REFUNDED payments of the booking (money still held), read with tx. */
export async function netHeld(tx: any, tenantId: string, rentalOrderId: string): Promise<number> {
  const [c, r] = await Promise.all([
    tx.payment.aggregate({ _sum: { amount: true }, where: { rentalOrderId, tenantId, status: 'COMPLETED' } }),
    tx.payment.aggregate({ _sum: { amount: true }, where: { rentalOrderId, tenantId, status: 'REFUNDED' } }),
  ]);
  return Math.max(0, Math.round((Number(c._sum.amount ?? 0) - Number(r._sum.amount ?? 0)) * 100) / 100);
}

/**
 * Under the locks: when the booking is (now) CANCELLED and money is held,
 * flag it REFUND_DUE. Returns whether it is cancelled and what is held.
 */
export async function flagRefundDueIfHeld(tx: any, tenantId: string, rentalOrderId: string): Promise<{ cancelled: boolean; held: number; flagged: boolean }> {
  await lockRentalMoney(tx, rentalOrderId);
  const current = await tx.rentalOrder.findFirst({ where: { id: rentalOrderId, tenantId }, select: { status: true, holdState: true } });
  if (current?.status !== 'CANCELLED') return { cancelled: false, held: 0, flagged: false };
  const held = await netHeld(tx, tenantId, rentalOrderId);
  if (held <= 0) return { cancelled: true, held, flagged: false };
  const res = await tx.rentalOrder.updateMany({
    where: { id: rentalOrderId, tenantId, status: 'CANCELLED', OR: [{ holdState: null }, { holdState: { not: 'REFUND_DUE' } }] },
    data: { holdState: 'REFUND_DUE', holdExpiresAt: null },
  });
  return { cancelled: true, held, flagged: res.count > 0 };
}

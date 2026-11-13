import { BadRequestException, ConflictException } from '@nestjs/common';
import { normalizeReference } from '../pos/payment-verification';

/**
 * Controls shared by BOTH payout routes (unified /refund-requests/:id/pay and
 * /rental-money/refund-requests/:id/pay), whoever pays (refunds:payout or
 * payments:manage, SUPER_ADMIN included).
 *
 * Payment references:
 *  - one format everywhere: normalizeReference (spaces removed, upper-case,
 *    4–64 of A–Z 0–9 . _ - /); a reference that is given but malformed → 400
 *    PAYOUT_REFERENCE_INVALID (never silently dropped);
 *  - mobile-money and bank payouts of money need it → 400 (rental route:
 *    PAYOUT_REFERENCE_REQUIRED; unified route: listed in PAYOUT_INVALID with
 *    the other payout problems, its existing contract); cash may carry an
 *    optional receipt number;
 *  - a reference already used in the same shop — by any Payment row
 *    (collections included: the customer's own M-Pesa code is not a payout
 *    proof) or as another refund's payoutReference — → 409
 *    DUPLICATE_PAYOUT_REFERENCE, nothing written. The unique keys
 *    Payment(tenantId, transactionRef) and RefundRequest(tenantId,
 *    payoutReference) are the race-proof backstop (P2002 → the same 409).
 *
 * Shift attribution (R4 shift reconciliation reads `gatewayResponse.posSessionId`
 * and the payer id): cash leaves the PAYER's own OPEN shift (required);
 * a non-cash payout is tagged with the payer's open shift when they have one
 * (attributed to their shift, never to the drawer cash: expected cash counts
 * CASH rows only) and otherwise stays untagged with the payer recorded.
 */
export const DUPLICATE_PAYOUT_REFERENCE = 'DUPLICATE_PAYOUT_REFERENCE';

export function payoutReference(method: string, raw: string | null | undefined, amount: number): string | null {
  const given = typeof raw === 'string' && raw.trim() !== '';
  const ref = given ? normalizeReference(raw) : null;
  if (given && !ref) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'PAYOUT_REFERENCE_INVALID',
      message: 'The payout reference must be 4–64 letters or digits (also . _ - /). Nothing was paid.',
    });
  }
  if (method !== 'CASH' && amount > 0 && !ref) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'PAYOUT_REFERENCE_REQUIRED',
      message: 'Mobile-money and bank payouts need the payout reference (4–64 letters/digits). Nothing was paid.',
    });
  }
  return ref;
}

export function duplicateReference(reference: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: DUPLICATE_PAYOUT_REFERENCE,
    message: `The payout reference ${reference} is already used in this shop. Nothing was paid.`,
  });
}

/** 409 when the reference is already used by a payment or another refund of this shop. */
export async function assertReferenceUnused(db: any, tenantId: string, reference: string | null, requestId: string): Promise<void> {
  if (!reference) return;
  const [payment, request] = await Promise.all([
    db.payment.findFirst({ where: { tenantId, transactionRef: reference }, select: { id: true } }),
    db.refundRequest.findFirst({ where: { tenantId, payoutReference: reference, id: { not: requestId } }, select: { id: true } }),
  ]);
  if (payment || request) throw duplicateReference(reference);
}

/** The payer's own OPEN POS shift in this shop, if any. */
export async function payerOpenShift(db: any, tenantId: string, payerId: string): Promise<string | null> {
  const s = await db.posSession.findFirst({ where: { adminUserId: payerId, status: 'OPEN', tenantId }, select: { id: true } });
  return s?.id ?? null;
}

/** 409 when a payout (sale return) would pay out more than the approved amount. */
export function assertWithinApproved(paid: number, approved: number): void {
  if (Math.round(paid * 100) > Math.round(approved * 100)) {
    throw new ConflictException({
      statusCode: 409,
      code: 'PAYOUT_EXCEEDS_APPROVED',
      message: `The payout (${paid} TZS) would be more than the approved ${approved} TZS. Nothing was paid; ask for a new request.`,
    });
  }
}

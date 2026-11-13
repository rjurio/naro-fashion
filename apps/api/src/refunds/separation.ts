import { ConflictException, ForbiddenException } from '@nestjs/common';

/**
 * Round 25E D — separation of duties for money leaving the shop.
 *
 * Already enforced elsewhere: approver ≠ requester (SELF_APPROVAL) and
 * payer ≠ requester (PAYOUT_BY_REQUESTER).
 *
 * G2: the person who APPROVED a refund never pays it out (PAYOUT_BY_APPROVER).
 *     A staff-requested refund therefore needs three people (request,
 *     approve, pay); a system-requested one (SYSTEM:*, e.g. a cancellation
 *     raised by the hold job or a late payment) needs two.
 * G3: when deposit money is KEPT (a DEPOSIT_RETURN with retainedAmount > 0,
 *     backed by a discrepancy resolved as RESOLVED_DEDUCTED), the person who
 *     decided that deduction neither approves nor pays the refund that keeps
 *     it (DEDUCTION_DECIDER).
 * Both apply to SUPER_ADMIN too (no role bypasses a separation rule).
 */
export interface SeparationRequest {
  id: string;
  kind?: string | null;
  rentalOrderId?: string | null;
  requestedById?: string | null;
  approvedById?: string | null;
  retainedAmount?: unknown;
}

type Audit = { log: (action: string, entity: string, id: string, details?: any) => Promise<unknown> | unknown };

export async function assertPayerIndependent(r: SeparationRequest, actorId: string, audit: Audit): Promise<void> {
  if (r.approvedById && r.approvedById === actorId) {
    await audit.log('REFUND_PAYOUT_DENIED', 'RefundRequest', r.id, { reason: 'PAYOUT_BY_APPROVER' });
    throw new ForbiddenException({
      statusCode: 403,
      code: 'PAYOUT_BY_APPROVER',
      message: 'The person who approved a refund cannot also pay it out. Ask another member of staff who pays out refunds (refunds:payout).',
    });
  }
}

/**
 * A payout is recorded only against an INDEPENDENTLY approved request: status
 * APPROVED with an approver on record who is not the requester. The approval
 * step already refuses self-approval (SELF_APPROVAL, and the database trigger
 * naro_r3_refund_separation); this re-check at payout time (and the same rule
 * in the trigger for -> PAYING / -> PAID and on the payout Payment row) means
 * a row that reached APPROVED any other way still can't be paid. 409, nothing
 * written. Pure: the callers run it before any write (rental: inside the lock).
 */
export function assertIndependentlyApproved(r: { status?: string | null; requestedById?: string | null; approvedById?: string | null }): void {
  if (r.status !== 'APPROVED') {
    throw new ConflictException({ statusCode: 409, code: 'NOT_APPROVED', message: 'Only an APPROVED request can be paid. Reload.' });
  }
  if (!r.approvedById || r.approvedById === r.requestedById) {
    throw new ConflictException({
      statusCode: 409,
      code: 'NOT_INDEPENDENTLY_APPROVED',
      message: 'This refund has no independent approval on record (approved by someone other than the requester). Nothing was paid.',
    });
  }
}

/** Resolvers of the RESOLVED_DEDUCTED discrepancies that justify keeping deposit money. */
export async function deductionDeciders(db: any, tenantId: string, rentalOrderId: string): Promise<string[]> {
  if (!db?.rentalDiscrepancy?.findMany) return [];
  const rows = await db.rentalDiscrepancy.findMany({
    where: { tenantId, rentalOrderId, status: 'RESOLVED_DEDUCTED' },
    select: { resolvedById: true },
  });
  return rows.map((r: any) => r.resolvedById).filter(Boolean);
}

export async function assertNotDeductionDecider(
  db: any,
  tenantId: string,
  r: SeparationRequest,
  actorId: string,
  step: 'approve' | 'pay',
  audit: Audit,
): Promise<void> {
  if (r.kind !== 'DEPOSIT_RETURN' || !r.rentalOrderId || !(Number(r.retainedAmount ?? 0) > 0)) return;
  const deciders = await deductionDeciders(db, tenantId, r.rentalOrderId);
  if (!deciders.includes(actorId)) return;
  await audit.log(step === 'approve' ? 'REFUND_APPROVAL_DENIED' : 'REFUND_PAYOUT_DENIED', 'RefundRequest', r.id, { reason: 'DEDUCTION_DECIDER' });
  throw new ForbiddenException({
    statusCode: 403,
    code: 'DEDUCTION_DECIDER',
    message: `The person who decided to deduct from this deposit cannot also ${step === 'approve' ? 'approve' : 'pay'} the refund that keeps the money.`,
  });
}

/**
 * Who may record the payout of an approved refund (pay), the failure of a
 * recorded payout (fail), and list/read refund requests to do so.
 *
 *  - `refunds:payout`: the narrow, payout-only permission (for a cashier who
 *    must not hold payments:manage). It is used on NO other route.
 *  - `payments:manage`: keeps the payout rights it always had, so existing
 *    finance roles keep working (it already allows broader payment edits).
 *
 * OR semantics (@RequiresPermission). The separation rules in
 * refunds/separation.ts and the database trigger naro_r3_refund_separation
 * are about WHO acts, not which permission they hold, so they apply
 * identically to both: the payer is never the requester, never the
 * approver, never the decider of a deposit deduction the refund keeps, and
 * cash leaves the payer's own open POS shift. No role bypasses them.
 */
export const REFUND_PAYOUT_PERMISSIONS = ['payments:manage', 'refunds:payout'] as const;

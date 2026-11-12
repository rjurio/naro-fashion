/**
 * Unified refund workflow (R1b) — shared, I/O-free rules.
 *
 * Money going back to a customer is ALWAYS a RefundRequest:
 *   REQUESTED → APPROVED (by someone other than the requester)
 *             → PAYING (claimed by the payer) → PAID (payout row recorded by
 *               someone other than the requester) | back to APPROVED on error
 *             → FAILED (payout didn't reach the customer; liability back)
 *   REQUESTED → REJECTED (reason)
 * There is no instant cashier refund (owner: threshold TZS 0). Goods-only
 * exchanges and exchanges where the customer pays more need no request.
 */
export const REFUND_SUBJECTS = ['RENTAL', 'ORDER', 'POS_SALE', 'LAYAWAY'] as const;
export type RefundSubject = (typeof REFUND_SUBJECTS)[number];

/** Requests still claiming money (count against what may be refunded). */
export const OPEN_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PAYING'];

export const REFUND_KINDS = {
  ORDER_REFUND: 'ORDER_REFUND', // online order, money only
  POS_RETURN: 'POS_RETURN', // POS sale: items come back + money (executed at payout)
  EXCHANGE_DIFFERENCE: 'EXCHANGE_DIFFERENCE', // POS exchange where the customer is owed
  LAYAWAY_CANCELLATION: 'LAYAWAY_CANCELLATION', // instalments paid on a cancelled layaway
  RETRY: 'RETRY', // re-pay a FAILED request (money only)
} as const;

export const PAYOUT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** Who may ask for a refund of each subject (PermissionGuard uses OR semantics). */
export const REQUEST_PERMISSION_BY_SUBJECT: Record<RefundSubject, string> = {
  RENTAL: 'rentals:refund-request',
  ORDER: 'orders:refund',
  POS_SALE: 'pos:refund',
  LAYAWAY: 'pos:layaway-cancel',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Σ amount of the requests still open (optionally excluding one). */
export function openClaimedAmount(requests: Array<{ id?: string; status: string; amount: unknown }>, excludeId?: string): number {
  return r2(
    requests
      .filter((r) => OPEN_REFUND_STATUSES.includes(r.status) && r.id !== excludeId)
      .reduce((s, r) => s + Number(r.amount ?? 0), 0),
  );
}

/** Units of each POS order line already claimed by open POS_RETURN requests. */
export function openClaimedQuantities(requests: Array<{ status: string; kind?: string | null; lines?: unknown }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of requests) {
    if (!OPEN_REFUND_STATUSES.includes(r.status) || r.kind !== REFUND_KINDS.POS_RETURN) continue;
    for (const it of ((r.lines as any)?.items ?? []) as Array<{ orderItemId: string; quantity: number }>) {
      m.set(it.orderItemId, (m.get(it.orderItemId) ?? 0) + Number(it.quantity));
    }
  }
  return m;
}

/** A non-cash payout needs its reference; a different method than the customer paid with needs a verification note. */
export function payoutProblems(p: {
  method: string;
  reference?: string | null;
  originalMethods: string[];
  verificationNote?: string | null;
}): string[] {
  const out: string[] = [];
  if (!(PAYOUT_METHODS as readonly string[]).includes(p.method)) out.push(`method must be one of ${PAYOUT_METHODS.join(', ')}`);
  if (p.method !== 'CASH' && !p.reference?.trim()) out.push('a non-cash payout needs the payout reference');
  const sameAsPaid = p.originalMethods.length === 0 || p.originalMethods.some((m) => paidByFamily(m) === paidByFamily(p.method));
  if (!sameAsPaid && !(p.verificationNote && p.verificationNote.trim().length >= 10)) {
    out.push('paying back by a different method than the customer used needs a note of how the account was verified as theirs (≥ 10 characters)');
  }
  return out;
}

/** Payment methods grouped as the customer experiences them. */
export function paidByFamily(method: string): 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CARD' | 'OTHER' {
  const m = String(method ?? '').toUpperCase();
  if (m === 'CASH') return 'CASH';
  if (m === 'CARD' || m === 'MANUAL_TERMINAL') return 'CARD';
  if (m === 'BANK_TRANSFER') return 'BANK_TRANSFER';
  if (['MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'MIX_BY_YAS', 'SELCOM_PESA', 'HALOPESA', 'MOBILE_MONEY', 'MANUAL_MOBILE_MONEY'].includes(m)) return 'MOBILE_MONEY';
  return 'OTHER';
}

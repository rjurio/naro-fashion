import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

/**
 * P0c (Nov 2026): verified non-cash payments at the POS.
 *
 * Before: every POS tender (sales, layaway deposit/instalment, exchange
 * top-up) was written COMPLETED immediately whatever the method — choosing
 * "Card" or "M-Pesa" with no reference marked the sale PAID (references were
 * only required offline).
 *
 * Now a non-cash tender is CONFIRMED only with evidence:
 *  - Provider verification (gateway webhook / poll) — NOT available for POS
 *    tenders today: the POS has no gateway initiation flow, and wiring one
 *    in would enable untested integrations. Design only (see docs).
 *  - Authorised MANUAL confirmation — the operator holds
 *    `payments:confirm-manual` and enters the evidence from the card
 *    terminal slip / mobile-money SMS. Recorded as manual
 *    (`providerVerified: false`) and audited — never presented as provider
 *    verification.
 *
 * Explicit payment states (Payment.status, a string column — no migration):
 *   PENDING   awaiting confirmation (gateway flows; not used by manual POS)
 *   COMPLETED confirmed (cash counted, or manual evidence, or provider)
 *   FAILED    not collected
 *   REVERSED  a confirmed manual payment found invalid at reconciliation
 *   REFUNDED  money paid back to the customer (existing meaning)
 */
export const PAYMENT_STATES = {
  PENDING: 'PENDING',
  CONFIRMED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  REFUNDED: 'REFUNDED',
} as const;

/** Allowed status changes (forward only; COMPLETED is never downgraded to PENDING/FAILED). */
export const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['REVERSED', 'REFUNDED'],
  FAILED: [],
  REVERSED: [],
  REFUNDED: [],
};

export function canTransitionPayment(from: string, to: string): boolean {
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

export const PAYMENT_NOT_VERIFIED = 'PAYMENT_NOT_VERIFIED';
export const MANUAL_CONFIRMATION_NOT_PERMITTED = 'MANUAL_CONFIRMATION_NOT_PERMITTED';
export const DUPLICATE_PAYMENT_REFERENCE = 'DUPLICATE_PAYMENT_REFERENCE';
export const CONFIRM_MANUAL_PERMISSION = 'payments:confirm-manual';
export const REVERSE_PAYMENT_PERMISSION = 'payments:reverse';

export const CASH_METHODS = new Set(['CASH']);
export const CARD_METHODS = new Set(['CARD']);
export const MOBILE_MONEY_METHODS = new Set([
  'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'MIX_BY_YAS', 'SELCOM_PESA', 'HALOPESA', 'MOBILE_MONEY',
]);

export type ManualMethod = 'MANUAL_TERMINAL' | 'MANUAL_MOBILE_MONEY';

export interface PaymentVerification {
  method: ManualMethod;
  /** Never true for manual evidence — no provider confirmed this payment. */
  providerVerified: false;
  evidence: 'manual';
  reference: string;
  approvalCode?: string;
  confirmedByAdminId: string;
  confirmedAt: string;
}

export interface TenderInput {
  method: string;
  amount: number;
  transactionRef?: string | null;
  approvalCode?: string | null;
}

export interface VerifiedTender {
  method: string;
  /** Normalised reference to store in Payment.transactionRef (null for cash). */
  transactionRef: string | null;
  verification: PaymentVerification | null;
}

/** Upper-case, strip spaces; keep A–Z 0–9 . _ - / ; 4–64 chars. */
export function normalizeReference(ref?: string | null): string | null {
  if (typeof ref !== 'string') return null;
  const v = ref.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9._\-/]{4,64}$/.test(v)) return null;
  return v;
}

export function normalizeApprovalCode(code?: string | null): string | null {
  if (typeof code !== 'string') return null;
  const v = code.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(v) ? v : null;
}

const notVerified = (message: string) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', code: PAYMENT_NOT_VERIFIED, message });

/**
 * Validate the evidence for every tender of one POS operation and build the
 * verification record. Throws:
 *  - 400 PAYMENT_NOT_VERIFIED — missing/invalid evidence, unknown method
 *  - 403 MANUAL_CONFIRMATION_NOT_PERMITTED — non-cash without the permission
 *  - 409 DUPLICATE_PAYMENT_REFERENCE — the same reference twice in one request
 */
export function verifyTenders(
  tenders: TenderInput[],
  ctx: { canConfirmManually: boolean; actorAdminId: string; now?: Date },
): VerifiedTender[] {
  const at = (ctx.now ?? new Date()).toISOString();
  const seen = new Set<string>();
  const out: VerifiedTender[] = [];
  for (const t of tenders) {
    const method = String(t.method ?? '').toUpperCase();
    if (CASH_METHODS.has(method)) {
      out.push({ method: t.method, transactionRef: normalizeReference(t.transactionRef), verification: null });
      continue;
    }
    const isCard = CARD_METHODS.has(method);
    const isMobile = MOBILE_MONEY_METHODS.has(method);
    if (!isCard && !isMobile) {
      throw notVerified(`${t.method} is not a supported POS payment method. Use cash, card or mobile money.`);
    }
    const reference = normalizeReference(t.transactionRef);
    if (!reference) {
      throw notVerified(
        isCard
          ? 'Card payments need the terminal receipt reference (RRN / receipt no.). Choosing Card does not mark it paid.'
          : `${t.method} payments need the customer's transaction reference from the confirmation SMS. Choosing ${t.method} does not mark it paid.`,
      );
    }
    let approvalCode: string | undefined;
    if (isCard) {
      const code = normalizeApprovalCode(t.approvalCode);
      if (!code) throw notVerified('Card payments need the approval code printed on the terminal slip.');
      approvalCode = code;
    }
    if (!ctx.canConfirmManually) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: MANUAL_CONFIRMATION_NOT_PERMITTED,
        message: `Recording a ${isCard ? 'card' : 'mobile-money'} payment needs the "${CONFIRM_MANUAL_PERMISSION}" permission. Ask a manager, or take cash.`,
      });
    }
    if (seen.has(reference)) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', code: DUPLICATE_PAYMENT_REFERENCE,
        message: `Reference ${reference} appears twice in this payment.`,
      });
    }
    seen.add(reference);
    out.push({
      method: t.method,
      transactionRef: reference,
      verification: {
        method: isCard ? 'MANUAL_TERMINAL' : 'MANUAL_MOBILE_MONEY',
        providerVerified: false,
        evidence: 'manual',
        reference,
        ...(approvalCode ? { approvalCode } : {}),
        confirmedByAdminId: ctx.actorAdminId,
        confirmedAt: at,
      },
    });
  }
  return out;
}

export function duplicateReferenceError(refs: string[]) {
  return new ConflictException({
    statusCode: 409, error: 'Conflict', code: DUPLICATE_PAYMENT_REFERENCE,
    message: `Payment reference ${refs.join(', ')} has already been recorded. A reference can only be used once.`,
  });
}

export function isNonCash(method: string): boolean {
  return !CASH_METHODS.has(String(method ?? '').toUpperCase());
}

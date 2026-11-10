/**
 * P0c: what a payment's status MEANS, kept distinct everywhere it is shown.
 *
 * `status` alone can't tell "the provider confirmed it" from "a person said
 * it was paid": both are COMPLETED. This classification reads the evidence
 * stored on the row and never upgrades it:
 *
 *   PENDING             PENDING / PROCESSING: no money confirmed yet
 *   MANUALLY_CONFIRMED  COMPLETED on a person's word (POS card / mobile money
 *                       with the slip or SMS reference, or an admin status
 *                       edit). Never provider-verified.
 *   PROVIDER_CONFIRMED  COMPLETED by the gateway settlement code (webhook /
 *                       poll / reconciliation) which stamps `_settlement`
 *   CASH_RECEIVED       COMPLETED cash, counted in the drawer
 *   UNVERIFIED          COMPLETED with no evidence either way (rows written
 *                       before Nov 2026, e.g. POS card "paid on click")
 *   REVERSED            a confirmed payment later found not to exist
 *   REFUNDED            money given back (or a refund record)
 *   FAILED / CANCELLED
 *
 * Manual evidence always wins over a provider stamp, so a row can never be
 * shown as provider-confirmed when a person confirmed it.
 */
export type PaymentConfirmationState =
  | 'PENDING'
  | 'MANUALLY_CONFIRMED'
  | 'PROVIDER_CONFIRMED'
  | 'CASH_RECEIVED'
  | 'UNVERIFIED'
  | 'REVERSED'
  | 'REFUNDED'
  | 'FAILED'
  | 'CANCELLED';

export const PAYMENT_CONFIRMATION_LABELS: Record<PaymentConfirmationState, string> = {
  PENDING: 'Pending — not confirmed',
  MANUALLY_CONFIRMED: 'Manually confirmed (not verified by the provider)',
  PROVIDER_CONFIRMED: 'Confirmed by the payment provider',
  CASH_RECEIVED: 'Cash received',
  UNVERIFIED: 'Recorded as paid — no confirmation evidence',
  REVERSED: 'Reversed',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

interface PaymentLike {
  status: string;
  method?: string | null;
  gatewayResponse?: unknown;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {});

export function paymentConfirmationState(p: PaymentLike): PaymentConfirmationState {
  switch (p.status) {
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'REVERSED':
      return 'REVERSED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'COMPLETED':
      break;
    default:
      return 'UNVERIFIED';
  }
  const gr = obj(p.gatewayResponse);
  const v = obj(gr.verification);
  const manual = obj(gr.manualStatusChange);
  if (v.evidence === 'manual' || v.providerVerified === false || manual.providerVerified === false) {
    return 'MANUALLY_CONFIRMED';
  }
  if (obj(gr._settlement).providerVerified === true) return 'PROVIDER_CONFIRMED';
  if ((p.method ?? '').toUpperCase() === 'CASH') return 'CASH_RECEIVED';
  return 'UNVERIFIED';
}

/** Adds `confirmationState` + `confirmationLabel` to a payment row (read side only). */
export function withConfirmation<T extends PaymentLike>(p: T): T & { confirmationState: PaymentConfirmationState; confirmationLabel: string } {
  const confirmationState = paymentConfirmationState(p);
  return { ...p, confirmationState, confirmationLabel: PAYMENT_CONFIRMATION_LABELS[confirmationState] };
}

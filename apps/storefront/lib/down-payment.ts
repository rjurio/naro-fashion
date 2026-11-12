/**
 * Storefront copy of the API's rental down-payment rule
 * (apps/api/src/rentals/down-payment.ts): rental fee x pct %, rounded UP to a
 * whole shilling, never more than the fee. The booking stores the API's value;
 * this copy only previews it before booking. apps/api/src/rentals/down-payment.spec.ts
 * fails if the two drift.
 */
// --- shared:computeDownPayment:start
export function computeDownPayment(rentalFee: number, pct: number): number {
  const fee = Number(rentalFee);
  const p = Number(pct);
  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(p) || p <= 0) return 0;
  const feeCents = Math.round(fee * 100);
  const pctHundredths = Math.round(Math.min(p, 100) * 100);
  // exact down payment in units of 1/1,000,000 TZS = feeCents * pctHundredths
  const micro = feeCents * pctHundredths;
  const wholeUp = Math.ceil(micro / 1_000_000);
  const feeWholeUp = Math.ceil(feeCents / 100);
  return Math.min(wholeUp, feeWholeUp);
}
// --- shared:computeDownPayment:end

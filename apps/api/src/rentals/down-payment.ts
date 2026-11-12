/**
 * The ONE rental down-payment calculation (design branch, Nov 2026).
 *
 * Down payment (kianzio) = rental fee x pct %, ROUNDED UP to a whole
 * Tanzanian shilling, and never more than the whole-shilling fee.
 *  - computed once, at booking, and stored on RentalOrder.downPaymentAmount;
 *  - every later step (settlement "down payment covered?", balance,
 *    receipts, admin and storefront displays) uses the STORED value and
 *    never recomputes or re-rounds it (no double rounding);
 *  - rounding up never under-collects (paid >= stored always means at
 *    least pct % was paid), and adds less than 1 TZS, which comes out of
 *    the balance: the total due (fee + deposit + late fee) is unchanged, so
 *    there is no overpayment.
 * Integer-cent arithmetic, so binary floating point can't flip a result
 * (e.g. 70.35 x 25 % = 17.5875 -> 18).
 *
 * The storefront has a byte-identical copy in apps/storefront/lib/down-payment.ts
 * (it can't import API code); rentals/down-payment.spec.ts fails if they drift.
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

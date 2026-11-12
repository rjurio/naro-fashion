/**
 * The ONE place the rental money terms of a booking are worked out.
 *
 * Used by `RentalsService.create()` (what is stored on the booking) and by
 * the public `GET /rentals/quote/:productId` (what the storefront shows), so
 * the page can never show a different percentage or amount from the one the
 * booking stores. The storefront does no financial arithmetic of its own.
 *
 * Down-payment percentage, in order:
 *   1. the product's own `rentalDownPaymentPct` (an explicit override);
 *   2. the shop's `RentalPolicy.defaultDownPaymentPct`;
 *   3. the platform default, 25 %.
 * A level is used only if it is a finite number from 0 to 100. A missing or
 * invalid value (null, negative, over 100, not a number) falls through to the
 * next level; it never becomes an obligation of its own.
 *
 * Release note: when this branch is rebased onto PR #12, `downPayment` must
 * call `computeDownPayment(rentalFee, pct)` from `./down-payment` (rounded up
 * to a whole shilling, capped at the fee) instead of the exact product below.
 */

export const DEFAULT_DOWN_PAYMENT_PCT = 25;

export type DownPaymentSource = 'product' | 'shop' | 'default';

type Numeric = number | string | { toString(): string } | null | undefined;

export interface RentalTermsProduct {
  rentalPricePerDay?: Numeric;
  basePrice?: Numeric;
  rentalDepositAmount?: Numeric;
  rentalDownPaymentPct?: Numeric;
}

export interface RentalTermsPolicy {
  defaultDownPaymentPct?: Numeric;
}

export interface RentalTerms {
  /** Flat rental fee for the whole rental (the column name `rentalPricePerDay` is legacy). */
  rentalFee: number;
  /** Refundable deposit: separate from the fee and never part of the down payment. */
  deposit: number;
  downPaymentPct: number;
  downPaymentSource: DownPaymentSource;
  /** Down payment, on the rental fee only. */
  downPayment: number;
  /** Rental fee + refundable deposit. */
  total: number;
  /** Total minus the down payment (due before dispatch). */
  remaining: number;
}

function validPct(v: Numeric): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function effectiveDownPaymentPct(
  productPct: Numeric,
  shopPct: Numeric,
): { pct: number; source: DownPaymentSource } {
  const p = validPct(productPct);
  if (p !== null) return { pct: p, source: 'product' };
  const s = validPct(shopPct);
  if (s !== null) return { pct: s, source: 'shop' };
  return { pct: DEFAULT_DOWN_PAYMENT_PCT, source: 'default' };
}

export function rentalTerms(
  product: RentalTermsProduct,
  policy: RentalTermsPolicy | null | undefined,
): RentalTerms {
  // Same fee and deposit rules RentalsService.create has always used: the
  // flat rental price, or 10 % of the retail price when none is set.
  const rentalFee = product.rentalPricePerDay
    ? Number(product.rentalPricePerDay)
    : Number(product.basePrice) * 0.1;
  const deposit = product.rentalDepositAmount
    ? Number(product.rentalDepositAmount)
    : 0;
  const { pct, source } = effectiveDownPaymentPct(
    product.rentalDownPaymentPct,
    policy?.defaultDownPaymentPct,
  );
  const downPayment = rentalFee * (pct / 100);
  const total = rentalFee + deposit;
  return {
    rentalFee,
    deposit,
    downPaymentPct: pct,
    downPaymentSource: source,
    downPayment,
    total,
    remaining: total - downPayment,
  };
}

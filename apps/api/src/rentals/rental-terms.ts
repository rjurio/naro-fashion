/**
 * The ONE place the rental money terms of a booking are worked out.
 *
 * Used by `RentalsService.create()` (what is stored on the booking) and by
 * the public `GET /rentals/quote/:productId` (what the storefront shows), so
 * the page can never show a different percentage or amount from the one the
 * booking stores. The storefront does no financial arithmetic of its own.
 *
 * Down-payment percentage, by the product's `rentalDownPaymentMode`:
 *   'CUSTOM'  -> the product's `rentalDownPaymentPct` (an explicit override);
 *   'INHERIT' -> the shop's `RentalPolicy.defaultDownPaymentPct` (the product
 *                pct is ignored);
 *   NULL      -> not yet reviewed (rows from before the inheritance change):
 *                the stored product pct if valid, exactly as before.
 * Then the shop default, then the platform default, 25 %.
 * A level is used only if it is a finite number from 0 to 100 (0 % is valid:
 * no down payment). A missing value falls through silently; an INVALID one
 * (negative, over 100, not a number, or an unknown mode) falls through and is
 * reported in `invalidSettings` so the caller can log a warning. It never
 * becomes an obligation of its own.
 *
 * Release note: when this branch is rebased onto PR #12, `downPayment` must
 * call `computeDownPayment(rentalFee, pct)` from `./down-payment` (rounded up
 * to a whole shilling, capped at the fee) instead of the exact product below.
 */

export const DEFAULT_DOWN_PAYMENT_PCT = 25;

export type DownPaymentSource = 'product' | 'shop' | 'default';
export type TermsSetting = 'product' | 'shop' | 'mode';
export const DOWN_PAYMENT_MODES = ['INHERIT', 'CUSTOM'] as const;
export type DownPaymentMode = (typeof DOWN_PAYMENT_MODES)[number];

type Numeric = number | string | { toString(): string } | null | undefined;

export interface RentalTermsProduct {
  rentalPricePerDay?: Numeric;
  basePrice?: Numeric;
  rentalDepositAmount?: Numeric;
  rentalDownPaymentPct?: Numeric;
  rentalDownPaymentMode?: string | null;
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
  /** Settings that were present but invalid and therefore ignored. */
  invalidSettings: TermsSetting[];
  /** false when the amounts can't be used (no usable rental fee, bad deposit). */
  usable: boolean;
}

/** The public subset: what the storefront needs and nothing else. */
export interface PublicRentalQuote {
  rentalFee: number;
  deposit: number;
  downPaymentPct: number;
  downPayment: number;
  total: number;
  remaining: number;
}

function isMissing(v: Numeric): boolean {
  return v === null || v === undefined || v === '';
}

function validPct(v: Numeric): number | null {
  if (isMissing(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function effectiveDownPaymentPct(
  productPct: Numeric,
  shopPct: Numeric,
  mode?: string | null,
): { pct: number; source: DownPaymentSource; invalid: TermsSetting[] } {
  const invalid: TermsSetting[] = [];
  const knownMode = mode === null || mode === undefined || (DOWN_PAYMENT_MODES as readonly string[]).includes(mode);
  if (!knownMode) invalid.push('mode');
  if (mode !== 'INHERIT') {
    // CUSTOM, not yet reviewed (NULL), or an unknown mode: the product's own %
    const p = validPct(productPct);
    if (p !== null) return { pct: p, source: 'product', invalid };
    if (!isMissing(productPct) || mode === 'CUSTOM') invalid.push('product');
  }
  const s = validPct(shopPct);
  if (s !== null) return { pct: s, source: 'shop', invalid };
  if (!isMissing(shopPct)) invalid.push('shop');
  return { pct: DEFAULT_DOWN_PAYMENT_PCT, source: 'default', invalid };
}

/** Effective SHOP-level percentage (no product): for catalogue copy. */
export function shopDownPaymentPct(shopPct: Numeric): number {
  return validPct(shopPct) ?? DEFAULT_DOWN_PAYMENT_PCT;
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
  const { pct, source, invalid } = effectiveDownPaymentPct(
    product.rentalDownPaymentPct,
    policy?.defaultDownPaymentPct,
    product.rentalDownPaymentMode,
  );
  const downPayment = rentalFee * (pct / 100);
  const total = rentalFee + deposit;
  const usable =
    Number.isFinite(rentalFee) && rentalFee > 0 &&
    Number.isFinite(deposit) && deposit >= 0 &&
    Number.isFinite(downPayment) && downPayment >= 0 && downPayment <= rentalFee;
  return {
    rentalFee,
    deposit,
    downPaymentPct: pct,
    downPaymentSource: source,
    downPayment,
    total,
    remaining: total - downPayment,
    invalidSettings: invalid,
    usable,
  };
}

export function publicQuote(t: RentalTerms): PublicRentalQuote {
  return {
    rentalFee: t.rentalFee,
    deposit: t.deposit,
    downPaymentPct: t.downPaymentPct,
    downPayment: t.downPayment,
    total: t.total,
    remaining: t.remaining,
  };
}

const cents = (n: number) => Math.round(n * 100);

/**
 * The amounts the customer saw (sent back with the booking) vs the amounts
 * the booking would store now. Any difference of a cent or more is a change
 * of terms the customer has not seen. Fields the client didn't send are not
 * compared (old clients, or the quote couldn't be loaded).
 */
export function quotedTermsDiffer(
  quoted: { quotedRentalFee?: number; quotedDeposit?: number; quotedDownPayment?: number },
  t: RentalTerms,
): boolean {
  const pairs: Array<[number | undefined, number]> = [
    [quoted.quotedRentalFee, t.rentalFee],
    [quoted.quotedDeposit, t.deposit],
    [quoted.quotedDownPayment, t.downPayment],
  ];
  return pairs.some(([q, now]) => q !== undefined && q !== null && cents(Number(q)) !== cents(now));
}

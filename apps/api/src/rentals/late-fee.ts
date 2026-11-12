import { eatCalendarDaysBetween } from '../reports/eat-time.util';

/**
 * Late-fee rules (owner-approved 2026-11-12 for NEW bookings, round 25 C).
 * ONE calculation for the storefront quote, POS quote, booking, return,
 * overdue list and agreement — the booking stores the terms it was made
 * under (RentalOrder.lateFeeTerms) and the return uses exactly those.
 *
 * Precedence:
 *   1. the product's latePenaltyPercent when set (0–100). An explicit 0 % is
 *      NO late fee — never replaced by any fixed charge;
 *   2. otherwise the shop default % (RentalPolicy.defaultLateFeePct, 10 %
 *      when unset);
 *   3. a FREE rental (fee 0) has no late fee unless the shop sets an explicit
 *      free-rental daily charge (RentalPolicy.freeRentalLateFeePerDay) — the
 *      old fixed lateFeePerDay is NOT used for new bookings;
 *   4. the accumulated late fee never exceeds RentalPolicy.lateFeeCapPct of
 *      the rental fee (100 % when unset);
 *   5. whole calendar days after the agreed return date, Tanzanian time.
 * No loss or damage charge is ever computed here.
 */
export const LATE_FEE_RULES_VERSION = 'LF-2026-11';
export const DEFAULT_LATE_FEE_PCT = 10;
export const DEFAULT_LATE_FEE_CAP_PCT = 100;

export interface LateFeeTerms {
  version: string;
  basis: 'PERCENT' | 'FIXED' | 'NONE';
  /** PERCENT basis: % of the rental fee per late day. */
  pct: number | null;
  /** Charge per whole late day (TZS). */
  perDay: number;
  /** Cap as % of the rental fee (PERCENT) — null when uncapped (FIXED with no cap). */
  capPct: number | null;
  /** Maximum accumulated late fee (TZS); null = no maximum. */
  capAmount: number | null;
  rentalFee: number;
  source: 'PRODUCT' | 'SHOP_DEFAULT' | 'FREE_RENTAL_POLICY' | 'NONE';
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function lateFeeTerms(input: {
  rentalFee: number;
  productPct?: unknown;
  shopDefaultPct?: unknown;
  capPct?: unknown;
  freeRentalPerDay?: unknown;
}): LateFeeTerms {
  const fee = Math.max(0, Number(input.rentalFee) || 0);
  const capPctRaw = num(input.capPct);
  const capPct = capPctRaw !== null && capPctRaw >= 0 && capPctRaw <= 100 ? capPctRaw : DEFAULT_LATE_FEE_CAP_PCT;
  const base = { version: LATE_FEE_RULES_VERSION, rentalFee: fee };
  if (fee <= 0) {
    const fixed = num(input.freeRentalPerDay);
    if (fixed !== null && fixed > 0) {
      return { ...base, basis: 'FIXED', pct: null, perDay: r2(fixed), capPct: null, capAmount: null, source: 'FREE_RENTAL_POLICY' };
    }
    return { ...base, basis: 'NONE', pct: null, perDay: 0, capPct: null, capAmount: null, source: 'NONE' };
  }
  const productPct = num(input.productPct);
  const shopPct = num(input.shopDefaultPct);
  const valid = (p: number | null) => p !== null && p >= 0 && p <= 100;
  const pct = valid(productPct) ? productPct! : valid(shopPct) ? shopPct! : DEFAULT_LATE_FEE_PCT;
  const source = valid(productPct) ? 'PRODUCT' : 'SHOP_DEFAULT';
  if (pct === 0) return { ...base, basis: 'NONE', pct: 0, perDay: 0, capPct: null, capAmount: null, source };
  return {
    ...base, basis: 'PERCENT', pct, perDay: r2((fee * pct) / 100), capPct, capAmount: r2((fee * capPct) / 100), source,
  };
}

/** Whole late days (Tanzanian calendar) between the agreed return date and `at`. */
export function lateDays(agreedReturn: Date, at: Date): number {
  return Math.max(0, eatCalendarDaysBetween(agreedReturn, at));
}

export function lateFeeFor(terms: LateFeeTerms, days: number): number {
  if (terms.basis === 'NONE' || days <= 0) return 0;
  const raw = r2(terms.perDay * days);
  return terms.capAmount !== null ? Math.min(raw, terms.capAmount) : raw;
}

/** The terms stored on a booking (null for bookings made before these rules). */
export function storedLateFeeTerms(v: unknown): LateFeeTerms | null {
  const t = v as LateFeeTerms | null;
  return t && typeof t === 'object' && t.version && t.basis ? t : null;
}

/** Customer-facing wording (EN / SW), from the terms only. */
export function lateFeeSentence(t: LateFeeTerms, lang: 'en' | 'sw' = 'en'): string {
  const tzs = (n: number) => `TZS ${n.toLocaleString('en-US')}`;
  if (t.basis === 'NONE') return lang === 'sw' ? 'Hakuna ada ya kuchelewa kwa bidhaa hii.' : 'No late fee applies to this item.';
  const per = t.basis === 'PERCENT' ? `${t.pct}% (${tzs(t.perDay)})` : tzs(t.perDay);
  const cap = t.capAmount !== null ? (lang === 'sw' ? `, isiyozidi ${tzs(t.capAmount)} kwa jumla` : `, up to ${tzs(t.capAmount)} in total`) : '';
  return lang === 'sw'
    ? `Ada ya kuchelewa: ${per} kwa kila siku kamili baada ya tarehe ya kurudisha${cap}.`
    : `Late fee: ${per} for each full day after the return date${cap}.`;
}

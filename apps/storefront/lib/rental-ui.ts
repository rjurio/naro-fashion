/**
 * Pure helpers for how the storefront presents Buy vs Rent.
 *
 * Deliberately dependency-free (no React, no `@/` imports) so the API jest
 * suite can unit-test them: `apps/api/src/storefront/rental-ui.spec.ts`.
 */

export type AvailabilityMode = 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';

/** Unknown / missing values are treated as purchase-only (the API default). */
export function normalizeAvailabilityMode(mode?: string | null): AvailabilityMode {
  return mode === 'RENTAL_ONLY' || mode === 'BOTH' ? mode : 'PURCHASE_ONLY';
}

export function canBuy(mode?: string | null): boolean {
  return normalizeAvailabilityMode(mode) !== 'RENTAL_ONLY';
}

export function canRent(mode?: string | null): boolean {
  return normalizeAvailabilityMode(mode) !== 'PURCHASE_ONLY';
}

/** Where a product card is shown. On the rentals catalogue a card never offers a purchase. */
export type CardContext = 'shop' | 'rentals';

export interface CardActions {
  buy: boolean;
  rent: boolean;
}

/**
 * Quick actions on a product card.
 *  - PURCHASE_ONLY → Add to Cart only
 *  - RENTAL_ONLY   → Rent only (never Add to Cart — that would sell the gown)
 *  - BOTH          → Add to Cart + Rent, except on /rentals where only Rent
 */
export function cardActions(mode: string | null | undefined, context: CardContext = 'shop'): CardActions {
  const m = normalizeAvailabilityMode(mode);
  const rent = m !== 'PURCHASE_ONLY';
  const buy = m !== 'RENTAL_ONLY' && !(context === 'rentals' && rent);
  return { buy, rent };
}

export function rentalHref(slugOrId: string): string {
  return `/rentals/${encodeURIComponent(slugOrId)}`;
}

/**
 * Total row count from a paginated list response. The API returns
 * `{ data, meta: { total } }`; older callers expected a top-level `total`.
 */
export function listTotal(res: unknown, fallback = 0): number {
  const r = res as { meta?: { total?: unknown }; total?: unknown } | null | undefined;
  const t = r?.meta?.total ?? r?.total;
  const n = typeof t === 'number' ? t : Number(t);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Rows from a list response that may be a bare array or `{ data: [...] }`. */
export function listData<T = unknown>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const d = (res as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}

/**
 * The variant to preselect on the rental booking page: the only active
 * variant, when there is exactly one. With several, the customer chooses.
 * (Rentals are booked per date range, not against variant stock, so stock
 * does not disqualify a variant here.)
 */
export function autoSelectRentalVariantId(
  variants: Array<{ id: string; isActive?: boolean | null }> | null | undefined,
): string {
  const active = (variants ?? []).filter((v) => v && v.isActive !== false);
  return active.length === 1 ? active[0].id : '';
}

export interface RentalQuote {
  rentalFee: number;
  deposit: number;
  downPaymentPct: number;
  downPayment: number;
  /** Rental fee + refundable deposit. */
  total: number;
  /** Total minus the down payment. */
  remaining: number;
}

/**
 * Same arithmetic as RentalsService.create: the rental fee is FLAT for the
 * whole rental (up to maxRentalDays; `rentalPricePerDay` is a legacy column
 * name), the down payment is a percentage of the rental fee only, and the
 * deposit is refundable and separate. Falls back to 10% of the retail price
 * when no rental price is set, exactly like the API.
 */
export function rentalQuote(p: {
  rentalPricePerDay?: unknown;
  basePrice?: unknown;
  rentalDepositAmount?: unknown;
  rentalDownPaymentPct?: unknown;
}): RentalQuote {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const rentalFee = num(p.rentalPricePerDay) || num(p.basePrice) * 0.1;
  const deposit = num(p.rentalDepositAmount);
  const pctRaw = Number(p.rentalDownPaymentPct);
  const downPaymentPct = Number.isFinite(pctRaw) && pctRaw > 0 && pctRaw <= 100 ? pctRaw : 25;
  const downPayment = Math.round(rentalFee * (downPaymentPct / 100));
  const total = rentalFee + deposit;
  return { rentalFee, deposit, downPaymentPct, downPayment, total, remaining: total - downPayment };
}

export interface CardProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating: number;
  reviewCount: number;
  isNew: boolean;
  isOnSale: boolean;
  isRentable: boolean;
  rentPrice?: number;
  availabilityMode: AvailabilityMode;
  defaultVariantId?: string;
}

/**
 * Raw API product → ProductCard props. Spreading the raw product straight
 * into <ProductCard> renders "TSh 0" because the API field is `basePrice`,
 * not `price` (the "You May Also Like" bug).
 */
export function toCardProduct(p: any, apiOrigin: string): CardProduct {
  const price = Number(p?.basePrice) || 0;
  const compareAt = p?.compareAtPrice != null ? Number(p.compareAtPrice) : undefined;
  const first = p?.images?.[0];
  const url: string | undefined = typeof first === 'string' ? first : first?.url;
  const image = url ? (url.startsWith('/uploads') ? `${apiOrigin}${url}` : url) : undefined;
  const mode = normalizeAvailabilityMode(p?.availabilityMode);
  const rent = Number(p?.rentalPricePerDay);
  return {
    id: p?.id,
    name: p?.name ?? '',
    slug: p?.slug ?? p?.id,
    price,
    originalPrice: compareAt != null && Number.isFinite(compareAt) ? compareAt : undefined,
    image,
    rating: p?.avgRating ?? 0,
    reviewCount: p?.reviewCount ?? 0,
    isNew: false,
    isOnSale: compareAt != null && compareAt > price,
    isRentable: mode !== 'PURCHASE_ONLY',
    rentPrice: Number.isFinite(rent) && rent > 0 ? rent : undefined,
    availabilityMode: mode,
    defaultVariantId: p?.variants?.[0]?.id,
  };
}

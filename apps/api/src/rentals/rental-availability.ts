import { SALE_RELEASING_RENTAL_STATUSES, findBothGownRentalBlock } from './rental-sale-guard';

/**
 * ONE availability rule for renting a gown (release 1, Nov 2026).
 *
 * Used by every place that answers "can this gown be rented for these
 * dates?", so the answer can never differ between them:
 *  - GET /rentals/availability/:productId (advisory, read-only, no lock);
 *  - RentalsService.create: a fast pre-check, then AGAIN inside the booking
 *    transaction after taking the per-product advisory lock. The second,
 *    locked check is the authoritative one: it never trusts the pre-check
 *    or a stale availability answer;
 *  - RentalsService.update (admin date change), with `scope: 'reschedule'`.
 *
 * Conservative, product-level capacity: one rentable gown per product. Seeded
 * `ProductVariant.stock` is never treated as rental capacity.
 *
 * A gown is NOT available when (first matching reason wins):
 *  1. NOT_RENTABLE_PRODUCT: PURCHASE_ONLY, inactive/archived or deleted;
 *  2. OVERDUE_RETURN: a rental is still out with a customer (dispatched /
 *     active / overdue) past its booked return date. Nobody knows when it
 *     comes back, so no new booking is accepted until it is returned;
 *  3. DATES_TAKEN: the dates (± buffer days) overlap any rental that is not
 *     finished. Finished = CLOSED / CANCELLED / REJECTED / ID_REJECTED, the
 *     same set that releases a gown for SALE. RETURNED and INSPECTION still
 *     hold their window, measured to the actual return if that was later;
 *  4. BOTH (buy-or-rent) gowns only: SOLD_OUT, SOLD_SINCE_LAST_RESTOCK,
 *     SOLD_NO_VERIFIED_RESTOCK or ON_LAYAWAY (see findBothGownRentalBlock).
 *
 * Read-only: never writes.
 */

export const AVAILABILITY_RELEASING_STATUSES = SALE_RELEASING_RENTAL_STATUSES;

/** The gown has physically left the shop with a customer. */
export const OUT_WITH_CUSTOMER_STATUSES = ['ITEM_DISPATCHED', 'ACTIVE', 'OVERDUE'];

export type RentalBlockReason =
  | 'NOT_RENTABLE_PRODUCT'
  | 'OVERDUE_RETURN'
  | 'DATES_TAKEN'
  | 'SOLD_OUT'
  | 'SOLD_SINCE_LAST_RESTOCK'
  | 'SOLD_NO_VERIFIED_RESTOCK'
  | 'ON_LAYAWAY';

export interface RentableProduct {
  id: string;
  availabilityMode: string;
  isActive?: boolean | null;
  deletedAt?: Date | null;
  /** Set only by an independently approved count (RentalUnitTrackingChange). */
  rentalUnitTrackingActivatedAt?: Date | null;
}

export interface AvailabilityQuery {
  tenantId: string;
  product: RentableProduct;
  startDate: Date;
  returnDate: Date;
  bufferDays: number;
  /** The rental being rescheduled (never blocks itself). */
  excludeRentalId?: string;
  /**
   * 'booking' (default): every rule. 'reschedule': an admin moving the dates
   * of an EXISTING booking. Only the date window is re-checked; the gown is
   * already committed to that customer.
   */
  scope?: 'booking' | 'reschedule';
  now?: Date;
  /** POS rental MVP (M2): the chosen variant (size) — units must fit it. */
  variantId?: string | null;
  /** Reschedule: the unit the booking already holds (kept when still free). */
  currentUnitId?: string | null;
}

export interface RentalAvailability {
  block: RentalBlockReason | null;
  /** Unit-managed products: the free unit to allocate (null in legacy mode). */
  unitId: string | null;
  mode: 'LEGACY' | 'UNITS';
}

/** Unit statuses that can be booked. */
export const BOOKABLE_UNIT_STATUSES = ['ACTIVE'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRentableProduct(p: RentableProduct): boolean {
  return (
    (p.availabilityMode === 'RENTAL_ONLY' || p.availabilityMode === 'BOTH') &&
    p.isActive !== false &&
    !p.deletedAt
  );
}

export async function findRentalAvailabilityBlock(db: any, q: AvailabilityQuery): Promise<RentalBlockReason | null> {
  return (await findRentalAvailability(db, q)).block;
}

/**
 * The ONE availability rule, now unit-aware (POS rental MVP, M2):
 *  - a product NOT activated for per-gown tracking (or with no verified gown)
 *    → the legacy rule below (one booking at
 *    a time per product, overdue blocks, BOTH-gown sale rules) — unchanged;
 *  - an ACTIVATED product → at least one VERIFIED unit that is ACTIVE, fits the chosen
 *    variant (no fit rows = fits all), has no maintenance block and no
 *    blocking booking overlapping the buffered window, and is not out with a
 *    customer past its return date. A legacy booking with no unit takes one
 *    unit's capacity. BOTH-gown sale rules still apply to the product.
 * Read-only; the caller allocates `unitId` inside its transaction, under the
 * per-product advisory lock.
 */
export async function findRentalAvailability(db: any, q: AvailabilityQuery): Promise<RentalAvailability> {
  const scope = q.scope ?? 'booking';
  const now = q.now ?? new Date();
  const legacy = (block: RentalBlockReason | null): RentalAvailability => ({ block, unitId: null, mode: 'LEGACY' });

  if (scope === 'booking' && !isRentableProduct(q.product)) return legacy('NOT_RENTABLE_PRODUCT');

  // Per-gown availability ONLY for a product switched on by an approved,
  // independently reviewed count — registering units never changes capacity
  // by itself — and only with the gowns that count verified.
  if (!(await isUnitTrackingActive(db, q))) return legacy(await legacyBlock(db, q, scope, now));
  const units: Array<{ id: string; code: string; status: string; fits: Array<{ variantId: string }>; blocks: Array<{ startsAt: Date; endsAt: Date }> }> =
    (await db.rentalUnit?.findMany?.({
      where: { tenantId: q.tenantId, productId: q.product.id, trackingVerifiedAt: { not: null } },
      select: { id: true, code: true, status: true, fits: { select: { variantId: true } }, blocks: { select: { startsAt: true, endsAt: true } } },
      orderBy: { code: 'asc' },
    })) ?? [];
  if (units.length > 0) return unitAvailability(db, q, units, scope, now);
  return legacy(await legacyBlock(db, q, scope, now));
}

/** True only when the product's per-gown tracking was activated by an approved count. */
export async function isUnitTrackingActive(db: any, q: { tenantId: string; product: RentableProduct }): Promise<boolean> {
  if (q.product.rentalUnitTrackingActivatedAt !== undefined) return !!q.product.rentalUnitTrackingActivatedAt;
  const row = await db.product?.findFirst?.({
    where: { id: q.product.id, tenantId: q.tenantId },
    select: { rentalUnitTrackingActivatedAt: true },
  });
  return !!row?.rentalUnitTrackingActivatedAt;
}

async function unitAvailability(
  db: any,
  q: AvailabilityQuery,
  units: Array<{ id: string; code: string; status: string; fits: Array<{ variantId: string }>; blocks: Array<{ startsAt: Date; endsAt: Date }> }>,
  scope: 'booking' | 'reschedule',
  now: Date,
): Promise<RentalAvailability> {
  const result = (block: RentalBlockReason | null, unitId: string | null = null): RentalAvailability => ({ block, unitId, mode: 'UNITS' });
  const bufferMs = q.bufferDays * DAY_MS;
  const wantStart = q.startDate.getTime() - bufferMs;
  const wantEnd = q.returnDate.getTime() + bufferMs;
  const overlaps = (a: number, b: number) => a < wantEnd && b > wantStart;

  const open: Array<{ id: string; status: string; startDate: Date; returnDate: Date; actualReturnDate?: Date | null; rentalUnitId?: string | null }> =
    await db.rentalOrder.findMany({
      where: {
        tenantId: q.tenantId,
        productId: q.product.id,
        status: { notIn: AVAILABILITY_RELEASING_STATUSES },
        ...(q.excludeRentalId ? { id: { not: q.excludeRentalId } } : {}),
      },
      select: { id: true, status: true, startDate: true, returnDate: true, actualReturnDate: true, rentalUnitId: true },
      take: 1000,
    });

  const busy = new Set<string>();
  let unassignedClashes = 0;
  for (const r of open) {
    const start = new Date(r.startDate).getTime();
    const booked = new Date(r.returnDate).getTime();
    const actual = r.actualReturnDate ? new Date(r.actualReturnDate).getTime() : booked;
    // Out with a customer and late: holds its unit until it is returned.
    const overdueOut = OUT_WITH_CUSTOMER_STATUSES.includes(r.status) && booked < now.getTime();
    const clash = overdueOut || overlaps(start, Math.max(booked, actual));
    if (!clash) continue;
    if (r.rentalUnitId) busy.add(r.rentalUnitId);
    else unassignedClashes++;
  }

  const fits = (u: { fits: Array<{ variantId: string }> }) =>
    !q.variantId || u.fits.length === 0 || u.fits.some((f) => f.variantId === q.variantId);
  const blocked = (u: { blocks: Array<{ startsAt: Date; endsAt: Date }> }) =>
    u.blocks.some((b) => overlaps(new Date(b.startsAt).getTime(), new Date(b.endsAt).getTime()));
  const free = units.filter((u) => BOOKABLE_UNIT_STATUSES.includes(u.status) && fits(u) && !blocked(u) && !busy.has(u.id));

  // Bookings made before units existed each take one unit's capacity.
  if (free.length - unassignedClashes <= 0) return result('DATES_TAKEN');
  const keep = q.currentUnitId ? free.find((u) => u.id === q.currentUnitId) : undefined;
  const chosen = keep ?? free[unassignedClashes] ?? free[0];

  if (scope === 'booking' && q.product.availabilityMode === 'BOTH') {
    const sale = await findBothGownRentalBlock(db, q.tenantId, q.product.id);
    if (sale) return result(sale);
  }
  return result(null, chosen.id);
}

async function legacyBlock(db: any, q: AvailabilityQuery, scope: 'booking' | 'reschedule', now: Date): Promise<RentalBlockReason | null> {

  const open: Array<{ id: string; status: string; startDate: Date; returnDate: Date; actualReturnDate?: Date | null }> =
    await db.rentalOrder.findMany({
      where: {
        tenantId: q.tenantId,
        productId: q.product.id,
        status: { notIn: AVAILABILITY_RELEASING_STATUSES },
        ...(q.excludeRentalId ? { id: { not: q.excludeRentalId } } : {}),
      },
      select: { id: true, status: true, startDate: true, returnDate: true, actualReturnDate: true },
      orderBy: { startDate: 'asc' },
      take: 500,
    });

  if (scope === 'booking') {
    const overdue = open.some(
      (r) => OUT_WITH_CUSTOMER_STATUSES.includes(r.status) && new Date(r.returnDate).getTime() < now.getTime(),
    );
    if (overdue) return 'OVERDUE_RETURN';
  }

  const bufferMs = q.bufferDays * DAY_MS;
  const wantStart = q.startDate.getTime() - bufferMs;
  const wantEnd = q.returnDate.getTime() + bufferMs;
  const clash = open.some((r) => {
    const start = new Date(r.startDate).getTime();
    const booked = new Date(r.returnDate).getTime();
    const actual = r.actualReturnDate ? new Date(r.actualReturnDate).getTime() : booked;
    const end = Math.max(booked, actual);
    return start < wantEnd && end > wantStart;
  });
  if (clash) return 'DATES_TAKEN';

  if (scope === 'booking' && q.product.availabilityMode === 'BOTH') {
    return findBothGownRentalBlock(db, q.tenantId, q.product.id);
  }
  return null;
}

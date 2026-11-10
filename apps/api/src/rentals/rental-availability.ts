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
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRentableProduct(p: RentableProduct): boolean {
  return (
    (p.availabilityMode === 'RENTAL_ONLY' || p.availabilityMode === 'BOTH') &&
    p.isActive !== false &&
    !p.deletedAt
  );
}

export async function findRentalAvailabilityBlock(db: any, q: AvailabilityQuery): Promise<RentalBlockReason | null> {
  const scope = q.scope ?? 'booking';
  const now = q.now ?? new Date();

  if (scope === 'booking' && !isRentableProduct(q.product)) return 'NOT_RENTABLE_PRODUCT';

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

import { ConflictException } from '@nestjs/common';

/**
 * P0b (Nov 2026): never SELL a gown that is committed to a rental.
 *
 * Until a verified physical-unit model exists, NARO keeps the conservative
 * product-level rule the booking code already uses: one rentable gown per
 * product. So a product with ANY rental that is not finished must not be
 * sold — online checkout or POS (sale, layaway, layaway hand-over, exchange
 * replacement). Seeded `ProductVariant.stock` values (10/11 on some gowns)
 * are NOT treated as evidence of several physical gowns.
 *
 * A rental stops blocking a sale only when it is genuinely over:
 *   CLOSED (returned + inspected) or CANCELLED (or a rejected request).
 * Reserved / ID / paid / ready / dispatched / active / OVERDUE (still out,
 * whatever the booked dates) / RETURNED / INSPECTION all keep blocking —
 * the gown is promised, out, or not yet checked back in. There is no
 * maintenance state in the schema yet (planned with physical units).
 *
 * Concurrency: the check runs INSIDE the sale transaction after taking the
 * same advisory lock RentalsService.create takes for the product
 * (`pg_advisory_xact_lock(hashtext(productId))`), in sorted product order
 * (no deadlock between multi-item sales). A concurrent booking and sale of
 * the same gown therefore serialise: whichever commits second sees the
 * other (bookings also refuse a BOTH gown with no stock left).
 */
export const RESERVED_FOR_RENTAL = 'RESERVED_FOR_RENTAL';

/** Rental statuses after which the gown may be sold again. */
export const SALE_RELEASING_RENTAL_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED', 'ID_REJECTED'];

export interface RentalObligation {
  productId: string;
  rentalNumber: string;
  status: string;
  startDate: Date;
  returnDate: Date;
}

interface TxLike {
  $executeRaw: (...args: any[]) => Promise<unknown>;
  rentalOrder: { findMany: (args: any) => Promise<any[]> };
}

/** Same lock key as RentalsService.create / update for this product. */
export async function lockProductsForSale(tx: TxLike, productIds: string[]): Promise<void> {
  for (const id of [...new Set(productIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  }
}

export async function findOpenRentalObligations(
  tx: TxLike,
  tenantId: string,
  productIds: string[],
): Promise<RentalObligation[]> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return [];
  return tx.rentalOrder.findMany({
    where: { tenantId, productId: { in: ids }, status: { notIn: SALE_RELEASING_RENTAL_STATUSES } },
    select: { productId: true, rentalNumber: true, status: true, startDate: true, returnDate: true },
    orderBy: { startDate: 'asc' },
    take: 50,
  });
}

const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * Lock the products, then refuse (409 RESERVED_FOR_RENTAL) if any has an
 * open rental. `audience` controls the message: staff see the rental
 * number/status/dates; customers see a neutral "reserved" message with no
 * booking details.
 */
export async function assertNotReservedForRental(
  tx: TxLike,
  tenantId: string,
  products: Array<{ id: string; name?: string | null }>,
  audience: 'staff' | 'customer',
): Promise<void> {
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return;
  await lockProductsForSale(tx, ids);
  const open = await findOpenRentalObligations(tx, tenantId, ids);
  if (open.length === 0) return;

  const nameOf = new Map(products.map((p) => [p.id, p.name || 'This gown']));
  const blockedIds = [...new Set(open.map((o) => o.productId))];
  const names = blockedIds.map((id) => nameOf.get(id) ?? 'This gown');

  if (audience === 'customer') {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: RESERVED_FOR_RENTAL,
      message: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} reserved and can't be bought right now. Please remove it from your cart or contact the shop.`,
    });
  }
  const detail = open
    .slice(0, 5)
    .map((o) => `${o.rentalNumber} (${o.status}, ${day(o.startDate)}–${day(o.returnDate)})`)
    .join('; ');
  throw new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: RESERVED_FOR_RENTAL,
    message: `${names.join(', ')} cannot be sold: committed to rental ${detail}. Close or cancel the rental first.`,
    products: names,
    rentals: open.map((o) => ({ rentalNumber: o.rentalNumber, status: o.status, productId: o.productId })),
  });
}

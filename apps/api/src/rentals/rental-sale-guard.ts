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

// ---------------------------------------------------------------------------
// Booking side (P0b, strengthened): never rent out a gown that can't be
// verified to still exist.
// ---------------------------------------------------------------------------

export const NOT_AVAILABLE_FOR_RENTAL = 'NOT_AVAILABLE_FOR_RENTAL';

/** Order statuses whose lines no longer hold the gown. */
export const SALE_VOID_ORDER_STATUSES = ['CANCELLED', 'REFUNDED'];

interface RentTxLike {
  productVariant: {
    aggregate: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<Array<{ id: string }>>;
  };
  inventoryTransaction: { findFirst: (args: any) => Promise<{ createdAt: Date } | null> };
  orderItem: { findMany: (args: any) => Promise<Array<{ quantity: number; refundedQuantity: number }>> };
  layaway: { findMany: (args: any) => Promise<Array<{ items: unknown }>> };
}

/**
 * Conservative capacity for a BOTH (buy-or-rent) gown until physical rental
 * units exist: ONE rentable gown per product — and it is gone once sold.
 *
 * Refuses (409 NOT_AVAILABLE_FOR_RENTAL) when, under the product lock:
 *  1. no active-variant stock is left; or
 *  2. a sale of the product is still in force (order not CANCELLED/REFUNDED,
 *     line not fully refunded) SINCE THE LAST VERIFIED RESTOCK — an admin
 *     `RESTOCK` inventory transaction (Inventory → adjust, audited with
 *     performedBy). Seeded stock numbers are NOT evidence of another gown;
 *     a recorded restock is; or
 *  3. an ACTIVE layaway holds the gown (promised to a buyer).
 *
 * RENTAL_ONLY products are never sold, so none of this applies to them.
 * Never changes stock or any data.
 */
export async function assertBothGownStillRentable(
  tx: RentTxLike,
  tenantId: string,
  productId: string,
): Promise<void> {
  const refuse = (why: string) =>
    new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: NOT_AVAILABLE_FOR_RENTAL,
      reason: why,
      message: 'This gown is not available to rent.',
    });

  const stock = await tx.productVariant.aggregate({
    where: { productId, tenantId, isActive: true },
    _sum: { stock: true },
  });
  if ((stock?._sum?.stock ?? 0) <= 0) throw refuse('SOLD_OUT');

  const lastRestock = await tx.inventoryTransaction.findFirst({
    where: { tenantId, productId, type: 'RESTOCK', quantityChange: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const sold = await tx.orderItem.findMany({
    where: {
      productId,
      order: {
        tenantId,
        status: { notIn: SALE_VOID_ORDER_STATUSES },
        ...(lastRestock ? { createdAt: { gt: lastRestock.createdAt } } : {}),
      },
    },
    select: { quantity: true, refundedQuantity: true },
    take: 50,
  });
  if (sold.some((l) => (l.refundedQuantity ?? 0) < l.quantity)) {
    throw refuse(lastRestock ? 'SOLD_SINCE_LAST_RESTOCK' : 'SOLD_NO_VERIFIED_RESTOCK');
  }

  const variantIds = new Set((await tx.productVariant.findMany({ where: { productId, tenantId }, select: { id: true } })).map((v) => v.id));
  const layaways = await tx.layaway.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { items: true }, take: 500 });
  const held = layaways.some((l) => Array.isArray(l.items) && (l.items as any[]).some((it) => it && variantIds.has(String(it.variantId))));
  if (held) throw refuse('ON_LAYAWAY');
}

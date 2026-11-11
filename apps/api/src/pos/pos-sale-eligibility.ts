import { BadRequestException } from '@nestjs/common';

/**
 * POS sale eligibility (Nov 2026).
 *
 * A RENTAL_ONLY product (e.g. a bridal gown the shop only hires out) must
 * never be SOLD at the POS — before this check the POS sold it at its retail
 * price like any other item. PURCHASE_ONLY and BOTH stay sellable.
 *
 * Enforced server-side in every POS path that puts a product into a
 * sale-like transaction (sale, layaway, exchange replacement items); the
 * admin UI also disables the action, but the API never relies on that.
 */
export const RENTAL_ONLY_NOT_FOR_SALE = 'RENTAL_ONLY_NOT_FOR_SALE';

export const PRODUCT_NOT_ACTIVE = 'PRODUCT_NOT_ACTIVE';

interface ActiveCheck {
  isActive?: boolean | null;
  product?: { name?: string | null; isActive?: boolean | null; deletedAt?: Date | null; archivedAt?: Date | null } | null;
}

/**
 * An inactive, archived or deleted product (or a disabled variant) is not
 * for sale at the POS either: it is hidden from customers, from the POS
 * search and from the offline catalog, but its barcode could still be
 * scanned (e.g. Royal Pearl Mermaid Gown, kept inactive by the owner).
 * Applies to new sales, layaways and exchange replacements.
 */
export function assertActiveAtPos(variants: Array<ActiveCheck | null | undefined>): void {
  const blocked = [
    ...new Set(
      variants
        .filter((v): v is ActiveCheck => !!v)
        .filter((v) => v.isActive === false || v.product?.isActive === false || !!v.product?.deletedAt || !!v.product?.archivedAt)
        .map((v) => v.product?.name || 'This product'),
    ),
  ];
  if (blocked.length === 0) return;
  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: PRODUCT_NOT_ACTIVE,
    message: `${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} not active and cannot be sold at the POS.`,
    products: blocked,
  });
}

export function isSellableAtPos(availabilityMode?: string | null): boolean {
  return availabilityMode !== 'RENTAL_ONLY';
}

export function assertSellableAtPos(
  products: Array<{ name?: string | null; availabilityMode?: string | null } | null | undefined>,
): void {
  const blocked = [
    ...new Set(
      products
        .filter((p): p is { name?: string | null; availabilityMode?: string | null } => !!p)
        .filter((p) => !isSellableAtPos(p.availabilityMode))
        .map((p) => p.name || 'This product'),
    ),
  ];
  if (blocked.length === 0) return;
  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: RENTAL_ONLY_NOT_FOR_SALE,
    message: `${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} rental-only and cannot be sold at the POS.`,
    products: blocked,
  });
}

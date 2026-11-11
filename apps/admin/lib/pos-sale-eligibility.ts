/**
 * Whether the POS may SELL a product. Mirrors the API rule in
 * apps/api/src/pos/pos-sale-eligibility.ts (which is authoritative — the API
 * rejects RENTAL_ONLY sales with code RENTAL_ONLY_NOT_FOR_SALE whatever the UI
 * does). Missing mode (an offline catalog snapshot taken before Nov 2026)
 * counts as sellable online; the server still checks.
 *
 * Dependency-free so the API jest suite can unit-test it.
 */
export function isSellableAtPos(availabilityMode?: string | null): boolean {
  return availabilityMode !== 'RENTAL_ONLY';
}

/**
 * Why the POS can't sell a product right now, or null.
 *
 * RENTAL_ONLY: never for sale.
 * NEEDS_ONLINE: offline, a buy-or-rent (BOTH) gown can't be sold. Whether it
 * is booked for a rental is only known to the server, and a booking made on
 * the storefront or another device after this till's catalog snapshot can't
 * be seen here. The server would refuse the sale when it syncs, AFTER the
 * customer has left with the gown and paid. So offline it is refused up
 * front. An unknown mode (a snapshot from before Nov 2026) is treated the
 * same way offline.
 */
export type PosSaleBlock = 'RENTAL_ONLY' | 'NEEDS_ONLINE' | null;

export function posSaleBlock(availabilityMode?: string | null, offline = false): PosSaleBlock {
  if (availabilityMode === 'RENTAL_ONLY') return 'RENTAL_ONLY';
  if (offline && (availabilityMode === 'BOTH' || !availabilityMode)) return 'NEEDS_ONLINE';
  return null;
}

export const POS_SALE_BLOCK_LABEL: Record<'RENTAL_ONLY' | 'NEEDS_ONLINE', string> = {
  RENTAL_ONLY: 'Rental only — not for sale',
  NEEDS_ONLINE: 'Buy-or-rent item — sell it online only (bookings must be checked)',
};

/** Cart lines that can't be sold offline (checked again at "Complete sale"). */
export function offlineBlockedItems<T extends { availabilityMode?: string | null }>(items: T[]): T[] {
  return items.filter((i) => posSaleBlock(i.availabilityMode, true) !== null);
}

/**
 * Whether the POS may SELL a product. Mirrors the API rule in
 * apps/api/src/pos/pos-sale-eligibility.ts (which is authoritative — the API
 * rejects RENTAL_ONLY sales with code RENTAL_ONLY_NOT_FOR_SALE whatever the UI
 * does). Missing mode (an offline catalog snapshot taken before Nov 2026)
 * counts as sellable; the server still checks.
 *
 * Dependency-free so the API jest suite can unit-test it.
 */
export function isSellableAtPos(availabilityMode?: string | null): boolean {
  return availabilityMode !== 'RENTAL_ONLY';
}

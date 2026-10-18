/**
 * Offline POS catalog: a per-user snapshot of `GET /pos/catalog` kept in the
 * IndexedDB `meta` store (key `posCatalog:<scope>`), used for product search
 * and barcode lookup while the API is unreachable. Cleared on logout with the
 * rest of `meta`.
 *
 * Stock shown offline = snapshot stock − quantities of POS sales that are
 * queued (not yet synced) or synced after the snapshot was taken.
 */
import { metaGet, metaSet } from './db';
import type { OutboxEntry } from './outbox';

export interface PosCatalogVariant {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  colorHex: string | null;
  price: number;
  stock: number;
}

export interface PosCatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  variants: PosCatalogVariant[];
}

export interface PosCatalogSnapshot {
  scope: string;
  /** Epoch ms when this device fetched it. */
  savedAt: number;
  generatedAt: string | null;
  truncated: boolean;
  products: PosCatalogProduct[];
}

/** Refresh the snapshot when it is older than this (and on every POS open while online). */
export const POS_CATALOG_REFRESH_MS = 15 * 60_000;

const key = (scope: string) => `posCatalog:${scope}`;

export async function loadPosCatalog(scope: string | null): Promise<PosCatalogSnapshot | null> {
  if (!scope) return null;
  const snap = await metaGet<PosCatalogSnapshot>(key(scope));
  return snap && snap.scope === scope && Array.isArray(snap.products) ? snap : null;
}

export async function savePosCatalog(
  scope: string | null,
  data: { generatedAt?: string; truncated?: boolean; products?: unknown[] } | null | undefined,
): Promise<PosCatalogSnapshot | null> {
  if (!scope || !data || !Array.isArray(data.products)) return null;
  const snap: PosCatalogSnapshot = {
    scope,
    savedAt: Date.now(),
    generatedAt: data.generatedAt ?? null,
    truncated: !!data.truncated,
    products: data.products as PosCatalogProduct[],
  };
  await metaSet(key(scope), snap);
  return snap;
}

/**
 * Units per variant taken by POS sales the snapshot doesn't reflect yet:
 * entries still queued, plus entries that synced after `snapshotSavedAt`.
 */
export function queuedSaleQuantities(entries: OutboxEntry[], snapshotSavedAt: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'pos.sale') continue;
    if (e.status === 'done' && (e.doneAt ?? 0) <= snapshotSavedAt) continue;
    const items = Array.isArray(e.body.items) ? (e.body.items as { variantId?: unknown; quantity?: unknown }[]) : [];
    for (const it of items) {
      if (typeof it.variantId !== 'string') continue;
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q <= 0) continue;
      out.set(it.variantId, (out.get(it.variantId) ?? 0) + q);
    }
  }
  return out;
}

export function applyQueuedSales(products: PosCatalogProduct[], taken: Map<string, number>): PosCatalogProduct[] {
  if (taken.size === 0) return products;
  return products.map((p) => {
    if (!p.variants.some((v) => taken.has(v.id))) return p;
    return {
      ...p,
      variants: p.variants.map((v) => (taken.has(v.id) ? { ...v, stock: Math.max(0, v.stock - (taken.get(v.id) ?? 0)) } : v)),
    };
  });
}

/** Case-insensitive name / SKU / barcode match (product or variant), like the server search. */
export function searchPosCatalog(products: PosCatalogProduct[], query: string, limit = 20): PosCatalogProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q);
  const out: PosCatalogProduct[] = [];
  for (const p of products) {
    if (has(p.name) || has(p.sku) || p.variants.some((v) => has(v.sku) || has(v.barcode))) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Exact barcode match (case-insensitive, trimmed). */
export function findPosCatalogBarcode(
  products: PosCatalogProduct[],
  code: string,
): { product: PosCatalogProduct; variant: PosCatalogVariant } | null {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  for (const p of products) {
    for (const v of p.variants) {
      if (v.barcode && v.barcode.trim().toLowerCase() === c) return { product: p, variant: v };
    }
  }
  return null;
}

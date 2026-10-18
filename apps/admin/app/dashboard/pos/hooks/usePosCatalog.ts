'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import adminApi from '@/lib/api';
import { listOutbox, subscribe as subscribeOutbox, type OutboxEntry } from '@/lib/offline/outbox';
import { currentSyncScope } from '@/lib/offline/sync-engine';
import {
  applyQueuedSales,
  findPosCatalogBarcode,
  loadPosCatalog,
  POS_CATALOG_REFRESH_MS,
  queuedSaleQuantities,
  savePosCatalog,
  searchPosCatalog,
  type PosCatalogProduct,
  type PosCatalogSnapshot,
  type PosCatalogVariant,
} from '@/lib/offline/pos-catalog';

export interface PosCatalogApi {
  /** Products with stock reduced by queued (unsynced) sales. */
  products: PosCatalogProduct[];
  /** Epoch ms the snapshot was fetched, or null when this device has none. */
  updatedAt: number | null;
  truncated: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  search: (q: string) => PosCatalogProduct[];
  lookupBarcode: (code: string) => { product: PosCatalogProduct; variant: PosCatalogVariant } | null;
}

/**
 * Local POS catalog for offline search/barcode. Loads the device snapshot on
 * mount, refreshes from `GET /pos/catalog` whenever POS opens online, when the
 * connection comes back, and every 15 min while online.
 */
export function usePosCatalog(online: boolean): PosCatalogApi {
  const [snapshot, setSnapshot] = useState<PosCatalogSnapshot | null>(null);
  const [saleEntries, setSaleEntries] = useState<OutboxEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const scope = currentSyncScope();
    if (!scope) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const data = await adminApi.posGetCatalog();
      const saved = await savePosCatalog(scope, data);
      lastFetchAt.current = Date.now();
      if (saved) setSnapshot(saved);
    } catch {
      // Offline / server error — keep the snapshot we have.
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  // Device snapshot first (instant, works offline).
  useEffect(() => {
    let cancelled = false;
    void loadPosCatalog(currentSyncScope()).then((snap) => {
      if (!cancelled && snap) setSnapshot((cur) => cur ?? snap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh on open / reconnect, then every 15 min while online.
  useEffect(() => {
    if (!online) return;
    if (Date.now() - lastFetchAt.current > 30_000) void refresh();
    const t = setInterval(() => void refresh(), POS_CATALOG_REFRESH_MS);
    return () => clearInterval(t);
  }, [online, refresh]);

  // Queued sales reduce local stock.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const scope = currentSyncScope();
      if (!scope) return;
      void listOutbox(scope).then((all) => {
        if (!cancelled) setSaleEntries(all.filter((e) => e.kind === 'pos.sale'));
      });
    };
    load();
    const unsub = subscribeOutbox(load);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const products = useMemo(() => {
    if (!snapshot) return [];
    return applyQueuedSales(snapshot.products, queuedSaleQuantities(saleEntries, snapshot.savedAt));
  }, [snapshot, saleEntries]);

  const search = useCallback((q: string) => searchPosCatalog(products, q), [products]);
  const lookupBarcode = useCallback((code: string) => findPosCatalogBarcode(products, code), [products]);

  return {
    products,
    updatedAt: snapshot?.savedAt ?? null,
    truncated: snapshot?.truncated ?? false,
    refreshing,
    refresh,
    search,
    lookupBarcode,
  };
}

'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import adminApi from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  checkNow,
  configureRemoteChanges,
  getServerSnapshot,
  getSnapshot,
  markPageLoad,
  refresh,
  startSyncStore,
  subscribe,
  type SyncChangesResponse,
  type SyncSnapshot,
} from '@/lib/offline/sync-store';
import { resumeSync, startSyncEngine, syncNow, type SyncRunSummary } from '@/lib/offline/sync-engine';

interface SyncActions {
  /** Reload the current page's data. */
  refresh: () => void;
  /** Probe the server now and look for newer data / queue changes. */
  checkNow: () => Promise<void>;
  /** Push queued offline changes now (the engine also runs on its own). */
  syncNow: () => Promise<SyncRunSummary>;
}

const FALLBACK_ACTIONS: SyncActions = { refresh, checkNow, syncNow };
const SyncActionsContext = createContext<SyncActions>(FALLBACK_ACTIONS);

/**
 * Starts the connectivity/sync store and wires it to auth + routing.
 * Must sit inside AuthProvider (needs the user to decide on remote polling).
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, isPlatformAdmin } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    startSyncStore();
    startSyncEngine();
  }, []);

  // A (re)signed-in user: lift a "sign in again" pause and replay their queue.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId) resumeSync();
  }, [userId]);

  // Poll /sync/changes only for tenant admins (platform admins have no tenant data feed).
  const tenantAdmin = !!user && !isPlatformAdmin;
  useEffect(() => {
    configureRemoteChanges(
      tenantAdmin
        ? (since: string) => adminApi.get<SyncChangesResponse>('/sync/changes', { params: { since } })
        : null,
      tenantAdmin,
    );
  }, [tenantAdmin]);

  // Each route change reloads that page's data: reset "showing cached data"
  // and the "newer data online" baseline. Skip the very first run — the store
  // already set the baseline at start-up, and the first page's cache hits may
  // have been recorded by now.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    markPageLoad();
  }, [pathname]);

  return <SyncActionsContext.Provider value={FALLBACK_ACTIONS}>{children}</SyncActionsContext.Provider>;
}

export type SyncStatus = SyncSnapshot & SyncActions;

/** Live connectivity + sync status. Safe during SSR (reports "online"). */
export function useSyncStatus(): SyncStatus {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const actions = useContext(SyncActionsContext);
  return useMemo(() => ({ ...snap, ...actions }), [snap, actions]);
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribe } from './outbox';

/**
 * A number that changes whenever the offline outbox changes (a change was
 * queued, synced, failed, discarded… — in this tab or another one). Add it to
 * a page's fetch-effect dependencies so lists re-read and the pending overlay
 * (lib/offline/pending-overlay.ts) stays current: queued rows appear right
 * away and turn into server rows once they sync.
 *
 * Bursts (a sync run touching many entries) are coalesced into one bump.
 */
export function useOutboxVersion(debounceMs = 300): number {
  const [version, setVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setVersion((v) => v + 1);
      }, debounceMs);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [debounceMs]);

  return version;
}

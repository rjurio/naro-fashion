'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudOff, X } from 'lucide-react';
import { useSyncStatus } from '@/contexts/SyncContext';
import { useToast } from '@/contexts/ToastContext';
import { formatClock } from './SyncStatusBadge';

const DISMISS_KEY = 'naro-offline-banner-dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Thin bar under the TopBar while offline:
 * "You're offline — showing data from HH:MM. Editing is disabled until you're back online."
 * Dismissible for the rest of the tab session. Also fires one toast when the
 * connection drops and one when it comes back (must sit inside ToastProvider).
 */
export default function OfflineBanner() {
  const s = useSyncStatus();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const prevOnline = useRef<boolean | null>(null);

  useEffect(() => {
    setMounted(true);
    setDismissed(readDismissed());
  }, []);

  // One toast per transition (skip the initial value).
  useEffect(() => {
    if (!mounted) return;
    if (prevOnline.current === null) {
      prevOnline.current = s.online;
      return;
    }
    if (prevOnline.current === s.online) return;
    prevOnline.current = s.online;
    if (s.online) toast.success("You're back online.");
    else toast.warning("You're offline. Showing data saved on this device; POS sales are saved here and sync automatically.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.online, mounted]);

  if (!mounted || s.online || dismissed) return null;

  const since = s.showingCachedSince ?? s.lastSyncAt;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-1.5 text-xs text-[hsl(var(--foreground))] lg:px-6"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        You&apos;re offline{since ? ` — showing data from ${formatClock(since)}` : ''}. Changes that work offline are saved on
        this device and sync automatically; others need internet.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 hover:bg-[hsl(var(--accent))]"
        aria-label="Dismiss offline notice"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

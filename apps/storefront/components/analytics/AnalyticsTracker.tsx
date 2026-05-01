'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const SESSION_COOKIE = 'naro_sid';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min sliding session

// Generate a short opaque session ID. crypto.randomUUID is available in modern
// browsers (and our target market — modern Chrome/Safari on phones).
function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').substring(0, 24);
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getOrCreateSessionId(): string {
  if (typeof document === 'undefined') return '';
  // Cookie format: "naro_sid=<id>|<lastSeenMs>"
  const match = document.cookie.match(/(?:^|;\s*)naro_sid=([^;]+)/);
  if (match) {
    const [id, lastSeenStr] = decodeURIComponent(match[1]).split('|');
    const lastSeen = Number(lastSeenStr || 0);
    if (id && Date.now() - lastSeen < SESSION_TTL_MS) {
      // Refresh the timestamp (sliding session)
      document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(`${id}|${Date.now()}`)};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
      return id;
    }
  }
  const id = newSessionId();
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(`${id}|${Date.now()}`)};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
  return id;
}

function getTenantIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)tenantId=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fires a /analytics/track beacon on every route change.
 *
 * Uses navigator.sendBeacon when available (doesn't block navigation, survives
 * page unload). Falls back to fetch with keepalive. Failures are silent — we
 * never want a tracking error to surface to a customer.
 *
 * Storefront opt-out is handled at the React level via the `enabled` prop —
 * when the master toggle is off, this component renders null and no beacon
 * fires. Honors `navigator.doNotTrack` regardless.
 */
export default function AnalyticsTracker({ enabled = true }: { enabled?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    // Honor browser-level Do Not Track
    if (navigator.doNotTrack === '1' || (window as any).doNotTrack === '1') return;

    const tenantId = getTenantIdFromCookie();
    if (!tenantId) return; // no tenant resolved, skip silently

    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    // Dedupe rapid double-fires of the same path (StrictMode, prefetches, etc.)
    const key = `${pathname}?${searchParams?.toString() || ''}`;
    if (lastTrackedRef.current === key) return;
    lastTrackedRef.current = key;

    const payload = {
      sessionId,
      path: pathname,
      referrer: document.referrer || null,
    };

    const url = `${API_BASE_URL}/analytics/track`;
    const body = JSON.stringify(payload);

    try {
      // sendBeacon CAN'T set custom headers — but the API reads X-Tenant-Id from cookies via middleware
      // which won't fire on a Beacon. So we use fetch keepalive with explicit headers when possible.
      const useFetch = typeof fetch === 'function';
      if (useFetch) {
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': tenantId,
          },
          body,
          keepalive: true,
          // Never block; never fail loudly.
        }).catch(() => {});
      } else if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      }
    } catch {
      // Tracking must never throw into the user's experience.
    }
  }, [pathname, searchParams, enabled]);

  return null;
}

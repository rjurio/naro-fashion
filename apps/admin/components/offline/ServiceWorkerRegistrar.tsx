'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Registers /sw.js (offline shell). Enabled in production builds, or anywhere
 * with NEXT_PUBLIC_ENABLE_SW=true (test locally with `next build && next start`
 * — dev chunks aren't content-hashed, so cache-first would serve stale code).
 * NEXT_PUBLIC_ENABLE_SW=false is a kill switch: existing registrations are
 * removed. Both are read at build time.
 *
 * After sign-in, while online, it asks the worker to pre-cache the main
 * dashboard routes (once per tab session) so they open offline even if the
 * operator never visited them on this device.
 */
const SW_FLAG = process.env.NEXT_PUBLIC_ENABLE_SW;
const SW_ENABLED = SW_FLAG === 'true' || (process.env.NODE_ENV === 'production' && SW_FLAG !== 'false');
const SW_URL = '/sw.js';
const WARMED_KEY = 'naro-sw-warmed-v1';

const TENANT_WARM_ROUTES = [
  '/dashboard',
  '/dashboard/products',
  '/dashboard/categories',
  '/dashboard/orders',
  '/dashboard/rentals',
  '/dashboard/inventory',
  '/dashboard/financials',
  '/dashboard/pos',
  '/dashboard/customers',
  '/offline',
];
const PLATFORM_WARM_ROUTES = ['/platform', '/platform/tenants', '/platform/payments', '/platform/plans', '/offline'];

function readFlag(): boolean {
  try {
    return window.sessionStorage.getItem(WARMED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag() {
  try {
    window.sessionStorage.setItem(WARMED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export default function ServiceWorkerRegistrar() {
  const { user, isPlatformAdmin } = useAuth();

  // Register (or unregister when disabled).
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!SW_ENABLED) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) =>
          regs.forEach((r) => {
            const script = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || '';
            if (script.endsWith(SW_URL)) void r.unregister();
          }),
        )
        .catch(() => undefined);
      return;
    }
    const register = () => {
      navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch((err) => {
        console.warn('[offline] service worker registration failed', err);
      });
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  // Warm the main routes after sign-in (low priority, online only, once per session).
  const signedIn = !!user;
  useEffect(() => {
    if (!SW_ENABLED || !signedIn || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (readFlag()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || !navigator.onLine) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const worker = reg.active;
        if (!worker || cancelled) return;
        worker.postMessage({ type: 'WARM', urls: isPlatformAdmin ? PLATFORM_WARM_ROUTES : TENANT_WARM_ROUTES });
        writeFlag();
      } catch {
        /* ignore */
      }
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signedIn, isPlatformAdmin]);

  return null;
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CloudOff, RefreshCw } from 'lucide-react';

/**
 * Fallback the service worker serves for a navigation that isn't cached on
 * this device while offline. Pre-cached at worker install + on route warm-up.
 */
export default function OfflinePage() {
  const [retrying, setRetrying] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-gold/10">
          <CloudOff className="h-7 w-7 text-brand-gold" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          This page hasn&apos;t been saved on this device yet. Pages you have opened before still work offline with the
          data saved on this device. Changes need an internet connection.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              window.location.reload();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
          >
            Go to dashboard
          </Link>
        </div>
        <p className="mt-6 text-xs font-semibold tracking-widest text-brand-gold">NARO FASHION ADMIN</p>
      </div>
    </main>
  );
}

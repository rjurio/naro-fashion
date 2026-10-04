'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import NavigationProgress from '@/components/ui/NavigationProgress';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, isLoading, connectionError, retrySession } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // A transient API outage keeps the stored tokens — don't bounce to /login.
    if (!isLoading && !user && !connectionError) {
      router.replace('/login');
    }
  }, [isLoading, user, connectionError, router]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <RefreshCw className="w-8 h-8 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (!user && connectionError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-[hsl(var(--background))]">
        <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-md">{connectionError}</p>
        <button
          type="button"
          onClick={() => retrySession()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onMenuClick={() => setSidebarOpen(true)} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              {children}
            </main>
          </div>
        </div>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}

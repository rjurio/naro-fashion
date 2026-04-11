'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import NavigationProgress from '@/components/ui/NavigationProgress';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { useState } from 'react';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isPlatformAdmin } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && (!user || !isPlatformAdmin)) {
      router.push('/platform-login');
    }
  }, [user, isLoading, isPlatformAdmin, router]);

  if (isLoading || !user || !isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <div className="flex h-screen overflow-hidden bg-[hsl(var(--content-bg))]">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}

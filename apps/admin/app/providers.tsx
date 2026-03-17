'use client';

import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/contexts/AuthContext';
import { SiteSettingsProvider } from '@/contexts/SiteSettingsContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={['light', 'dark', 'luxury']}
      enableSystem={false}
    >
      <SiteSettingsProvider>
        <AuthProvider>{children}</AuthProvider>
      </SiteSettingsProvider>
    </ThemeProvider>
  );
}

'use client';

import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/contexts/AuthContext';
import { SiteSettingsProvider } from '@/contexts/SiteSettingsContext';

export default function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /** Per-request CSP nonce (from middleware via app/layout.tsx) for next-themes' inline script. */
  nonce?: string;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={['light', 'dark', 'luxury']}
      enableSystem={false}
      nonce={nonce}
    >
      <SiteSettingsProvider>
        <AuthProvider>{children}</AuthProvider>
      </SiteSettingsProvider>
    </ThemeProvider>
  );
}

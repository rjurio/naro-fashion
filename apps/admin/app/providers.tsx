'use client';

import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/contexts/AuthContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={['light', 'dark', 'luxury']}
      enableSystem={false}
    >
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}

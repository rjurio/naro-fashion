export const dynamic = "force-dynamic";
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import Providers from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Naro Fashion Admin',
  description: 'Admin dashboard for Naro Fashion ecommerce platform',
  icons: {
    icon: '/favicon.jpg',
    apple: '/icon.jpg',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request CSP nonce from middleware.ts. Next stamps its own framework
  // scripts automatically (reads the request's Content-Security-Policy header).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Auto-detect device theme on first visit. Runs before React hydration to prevent flash. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';localStorage.setItem('theme',t);}document.documentElement.classList.remove('light','dark','luxury');document.documentElement.classList.add(t);}catch(e){}})();` }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}

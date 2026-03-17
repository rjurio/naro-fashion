import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, Playfair_Display } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import { SiteSettingsProvider } from "@/contexts/SiteSettingsContext";
import { getBusinessProfile } from "@/lib/settings-server";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import WhatsAppButton from "@/components/ui/WhatsAppButton";
import NavigationProgress from "@/components/ui/NavigationProgress";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const bp = await getBusinessProfile();
  const title = `${bp.businessName} | ${bp.tagline}`;

  return {
    title,
    description: `Discover the latest fashion trends at ${bp.businessName}. Shop premium clothing, accessories, and rent designer gowns in Tanzania. Fast delivery, flash sales, and exclusive deals.`,
    keywords: [
      "fashion",
      "clothing",
      "Tanzania",
      "online shopping",
      "gown rental",
      "flash sales",
      bp.businessName,
      "Dar es Salaam",
    ],
    icons: {
      icon: '/favicon.jpg',
      apple: '/icon.jpg',
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: bp.businessName,
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
    openGraph: {
      title,
      description: `Shop premium fashion, rent designer gowns, and grab flash sale deals at ${bp.businessName}.`,
      type: "website",
      locale: "en_TZ",
      siteName: bp.businessName,
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${playfair.variable}`}
    >
      <body className="font-sans min-h-screen flex flex-col">
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="light"
          themes={["light", "dark", "standard"]}
          enableSystem={false}
        >
          <I18nProvider>
            <SiteSettingsProvider>
            <AuthProvider>
              <Suspense fallback={null}>
                <NavigationProgress />
              </Suspense>
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
              <WhatsAppButton />
            </AuthProvider>
            </SiteSettingsProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

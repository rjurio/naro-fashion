import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/lib/i18n";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
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

export const metadata: Metadata = {
  title: "Naro Fashion | Premium Fashion & Clothing in Tanzania",
  description:
    "Discover the latest fashion trends at Naro Fashion. Shop premium clothing, accessories, and rent designer gowns in Tanzania. Fast delivery, flash sales, and exclusive deals.",
  keywords: [
    "fashion",
    "clothing",
    "Tanzania",
    "online shopping",
    "gown rental",
    "flash sales",
    "Naro Fashion",
    "Dar es Salaam",
  ],
  icons: {
    icon: '/favicon.jpg',
    apple: '/icon.jpg',
  },
  openGraph: {
    title: "Naro Fashion | Premium Fashion & Clothing in Tanzania",
    description:
      "Shop premium fashion, rent designer gowns, and grab flash sale deals at Naro Fashion.",
    type: "website",
    locale: "en_TZ",
    siteName: "Naro Fashion",
  },
};

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
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  ShoppingBag,
  Heart,
  User,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ui/ThemeToggle";
import MobileMenu from "./MobileMenu";
import { useTranslation } from "@/lib/i18n";

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { t, locale, setLocale } = useTranslation();
  const cartCount = 0;

  const navItems = [
    { name: t('common.home'), href: '/' },
    { name: t('common.shop'), href: '/shop' },
    { name: t('common.categories'), href: '/categories' },
    { name: t('common.rentals'), href: '/rentals' },
    { name: t('common.flashSales'), href: '/flash-sales' },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        {/* Top bar - promo */}
        <div className="bg-gradient-to-r from-dark-800 to-dark-900 text-white text-center text-xs sm:text-sm py-1.5 px-4">
          <p>
            {t('header.promo')}{" "}
            <span className="font-bold">{t('header.promoCode')}</span>
          </p>
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 sm:h-16 items-center justify-between gap-4">
            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <Image src="/icon.jpg" alt="Naro Fashion" width={32} height={32} className="rounded-full" />
              <span className="text-xl sm:text-2xl font-heading font-bold">
                <span className="text-dark-500">NARO</span>
                <span className="text-gold-500"> FASHION</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm font-medium text-foreground/80 transition-colors hover:text-gold-500 hover:bg-muted",
                    item.href === "/flash-sales" &&
                      "text-gold-500 font-semibold",
                  )}
                >
                  {item.name}
                  {item.href === "/flash-sales" && (
                    <span className="ml-1 inline-block h-2 w-2 rounded-full bg-gold-500 animate-flash-pulse" />
                  )}
                </Link>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Search (Desktop) */}
              <div className="hidden md:flex items-center">
                {isSearchOpen ? (
                  <div className="flex items-center bg-muted rounded-lg px-3 py-1.5 animate-slide-in-right">
                    <Search className="h-4 w-4 text-muted-foreground mr-2" />
                    <input
                      type="text"
                      placeholder={t('header.searchPlaceholder')}
                      className="bg-transparent text-sm outline-none w-40 lg:w-56 placeholder:text-muted-foreground"
                      autoFocus
                      onBlur={() => setIsSearchOpen(false)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                    aria-label="Search"
                  >
                    <Search className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Search (Mobile) */}
              <button
                className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label="Search"
              >
                <Search className="h-5 w-5" />
              </button>

              {/* Theme Toggle */}
              <ThemeToggle />

              {/* Language Switcher */}
              <button
                onClick={() => setLocale(locale === 'en' ? 'sw' : 'en')}
                className="hidden sm:flex items-center justify-center h-10 px-2.5 rounded-lg text-xs font-bold hover:bg-muted transition-colors border border-border"
                aria-label={`Switch to ${locale === 'en' ? 'Swahili' : 'English'}`}
              >
                {locale === 'en' ? 'EN' : 'SW'}
              </button>

              {/* Wishlist */}
              <Link
                href="/wishlist"
                className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label="Wishlist"
              >
                <Heart className="h-5 w-5" />
              </Link>

              {/* Account */}
              <Link
                href="/account"
                className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label="Account"
              >
                <User className="h-5 w-5" />
              </Link>

              {/* Cart */}
              <Link
                href="/cart"
                className="relative flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label="Cart"
              >
                <ShoppingBag className="h-5 w-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-[10px] font-bold text-white">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        navigation={navItems}
      />
    </>
  );
}

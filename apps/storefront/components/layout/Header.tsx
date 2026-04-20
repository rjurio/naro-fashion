"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  ShoppingBag,
  Heart,
  User,
  Menu,
  LogOut,
  Package,
  Settings,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ui/ThemeToggle";
import MobileMenu from "./MobileMenu";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { cartApi, categoriesApi, productsApi, flashSalesApi, eventsApi } from "@/lib/api";

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const { t, locale, setLocale } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const { settings } = useSiteSettings();
  const router = useRouter();
  const pathname = usePathname();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Track which content-dependent nav links have data
  const [hasCategories, setHasCategories] = useState(false);
  const [hasRentals, setHasRentals] = useState(false);
  const [hasFlashSales, setHasFlashSales] = useState(false);
  const [hasEvents, setHasEvents] = useState(false);

  // Cart count: refresh on route change (Header doesn't unmount between pages,
  // so a single mount-time fetch goes stale the moment the user adds an item)
  // and on a custom "cart:updated" window event for instant same-page updates
  // after add-to-cart elsewhere in the app.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setCartCount(0);
        return;
      }
      cartApi.get()
        .then((cart) => setCartCount((cart?.items ?? []).length))
        .catch(() => {});
    };
    refresh();
    window.addEventListener("cart:updated", refresh);
    return () => window.removeEventListener("cart:updated", refresh);
  }, [pathname]);

  // Nav visibility checks (one-shot — content catalog doesn't change per-route)
  useEffect(() => {
    categoriesApi.getAll()
      .then((cats) => setHasCategories(Array.isArray(cats) && cats.length > 0))
      .catch(() => {});
    productsApi.getAll({ availability_mode: 'RENTAL_ONLY,BOTH', limit: 1 })
      .then((res) => setHasRentals((res?.data?.length ?? 0) > 0))
      .catch(() => {});
    flashSalesApi.getActive()
      .then((sales) => setHasFlashSales(Array.isArray(sales) && sales.length > 0))
      .catch(() => {});
    eventsApi.getAll({ limit: 1 })
      .then((res) => setHasEvents((res?.data?.length ?? 0) > 0))
      .catch(() => {});
  }, []);

  // Close user menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    if (isUserMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      setIsSearchOpen(false);
      router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  const handleMobileSearch = () => {
    setIsSearchOpen(true);
  };

  const userInitials = user
    ? `${(user.firstName?.[0] || "").toUpperCase()}${(user.lastName?.[0] || "").toUpperCase()}`
    : "";

  const navItems = [
    { name: t('common.home'), href: '/', show: true },
    { name: t('common.shop'), href: '/shop', show: true },
    { name: t('common.categories'), href: '/categories', show: hasCategories },
    { name: t('common.rentals'), href: '/rentals', show: hasRentals },
    { name: t('common.flashSales'), href: '/flash-sales', show: hasFlashSales },
    { name: t('header.realWeddings'), href: '/events', show: hasEvents },
  ].filter((item) => item.show);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 sm:h-16 items-center justify-between gap-4">
            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
              aria-label={t('header.openMenu')}
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <Image src={settings.iconUrl} alt={settings.businessName} width={32} height={32} className="rounded-full" unoptimized />
              <span className="text-xl sm:text-2xl font-heading font-bold text-gold-500">
                {settings.businessName.toUpperCase()}
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:text-gold-500 hover:bg-muted",
                      isActive
                        ? "text-gold-500 font-semibold"
                        : "text-foreground/80",
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* Right Actions */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Search (Desktop) */}
              <div className="hidden md:flex items-center">
                {isSearchOpen ? (
                  <div className="flex items-center bg-muted rounded-lg px-3 py-1.5 animate-slide-in-right">
                    <Search className="h-4 w-4 text-muted-foreground mr-2" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearch}
                      placeholder={t('header.searchPlaceholder')}
                      className="bg-transparent text-sm outline-none w-40 lg:w-56 placeholder:text-muted-foreground"
                      autoFocus
                      onBlur={() => {
                        if (!searchQuery.trim()) setIsSearchOpen(false);
                      }}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted active:scale-95 transition-all"
                    aria-label={t('header.search')}
                  >
                    <Search className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Search (Mobile) */}
              <button
                onClick={handleMobileSearch}
                className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label={t('header.search')}
              >
                <Search className="h-5 w-5" />
              </button>

              {/* Theme Toggle */}
              <ThemeToggle />

              {/* Language Switcher */}
              <button
                onClick={() => setLocale(locale === 'en' ? 'sw' : 'en')}
                className="hidden sm:flex items-center justify-center h-10 px-2.5 rounded-lg text-xs font-bold hover:bg-muted transition-colors border border-border"
                aria-label={locale === 'en' ? t('header.switchToSwahili') : t('header.switchToEnglish')}
              >
                {locale === 'en' ? 'SW' : 'EN'}
              </button>

              {/* Wishlist */}
              <Link
                href="/account/wishlist"
                className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label={t('header.wishlist')}
              >
                <Heart className="h-5 w-5" />
              </Link>

              {/* Account / User Menu */}
              {isAuthenticated && user ? (
                <div className="relative hidden sm:block" ref={userMenuRef}>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-1.5 h-10 px-2 rounded-lg hover:bg-muted transition-colors"
                    aria-label={t('header.userMenu')}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-white text-xs font-bold">
                      {userInitials || <User className="h-3.5 w-3.5" />}
                    </div>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isUserMenuOpen && "rotate-180")} />
                  </button>

                  {/* Dropdown Menu */}
                  {isUserMenuOpen && (
                    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card shadow-lg py-1 z-50">
                      {/* User info */}
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm font-medium text-foreground truncate">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email}
                        </p>
                      </div>

                      {/* Menu Items */}
                      <div className="py-1">
                        {[
                          { href: "/account", icon: User, label: t("account.dashboard") },
                          { href: "/account/orders", icon: Package, label: t("account.myOrders") },
                          { href: "/account/rentals", icon: Sparkles, label: t("account.myRentals") },
                          { href: "/account/wishlist", icon: Heart, label: t("account.myWishlist") },
                          { href: "/account/settings", icon: Settings, label: t("account.settings") },
                        ].map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted hover:text-gold-500 transition-colors"
                          >
                            <item.icon className="h-4 w-4" />
                            {item.label}
                          </Link>
                        ))}
                      </div>

                      {/* Logout */}
                      <div className="border-t border-border py-1">
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            logout();
                          }}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-muted w-full transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                          {t("account.logout")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/auth/login"
                  className="hidden sm:flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                  aria-label={t('header.signIn')}
                >
                  <User className="h-5 w-5" />
                </Link>
              )}

              {/* Cart */}
              <Link
                href="/cart"
                className="relative flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                aria-label={t('header.cart')}
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

"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  X,
  Home,
  ShoppingBag,
  Grid3X3,
  Sparkles,
  Zap,
  Heart,
  User,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  navigation: { name: string; href: string }[];
}

const navIcons: Record<string, React.ReactNode> = {
  "/": <Home className="h-5 w-5" />,
  "/shop": <ShoppingBag className="h-5 w-5" />,
  "/categories": <Grid3X3 className="h-5 w-5" />,
  "/rentals": <Sparkles className="h-5 w-5" />,
  "/flash-sales": <Zap className="h-5 w-5" />,
};

export default function MobileMenu({
  isOpen,
  onClose,
  navigation,
}: MobileMenuProps) {
  const { t, locale, setLocale } = useTranslation();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-dark-500/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in Panel */}
      <div
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-[300px] max-w-[85vw] bg-card shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="text-lg font-heading font-bold">
            <span className="text-dark-500">NARO</span>
            <span className="text-gold-500"> FASHION</span>
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col p-4 gap-1">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500",
                item.href === "/flash-sales" && "text-gold-500",
              )}
            >
              {navIcons[item.href] || <ShoppingBag className="h-5 w-5" />}
              {item.name}
              {item.href === "/flash-sales" && (
                <span className="ml-auto inline-block h-2 w-2 rounded-full bg-gold-500 animate-flash-pulse" />
              )}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border mx-4" />

        {/* Secondary Links */}
        <div className="flex flex-col p-4 gap-1">
          <Link
            href="/wishlist"
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
          >
            <Heart className="h-5 w-5" />
            {t('common.wishlist')}
          </Link>
          <Link
            href="/account"
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
          >
            <User className="h-5 w-5" />
            {t('common.account')}
          </Link>
          <Link
            href="/account/settings"
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
          >
            <Settings className="h-5 w-5" />
            {t('account.settings')}
          </Link>
        </div>

        {/* Language Toggle */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
          <div className="flex gap-2">
            <button
              onClick={() => setLocale('en')}
              className={cn(
                "flex-1 py-2 rounded-lg text-sm font-semibold transition-colors",
                locale === 'en'
                  ? "bg-gold-500 text-white"
                  : "border border-border hover:bg-muted",
              )}
            >
              English
            </button>
            <button
              onClick={() => setLocale('sw')}
              className={cn(
                "flex-1 py-2 rounded-lg text-sm font-semibold transition-colors",
                locale === 'sw'
                  ? "bg-gold-500 text-white"
                  : "border border-border hover:bg-muted",
              )}
            >
              Kiswahili
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

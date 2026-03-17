"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
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
  LogOut,
  LogIn,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";

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
  const { user, isAuthenticated, logout } = useAuth();
  const { settings } = useSiteSettings();

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
          "fixed top-0 left-0 z-50 h-full w-[300px] max-w-[85vw] bg-card shadow-2xl transition-transform duration-300 ease-out lg:hidden flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="flex items-center gap-2 text-lg font-heading font-bold">
            <Image src={settings.iconUrl} alt={settings.businessName} width={28} height={28} className="rounded-full" unoptimized />
            <span className="text-gold-500">{settings.businessName.toUpperCase()}</span>
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* User Section */}
        {isAuthenticated && user ? (
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 text-white text-sm font-bold shrink-0">
                {(user.firstName?.[0] || "").toUpperCase()}{(user.lastName?.[0] || "").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-border">
            <div className="flex gap-2">
              <Link
                href="/auth/login"
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gold-500 text-white text-sm font-semibold hover:bg-gold-600 transition-colors"
              >
                <LogIn className="h-4 w-4" />
                {t("auth.login")}
              </Link>
              <Link
                href="/auth/register"
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                {t("auth.register")}
              </Link>
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="flex flex-col p-4 gap-1 flex-1 overflow-y-auto">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
            >
              {navIcons[item.href] || <ShoppingBag className="h-5 w-5" />}
              {item.name}
            </Link>
          ))}

          <div className="border-t border-border my-2" />

          {/* Secondary Links */}
          <Link
            href="/wishlist"
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
          >
            <Heart className="h-5 w-5" />
            {t('common.wishlist')}
          </Link>

          {isAuthenticated ? (
            <>
              <Link
                href="/account"
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
              >
                <User className="h-5 w-5" />
                {t('account.dashboard')}
              </Link>
              <Link
                href="/account/settings"
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
              >
                <Settings className="h-5 w-5" />
                {t('account.settings')}
              </Link>

              <div className="border-t border-border my-2" />

              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-muted w-full text-left"
              >
                <LogOut className="h-5 w-5" />
                {t('account.logout')}
              </button>
            </>
          ) : (
            <Link
              href="/auth/login"
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-gold-500"
            >
              <User className="h-5 w-5" />
              {t('common.account')}
            </Link>
          )}
        </nav>

        {/* Language Toggle */}
        <div className="p-4 border-t border-border">
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

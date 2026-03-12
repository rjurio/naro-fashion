'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import {
  Menu,
  Search,
  Bell,
  Sun,
  Moon,
  Sparkles,
  ChevronDown,
  LogOut,
  User,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface TopBarProps {
  onMenuClick: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export default function TopBar({ onMenuClick }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'luxury', label: 'Luxury', icon: Sparkles },
  ];

  const notifications = [
    { id: 1, title: 'New order #NF-1042', message: 'A new order of TZS 185,000 has been placed', time: '5 min ago', unread: true },
    { id: 2, title: 'Rental return overdue', message: 'Customer Amina has not returned "Gold Beaded Gown"', time: '1 hour ago', unread: true },
    { id: 3, title: 'Low stock alert', message: 'Pink Silk Blouse has only 2 items left', time: '3 hours ago', unread: false },
  ];

  const unreadCount = notifications.filter((n) => n.unread).length;

  const fullName = user ? `${user.firstName} ${user.lastName}` : 'Loading...';
  const initials = user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : '?';
  const roleLabel = user ? (ROLE_LABELS[user.role] || user.role) : '';

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 lg:px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/80 backdrop-blur-md">
      {/* Left */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="hidden sm:flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 w-72">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search orders, products, customers..."
            className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
          />
          <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-[hsl(var(--muted-foreground))] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded">
            /
          </kbd>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <div className="relative">
          <button
            onClick={() => {
              setShowThemeMenu(!showThemeMenu);
              setShowNotifications(false);
              setShowUserMenu(false);
            }}
            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] transition-colors"
            title="Change theme"
          >
            {!mounted ? (
              <Sun className="w-5 h-5" />
            ) : theme === 'dark' ? (
              <Moon className="w-5 h-5" />
            ) : theme === 'luxury' ? (
              <Sparkles className="w-5 h-5 text-brand-gold" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </button>

          {showThemeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowThemeMenu(false)} />
              <div className="absolute right-0 mt-2 w-40 z-50 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg py-1">
                {themes.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => {
                      setTheme(t.value);
                      setShowThemeMenu(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                      theme === t.value
                        ? 'text-brand-gold bg-[hsl(var(--accent))]'
                        : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                    )}
                  >
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowThemeMenu(false);
              setShowUserMenu(false);
            }}
            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-brand-gold text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 mt-2 w-80 z-50 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg">
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Notifications
                  </h3>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={cn(
                        'px-4 py-3 hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer border-b border-[hsl(var(--border))] last:border-0',
                        n.unread && 'bg-[hsl(var(--accent))]'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {n.unread && (
                          <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-gold flex-shrink-0" />
                        )}
                        <div className={cn(!n.unread && 'ml-4')}>
                          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                            {n.title}
                          </p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                            {n.message}
                          </p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                            {n.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 border-t border-[hsl(var(--border))]">
                  <button className="text-sm text-brand-gold hover:text-brand-gold-dark w-full text-center font-medium">
                    View all notifications
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-6 bg-[hsl(var(--border))]" />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowThemeMenu(false);
              setShowNotifications(false);
            }}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-brand-gold flex items-center justify-center">
              <span className="text-white text-sm font-bold">{initials}</span>
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium text-[hsl(var(--foreground))] leading-tight">
                {fullName}
              </p>
              {roleLabel && (
                <p className="text-[11px] text-brand-gold leading-tight">
                  {roleLabel}
                </p>
              )}
            </div>
            <ChevronDown className="hidden sm:block w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 mt-2 w-56 z-50 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg py-1">
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">{fullName}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{user?.email}</p>
                  {roleLabel && (
                    <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-brand-gold/10 text-brand-gold border border-brand-gold/20">
                      {roleLabel}
                    </span>
                  )}
                </div>
                <Link
                  href="/dashboard/profile"
                  onClick={() => setShowUserMenu(false)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                >
                  <User className="w-4 h-4" />
                  Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setShowUserMenu(false)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
                <div className="border-t border-[hsl(var(--border))]" />
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

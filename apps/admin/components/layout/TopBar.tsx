'use client';

import { useState } from 'react';
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

interface TopBarProps {
  onMenuClick: () => void;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

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
            {theme === 'dark' ? (
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
              <span className="text-white text-sm font-bold">N</span>
            </div>
            <span className="hidden sm:block text-sm font-medium text-[hsl(var(--foreground))]">
              Naro Admin
            </span>
            <ChevronDown className="hidden sm:block w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 mt-2 w-48 z-50 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg py-1">
                <div className="px-4 py-2 border-b border-[hsl(var(--border))]">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">Naro Admin</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">admin@narofashion.co.tz</p>
                </div>
                <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                  <User className="w-4 h-4" />
                  Profile
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
                <div className="border-t border-[hsl(var(--border))]" />
                <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
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

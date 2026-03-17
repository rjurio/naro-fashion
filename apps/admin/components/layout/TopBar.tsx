'use client';

import { useState, useEffect, useCallback } from 'react';
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
  ShoppingCart,
  AlertTriangle,
  PackageX,
  CalendarClock,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { adminApi } from '@/lib/api';

interface TopBarProps {
  onMenuClick: () => void;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
  href: string;
  icon: 'order' | 'rental' | 'stock' | 'pickup';
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

const ICON_MAP = {
  order: ShoppingCart,
  rental: AlertTriangle,
  stock: PackageX,
  pickup: CalendarClock,
};

const ICON_COLOR_MAP = {
  order: 'text-brand-gold',
  rental: 'text-red-500',
  stock: 'text-amber-500',
  pickup: 'text-blue-500',
};

export default function TopBar({ onMenuClick }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) adminApi.setToken(token);

      const [statsRes, overdueRes, pickupsRes] = await Promise.allSettled([
        adminApi.getDashboardStats(),
        adminApi.getOverdueRentals(),
        adminApi.getUpcomingPickups(3),
      ]);

      const items: Notification[] = [];
      let counter = 0;

      // Recent orders notification
      if (statsRes.status === 'fulfilled') {
        const stats = statsRes.value as any;
        if ((stats.ordersToday ?? 0) > 0) {
          items.push({
            id: `orders-today-${counter++}`,
            title: `${stats.ordersToday} order${stats.ordersToday > 1 ? 's' : ''} today`,
            message: `New orders worth ${formatCurrency(stats.totalRevenue ?? 0)} total revenue`,
            time: 'Today',
            unread: true,
            href: '/dashboard/orders',
            icon: 'order',
          });
        }
        if ((stats.lowStockCount ?? 0) > 0 || (stats.outOfStockCount ?? 0) > 0) {
          const lowCount = (stats.lowStockCount ?? 0) + (stats.outOfStockCount ?? 0);
          items.push({
            id: `low-stock-${counter++}`,
            title: 'Low stock alert',
            message: `${lowCount} product${lowCount > 1 ? 's' : ''} need restocking${stats.outOfStockCount ? ` (${stats.outOfStockCount} out of stock)` : ''}`,
            time: 'Current',
            unread: true,
            href: '/dashboard/inventory',
            icon: 'stock',
          });
        }
      }

      // Overdue rentals
      if (overdueRes.status === 'fulfilled') {
        const overdue = Array.isArray(overdueRes.value) ? overdueRes.value : (overdueRes.value as any)?.data || [];
        if (overdue.length > 0) {
          items.push({
            id: `overdue-${counter++}`,
            title: `${overdue.length} overdue rental${overdue.length > 1 ? 's' : ''}`,
            message: overdue.length === 1
              ? `${overdue[0].user?.firstName || 'Customer'} has not returned "${overdue[0].product?.name || 'item'}"`
              : `${overdue.length} items past their return date`,
            time: 'Action needed',
            unread: true,
            href: '/dashboard/rentals',
            icon: 'rental',
          });
        }
      }

      // Upcoming pickups (next 3 days)
      if (pickupsRes.status === 'fulfilled') {
        const pickups = Array.isArray(pickupsRes.value) ? pickupsRes.value : (pickupsRes.value as any)?.data || [];
        if (pickups.length > 0) {
          items.push({
            id: `pickups-${counter++}`,
            title: `${pickups.length} upcoming pickup${pickups.length > 1 ? 's' : ''}`,
            message: `${pickups.length} rental${pickups.length > 1 ? 's' : ''} scheduled for pickup in the next 3 days`,
            time: 'Upcoming',
            unread: true,
            href: '/dashboard/rentals',
            icon: 'pickup',
          });
        }
      }

      setNotifications(items);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    if (user) fetchNotifications();
  }, [user, fetchNotifications]);

  const handleNotificationClick = (notification: Notification) => {
    setReadIds((prev) => new Set(prev).add(notification.id));
    setShowNotifications(false);
    router.push(notification.href);
  };

  const unreadCount = notifications.filter((n) => !readIds.has(n.id) && n.unread).length;

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'luxury', label: 'Luxury', icon: Sparkles },
  ];

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
                <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Notifications
                  </h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => setReadIds(new Set(notifications.map((n) => n.id)))}
                      className="text-xs text-brand-gold hover:text-brand-gold-dark font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell className="w-8 h-8 text-[hsl(var(--muted-foreground))] mx-auto mb-2 opacity-40" />
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">No notifications</p>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const isUnread = n.unread && !readIds.has(n.id);
                      const IconComp = ICON_MAP[n.icon];
                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className={cn(
                            'px-4 py-3 hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer border-b border-[hsl(var(--border))] last:border-0',
                            isUnread && 'bg-[hsl(var(--accent))]'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn('mt-0.5 flex-shrink-0', ICON_COLOR_MAP[n.icon])}>
                              <IconComp className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2">
                                <p className="text-sm font-medium text-[hsl(var(--foreground))] flex-1">
                                  {n.title}
                                </p>
                                {isUnread && (
                                  <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-gold flex-shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                                {n.message}
                              </p>
                              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 opacity-60">
                                {n.time}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="px-4 py-2 border-t border-[hsl(var(--border))]">
                  <button
                    onClick={() => {
                      setShowNotifications(false);
                      router.push('/dashboard/settings');
                    }}
                    className="text-sm text-brand-gold hover:text-brand-gold-dark w-full text-center font-medium"
                  >
                    Notification settings
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  FolderTree,
  Plus,
  ShoppingCart,
  Users,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Zap,
  Gift,
  PanelLeft,
  Image as ImageIcon,
  FileEdit,
  Settings,
  BarChart3,
  ChevronDown,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  children?: { label: string; href: string; icon: React.ElementType }[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Products',
    icon: ShoppingBag,
    children: [
      { label: 'All Products', href: '/dashboard/products', icon: Package },
      { label: 'Add Product', href: '/dashboard/products/new', icon: Plus },
      { label: 'Categories', href: '/dashboard/products/categories', icon: FolderTree },
    ],
  },
  { label: 'Orders', href: '/dashboard/orders', icon: ShoppingCart },
  { label: 'Customers', href: '/dashboard/customers', icon: Users },
  {
    label: 'Rentals',
    icon: CalendarClock,
    children: [
      { label: 'Active Rentals', href: '/dashboard/rentals', icon: CalendarClock },
      { label: 'Rental Requests', href: '/dashboard/rentals/requests', icon: ClipboardCheck },
      { label: 'Checklists', href: '/dashboard/rentals/checklists', icon: ClipboardList },
      { label: 'Policies', href: '/dashboard/rentals/policies', icon: FileText },
    ],
  },
  { label: 'Flash Sales', href: '/dashboard/flash-sales', icon: Zap },
  { label: 'Referrals', href: '/dashboard/referrals', icon: Gift },
  {
    label: 'CMS',
    icon: PanelLeft,
    children: [
      { label: 'Banners', href: '/dashboard/cms/banners', icon: ImageIcon },
      { label: 'Pages', href: '/dashboard/cms/pages', icon: FileEdit },
      { label: 'Settings', href: '/dashboard/cms/settings', icon: Settings },
    ],
  },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpanded = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isActive = (href: string) => pathname === href;
  const isGroupActive = (item: NavItem) =>
    item.children?.some((c) => pathname.startsWith(c.href));

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 flex flex-col',
          'bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))]',
          'transform transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-[hsl(var(--sidebar-border))]">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image src="/icon.jpg" alt="Naro Fashion" width={36} height={36} className="rounded-full" />
            <span className="text-xl font-bold text-brand-gold">NARO FASHION</span>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md hover:bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-fg))]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            if (item.children) {
              const groupActive = isGroupActive(item);
              const isExpanded = expanded[item.label] ?? groupActive;

              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleExpanded(item.label)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      groupActive
                        ? 'text-[hsl(var(--sidebar-accent-fg))] bg-[hsl(var(--sidebar-accent))]'
                        : 'text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-fg))]'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5 flex-shrink-0" />
                      {item.label}
                    </div>
                    <ChevronDown
                      className={cn(
                        'w-4 h-4 transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </button>

                  {isExpanded && (
                    <div className="mt-1 ml-4 pl-4 border-l border-[hsl(var(--sidebar-border))] space-y-1">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                            isActive(child.href)
                              ? 'text-brand-gold bg-[hsl(var(--sidebar-accent))] font-medium'
                              : 'text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-fg))]'
                          )}
                        >
                          <child.icon className="w-4 h-4 flex-shrink-0" />
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href!}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(item.href!)
                    ? 'text-brand-gold bg-[hsl(var(--sidebar-accent))]'
                    : 'text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-fg))]'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-[hsl(var(--sidebar-border))]">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brand-gold flex items-center justify-center">
              <span className="text-white text-sm font-bold">
                {user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : '?'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[hsl(var(--sidebar-fg))] truncate">
                {user ? `${user.firstName} ${user.lastName}` : 'Loading...'}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                {user?.email || ''}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

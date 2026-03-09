'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  ShoppingCart,
  CalendarClock,
  Users,
  TrendingUp,
  ArrowUpRight,
  Eye,
  Loader2,
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import UpcomingPickups from '@/components/rental/UpcomingPickups';
import OverdueRentals from '@/components/rental/OverdueRentals';
import { formatCurrency, formatDate } from '@/lib/utils';
import { adminApi } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

interface RecentOrder {
  id: string;
  customer: string;
  total: number;
  items: number;
  status: string;
  date: string;
  [key: string]: unknown;
}

interface DashboardStats {
  totalRevenue?: number;
  revenueChange?: string;
  ordersToday?: number;
  ordersChange?: string;
  activeRentals?: number;
  rentalsDueReturn?: number;
  newCustomers?: number;
  customersChange?: string;
  revenueChart?: { month: string; value: number }[];
}

const statusStyles: Record<string, string> = {
  Processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Shipped: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const orderColumns: Column<RecentOrder>[] = [
  { key: 'id', header: 'Order ID', sortable: true, render: (item) => (
    <span className="font-medium text-brand-gold">#{item.id}</span>
  )},
  { key: 'customer', header: 'Customer', sortable: true },
  { key: 'items', header: 'Items', sortable: true },
  { key: 'total', header: 'Total', sortable: true, render: (item) => (
    <span className="font-semibold">{formatCurrency(item.total as number)}</span>
  )},
  { key: 'status', header: 'Status', sortable: true, render: (item) => (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[item.status as string] || ''}`}>
      {item.status as string}
    </span>
  )},
  { key: 'date', header: 'Date', sortable: true, render: (item) => (
    <span className="text-[hsl(var(--muted-foreground))]">{formatDate(item.date as string)}</span>
  )},
  { key: 'actions', header: '', render: () => (
    <button className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors">
      <Eye className="w-4 h-4" />
    </button>
  )},
];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [stats, setStats] = useState<DashboardStats>({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchData = async () => {
      try {
        const [ordersRes, statsRes] = await Promise.allSettled([
          adminApi.getRecentOrders(),
          adminApi.getDashboardStats(),
        ]);

        if (ordersRes.status === 'fulfilled') {
          const data = ordersRes.value;
          setRecentOrders(Array.isArray(data) ? data : data?.data || data?.orders || []);
        }
        if (statsRes.status === 'fulfilled') {
          setStats(statsRes.value || {});
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Dashboard</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Welcome back! Here&apos;s what&apos;s happening with your store today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/analytics/dashboard`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                const reportLines = [
                  'Naro Fashion - Dashboard Report',
                  `Generated: ${new Date().toLocaleString()}`,
                  '',
                  `Total Revenue: ${formatCurrency(data.totalRevenue ?? stats.totalRevenue ?? 0)}`,
                  `Orders Today: ${data.ordersToday ?? stats.ordersToday ?? 0}`,
                  `Active Rentals: ${data.activeRentals ?? stats.activeRentals ?? 0}`,
                  `New Customers: ${data.newCustomers ?? stats.newCustomers ?? 0}`,
                  '',
                  'Recent Orders:',
                  ...recentOrders.map((o) => `  #${o.id} - ${o.customer} - ${formatCurrency(o.total)} - ${o.status}`),
                ];
                const blob = new Blob([reportLines.join('\n')], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `naro-dashboard-report-${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                alert('Failed to generate report. Please try again.');
              }
            }}
          >
            Download Report
          </Button>
          <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="gap-1.5">
              <ArrowUpRight className="w-4 h-4" />
              View Store
            </Button>
          </a>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Revenue"
          value={formatCurrency(stats.totalRevenue ?? 0)}
          change={stats.revenueChange ?? 'N/A'}
          changeType="positive"
          icon={DollarSign}
          iconColor="text-emerald-600"
        />
        <StatsCard
          title="Orders Today"
          value={String(stats.ordersToday ?? 0)}
          change={stats.ordersChange ?? 'N/A'}
          changeType="positive"
          icon={ShoppingCart}
          iconColor="text-brand-gold"
        />
        <StatsCard
          title="Active Rentals"
          value={String(stats.activeRentals ?? 0)}
          change={stats.rentalsDueReturn ? `${stats.rentalsDueReturn} due for return` : 'N/A'}
          changeType="neutral"
          icon={CalendarClock}
          iconColor="text-brand-gold"
        />
        <StatsCard
          title="New Customers"
          value={String(stats.newCustomers ?? 0)}
          change={stats.customersChange ?? 'N/A'}
          changeType="positive"
          icon={Users}
          iconColor="text-blue-600"
        />
      </div>

      {/* Revenue Chart Placeholder + Rental Widgets */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">Revenue Overview</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Monthly revenue for 2026</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <select className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] outline-none">
                <option>Last 6 months</option>
                <option>Last 12 months</option>
                <option>This year</option>
              </select>
            </div>
          </div>

          {/* Chart placeholder */}
          <div className="h-64 flex items-end gap-2 px-4">
            {(stats.revenueChart && stats.revenueChart.length > 0
              ? stats.revenueChart
              : [
                  { month: 'Oct', value: 65 },
                  { month: 'Nov', value: 78 },
                  { month: 'Dec', value: 92 },
                  { month: 'Jan', value: 55 },
                  { month: 'Feb', value: 72 },
                  { month: 'Mar', value: 85 },
                ]
            ).map((bar) => (
              <div key={bar.month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full relative" style={{ height: '200px' }}>
                  <div
                    className="absolute bottom-0 w-full rounded-t-md bg-gradient-to-t from-brand-gold to-brand-gold/60 hover:from-brand-gold hover:to-brand-gold/80 transition-all cursor-pointer"
                    style={{ height: `${bar.value}%` }}
                  />
                </div>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{bar.month}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-center text-[hsl(var(--muted-foreground))] mt-4">
            Recharts integration coming soon - showing placeholder bars
          </p>
        </div>

        {/* Rental Widgets Column */}
        <div className="space-y-6">
          <UpcomingPickups />
          <OverdueRentals />
        </div>
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">Recent Orders</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Latest orders from your store</p>
          </div>
          <a href="/dashboard/orders">
            <Button variant="ghost" size="sm" className="gap-1.5 text-brand-gold">
              View All <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </a>
        </div>

        <DataTable columns={orderColumns} data={recentOrders} pageSize={5} />
      </div>
    </div>
  );
}

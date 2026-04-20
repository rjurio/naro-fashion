'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import dynamic from 'next/dynamic';
import {
  DollarSign,
  ShoppingCart,
  CalendarClock,
  Users,
  ArrowUpRight,
  Eye,
  Loader2,
  PackageX,
  Percent,
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import UpcomingPickups from '@/components/rental/UpcomingPickups';
import OverdueRentals from '@/components/rental/OverdueRentals';
import { formatCurrency, formatDate } from '@/lib/utils';
import { adminApi } from '@/lib/api';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';

// Dynamically import Recharts components to avoid SSR issues
const RevenueAreaChart = dynamic(() => import('./charts').then((m) => ({ default: m.RevenueAreaChart })), { ssr: false });
const TopProductsBar = dynamic(() => import('./charts').then((m) => ({ default: m.TopProductsBar })), { ssr: false });
const SalesByChannelDonut = dynamic(() => import('./charts').then((m) => ({ default: m.SalesByChannelDonut })), { ssr: false });
const InventoryStatusBars = dynamic(() => import('./charts').then((m) => ({ default: m.InventoryStatusBars })), { ssr: false });


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
  lowStockCount?: number;
  outOfStockCount?: number;
  profitMargin?: number;
  grossProfit?: number;
  totalOrders?: number;
  overdueRentals?: number;
}

interface SalesData {
  topProducts?: { name: string; revenue: number; category?: string }[];
  orderStatusDistribution?: { status: string; count: number }[];
  paymentMethodDistribution?: { method: string; count: number; total: number }[];
}

interface InventoryData {
  stockDistribution?: { status: string; count: number }[];
}

const statusStyles: Record<string, string> = {
  Processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Shipped: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PROCESSING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  SHIPPED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  DELIVERED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[item.status as string] || 'bg-gray-100 text-gray-700'}`}>
      {(item.status as string).replace(/_/g, ' ')}
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
  const toast = useToast();
  const { settings } = useSiteSettings();
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [stats, setStats] = useState<DashboardStats>({});
  const [revenueChartData, setRevenueChartData] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<SalesData>({});
  const [inventoryData, setInventoryData] = useState<InventoryData>({});
  const [revenuePeriod, setRevenuePeriod] = useState('monthly');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchData = async () => {
      try {
        const [ordersRes, statsRes, revenueRes, salesRes, inventoryRes] = await Promise.allSettled([
          adminApi.getRecentOrders(),
          adminApi.getDashboardStats(),
          adminApi.getRevenueChart(revenuePeriod),
          adminApi.getAnalyticsSales(),
          adminApi.getAnalyticsInventory(),
        ]);

        if (ordersRes.status === 'fulfilled') {
          const data = ordersRes.value;
          setRecentOrders(Array.isArray(data) ? data : data?.data || data?.orders || []);
        }
        if (statsRes.status === 'fulfilled') {
          setStats(statsRes.value || {});
        }
        if (revenueRes.status === 'fulfilled') {
          const revData = revenueRes.value as any;
          setRevenueChartData(Array.isArray(revData) ? revData : revData?.data || []);
        }
        if (salesRes.status === 'fulfilled') {
          setSalesData(salesRes.value || {});
        }
        if (inventoryRes.status === 'fulfilled') {
          setInventoryData(inventoryRes.value || {});
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [revenuePeriod]);

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
                  `${settings.businessName} - Dashboard Report`,
                  `Generated: ${new Date().toLocaleString()}`,
                  '',
                  `Total Revenue: ${formatCurrency(data.totalRevenue ?? stats.totalRevenue ?? 0)}`,
                  `Orders Today: ${data.ordersToday ?? stats.ordersToday ?? 0}`,
                  `Active Rentals: ${data.activeRentals ?? stats.activeRentals ?? 0}`,
                  `New Customers: ${data.newCustomers ?? stats.newCustomers ?? 0}`,
                  `Low Stock Items: ${data.lowStockCount ?? stats.lowStockCount ?? 0}`,
                  `Profit Margin: ${data.profitMargin ?? stats.profitMargin ?? 0}%`,
                  '',
                  'Recent Orders:',
                  ...recentOrders.map((o) => `  #${o.id} - ${o.customer} - ${formatCurrency(o.total)} - ${o.status}`),
                ];
                const blob = new Blob([reportLines.join('\n')], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${settings.businessName.toLowerCase().replace(/\s+/g, '-')}-dashboard-report-${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error('Failed to generate report. Please try again.');
              }
            }}
          >
            Download Report
          </Button>
          <a href={process.env.NEXT_PUBLIC_STOREFRONT_URL || '/'} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="gap-1.5">
              <ArrowUpRight className="w-4 h-4" />
              View Store
            </Button>
          </a>
        </div>
      </div>

      {/* Stats Cards — 6 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">
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
        <StatsCard
          title="Low Stock Items"
          value={String((stats.lowStockCount ?? 0) + (stats.outOfStockCount ?? 0))}
          change={stats.outOfStockCount ? `${stats.outOfStockCount} out of stock` : 'All stocked'}
          changeType={((stats.lowStockCount ?? 0) + (stats.outOfStockCount ?? 0)) > 0 ? 'negative' : 'positive'}
          icon={PackageX}
          iconColor="text-amber-600"
        />
        <StatsCard
          title="Profit Margin"
          value={`${stats.profitMargin ?? 0}%`}
          change={stats.grossProfit ? `Gross: ${formatCurrency(stats.grossProfit)}` : 'N/A'}
          changeType={(stats.profitMargin ?? 0) >= 0 ? 'positive' : 'negative'}
          icon={Percent}
          iconColor="text-emerald-600"
        />
      </div>

      {/* Revenue Chart + Rental Widgets */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">Revenue Overview</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Sales & rental revenue trends</p>
            </div>
            <select
              value={revenuePeriod}
              onChange={(e) => setRevenuePeriod(e.target.value)}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] outline-none"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <RevenueAreaChart data={revenueChartData} />
        </div>

        {/* Rental Widgets Column */}
        <div className="space-y-6">
          <UpcomingPickups />
          <OverdueRentals />
        </div>
      </div>

      {/* Analytics Row — Top Products, Payment Methods, Order Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top Products */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Products</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">By revenue</p>
          <TopProductsBar data={salesData.topProducts || []} />
        </div>

        {/* Payment Methods */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Payment Methods</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Revenue by method</p>
          <SalesByChannelDonut data={salesData.paymentMethodDistribution || []} />
        </div>

        {/* Order Status + Inventory */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Inventory Health</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Stock status distribution</p>
          <InventoryStatusBars data={inventoryData.stockDistribution || []} />
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

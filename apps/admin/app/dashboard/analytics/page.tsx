'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  DollarSign,
  ShoppingCart,
  Package,
  Repeat,
  Users,
  Loader2,
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { formatCurrency } from '@/lib/utils';
import { adminApi } from '@/lib/api';

// Dynamically import chart components with SSR disabled
const RevenueChart = dynamic(() => import('./charts').then(m => ({ default: m.RevenueChart })), { ssr: false });
const CategoryPieChart = dynamic(() => import('./charts').then(m => ({ default: m.CategoryPieChart })), { ssr: false });
const DailyOrdersChart = dynamic(() => import('./charts').then(m => ({ default: m.DailyOrdersChart })), { ssr: false });
const CustomerGrowthChart = dynamic(() => import('./charts').then(m => ({ default: m.CustomerGrowthChart })), { ssr: false });
const StatusPieChart = dynamic(() => import('./charts').then(m => ({ default: m.StatusPieChart })), { ssr: false });
const PaymentPieChart = dynamic(() => import('./charts').then(m => ({ default: m.PaymentPieChart })), { ssr: false });

interface DashboardData {
  totalRevenue?: number;
  totalOrders?: number;
  customerCount?: number;
  activeRentals?: number;
  rentalRevenue?: number;
  avgOrderValue?: number;
  revenueChange?: string;
  ordersChange?: string;
  rentalRevenueChange?: string;
  avgOrderValueChange?: string;
  topProducts?: { name: string; revenue: number; units: number; type: string }[];
  categoryBreakdown?: { name: string; revenue: number; percentage: number }[];
  orderStatusDistribution?: { status: string; count: number }[];
  paymentMethodDistribution?: { method: string; count: number; total: number }[];
  customerGrowth?: { month: string; count: number }[];
  rentalStatusDistribution?: { status: string; count: number }[];
  dailyOrders?: { day: string; count: number; revenue: number }[];
}

const formatLabel = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [revenueData, setRevenueData] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchData = async () => {
      setLoading(true);
      try {
        const [statsRes, revenueRes] = await Promise.allSettled([
          adminApi.getDashboardStats(),
          adminApi.getRevenueChart(period),
        ]);
        if (statsRes.status === 'fulfilled') setStats(statsRes.value);
        if (revenueRes.status === 'fulfilled') {
          const d = revenueRes.value;
          setRevenueData(Array.isArray(d) ? d : d?.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (!stats) {
    return <p className="text-center text-[hsl(var(--muted-foreground))]">Failed to load analytics data.</p>;
  }

  const changeType = (change?: string): 'positive' | 'negative' | 'neutral' => {
    if (!change) return 'neutral';
    return change.startsWith('+') && change !== '+0%' ? 'positive' : change.startsWith('-') ? 'negative' : 'neutral';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Analytics</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Detailed performance metrics and insights</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none"
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
          >
            <option value="daily">Daily (30 days)</option>
            <option value="weekly">Weekly (3 months)</option>
            <option value="monthly">Monthly (12 months)</option>
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Revenue" value={formatCurrency(stats.totalRevenue ?? 0)} change={stats.revenueChange || '0%'} changeType={changeType(stats.revenueChange)} icon={DollarSign} iconColor="text-emerald-600" />
        <StatsCard title="Total Orders" value={String(stats.totalOrders ?? 0)} change={stats.ordersChange || '0%'} changeType={changeType(stats.ordersChange)} icon={ShoppingCart} iconColor="text-brand-gold" />
        <StatsCard title="Rental Revenue" value={formatCurrency(stats.rentalRevenue ?? 0)} change={stats.rentalRevenueChange || '0%'} changeType={changeType(stats.rentalRevenueChange)} icon={Repeat} iconColor="text-brand-gold" />
        <StatsCard title="Avg. Order Value" value={formatCurrency(stats.avgOrderValue ?? 0)} change={stats.avgOrderValueChange || '0%'} changeType={changeType(stats.avgOrderValueChange)} icon={Package} iconColor="text-blue-600" />
      </div>

      {/* Revenue Chart + Category Pie */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Revenue Breakdown</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Sales vs Rental revenue</p>
          <RevenueChart data={revenueData} />
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Sales by Category</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Revenue distribution</p>
          <CategoryPieChart data={stats.categoryBreakdown || []} />
        </div>
      </div>

      {/* Daily Orders Trend + Customer Growth */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Daily Orders (14 days)</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Order count and revenue trend</p>
          <DailyOrdersChart data={stats.dailyOrders || []} />
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Customer Growth</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">New registrations (last 6 months)</p>
          <CustomerGrowthChart data={stats.customerGrowth || []} />
        </div>
      </div>

      {/* Order Status + Payment Methods + Rental Status */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Order Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Distribution</p>
          <StatusPieChart data={stats.orderStatusDistribution || []} />
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Payment Methods</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Usage breakdown</p>
          <PaymentPieChart data={stats.paymentMethodDistribution || []} />
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Rental Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Distribution</p>
          <StatusPieChart data={stats.rentalStatusDistribution || []} />
        </div>
      </div>

      {/* Top Products Table */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Products</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">By revenue (last 30 days)</p>
        {(stats.topProducts || []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 text-[hsl(var(--muted-foreground))] font-medium">#</th>
                  <th className="text-left py-2 text-[hsl(var(--muted-foreground))] font-medium">Product</th>
                  <th className="text-left py-2 text-[hsl(var(--muted-foreground))] font-medium">Type</th>
                  <th className="text-right py-2 text-[hsl(var(--muted-foreground))] font-medium">Units</th>
                  <th className="text-right py-2 text-[hsl(var(--muted-foreground))] font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(stats.topProducts || []).map((product, i) => (
                  <tr key={i} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))] transition-colors">
                    <td className="py-3 text-[hsl(var(--muted-foreground))] font-bold">{i + 1}</td>
                    <td className="py-3 font-medium text-[hsl(var(--card-foreground))]">{product.name}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${product.type === 'RENTAL_ONLY' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : product.type === 'BOTH' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                        {formatLabel(product.type)}
                      </span>
                    </td>
                    <td className="py-3 text-right text-[hsl(var(--card-foreground))]">{product.units}</td>
                    <td className="py-3 text-right font-semibold text-[hsl(var(--card-foreground))]">{formatCurrency(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">No product data available.</p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Total Customers</span>
          </div>
          <p className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{stats.customerCount ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Repeat className="w-4 h-4 text-emerald-500" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Active Rentals</span>
          </div>
          <p className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{stats.activeRentals ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-brand-gold" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Combined Revenue</span>
          </div>
          <p className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{formatCurrency((stats.totalRevenue ?? 0) + (stats.rentalRevenue ?? 0))}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Avg. Order Value</span>
          </div>
          <p className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{formatCurrency(stats.avgOrderValue ?? 0)}</p>
        </div>
      </div>
    </div>
  );
}

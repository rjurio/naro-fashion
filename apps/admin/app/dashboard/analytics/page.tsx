'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  ShoppingCart,
  CalendarClock,
  Users,
  TrendingUp,
  TrendingDown,
  Package,
  Repeat,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { adminApi } from '@/lib/api';

interface RevenueEntry {
  month: string;
  sales: number;
  rentals: number;
}

interface TopProduct {
  name: string;
  revenue: number;
  units: number;
  type: string;
}

interface CategoryEntry {
  name: string;
  percentage: number;
  color: string;
}

interface AnalyticsStats {
  totalRevenue?: number;
  revenueChange?: string;
  totalOrders?: number;
  ordersChange?: string;
  rentalRevenue?: number;
  rentalRevenueChange?: string;
  avgOrderValue?: number;
  avgOrderValueChange?: string;
  avgOrderValueTrend?: string;
  topProducts?: TopProduct[];
  categoryBreakdown?: CategoryEntry[];
  metrics?: { label: string; value: string; trend: string; change: string }[];
}

const categoryColors = ['bg-brand-gold', 'bg-brand-gold', 'bg-blue-500', 'bg-emerald-500', 'bg-purple-500'];

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('6months');
  const [stats, setStats] = useState<AnalyticsStats>({});
  const [monthlyRevenue, setMonthlyRevenue] = useState<RevenueEntry[]>([]);

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

        if (statsRes.status === 'fulfilled') {
          setStats(statsRes.value || {});
        }
        if (revenueRes.status === 'fulfilled') {
          const data = revenueRes.value;
          setMonthlyRevenue(Array.isArray(data) ? data : data?.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch analytics data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [period]);

  const topProducts: TopProduct[] = stats.topProducts || [];
  const categoryBreakdown: CategoryEntry[] = (stats.categoryBreakdown || []).map((cat, i) => ({
    ...cat,
    color: cat.color || categoryColors[i % categoryColors.length],
  }));
  const metrics = stats.metrics || [];

  const maxRevenue = monthlyRevenue.length > 0
    ? Math.max(...monthlyRevenue.map((m) => m.sales + m.rentals))
    : 1;

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
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Analytics</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Detailed performance metrics and insights
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="3months">Last 3 months</option>
            <option value="6months">Last 6 months</option>
            <option value="12months">Last 12 months</option>
          </select>
          <Button variant="outline" size="sm">Export CSV</Button>
        </div>
      </div>

      {/* Stats */}
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
          title="Total Orders"
          value={String(stats.totalOrders ?? 0)}
          change={stats.ordersChange ?? 'N/A'}
          changeType="positive"
          icon={ShoppingCart}
          iconColor="text-brand-gold"
        />
        <StatsCard
          title="Rental Revenue"
          value={formatCurrency(stats.rentalRevenue ?? 0)}
          change={stats.rentalRevenueChange ?? 'N/A'}
          changeType="positive"
          icon={Repeat}
          iconColor="text-brand-gold"
        />
        <StatsCard
          title="Avg. Order Value"
          value={formatCurrency(stats.avgOrderValue ?? 0)}
          change={stats.avgOrderValueChange ?? 'N/A'}
          changeType={(stats.avgOrderValueTrend as 'positive' | 'negative' | 'neutral') ?? 'neutral'}
          icon={Package}
          iconColor="text-blue-600"
        />
      </div>

      {/* Revenue Chart + Category Breakdown */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Revenue Breakdown</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">Sales vs Rental revenue</p>

          {/* Legend */}
          <div className="flex gap-6 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-brand-gold" />
              <span className="text-[hsl(var(--muted-foreground))]">Sales</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-brand-gold/50" />
              <span className="text-[hsl(var(--muted-foreground))]">Rentals</span>
            </div>
          </div>

          {/* Bar Chart */}
          {monthlyRevenue.length > 0 ? (
            <div className="h-64 flex items-end gap-3 px-2">
              {monthlyRevenue.map((bar) => {
                const salesHeight = (bar.sales / maxRevenue) * 100;
                const rentalHeight = (bar.rentals / maxRevenue) * 100;
                return (
                  <div key={bar.month} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex flex-col gap-0.5 relative" style={{ height: '220px' }}>
                      <div className="flex-1" />
                      <div
                        className="w-full rounded-t-sm bg-brand-gold/80 hover:bg-brand-gold transition-colors cursor-pointer"
                        style={{ height: `${salesHeight}%` }}
                        title={`Sales: ${formatCurrency(bar.sales)}`}
                      />
                      <div
                        className="w-full rounded-t-sm bg-brand-gold/40 hover:bg-brand-gold/60 transition-colors cursor-pointer"
                        style={{ height: `${rentalHeight}%` }}
                        title={`Rentals: ${formatCurrency(bar.rentals)}`}
                      />
                    </div>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">{bar.month}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">
              No revenue data available for this period.
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Sales by Category</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">Revenue distribution</p>

          {categoryBreakdown.length > 0 ? (
            <div className="space-y-4">
              {categoryBreakdown.map((cat) => (
                <div key={cat.name}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="font-medium text-[hsl(var(--card-foreground))]">{cat.name}</span>
                    <span className="text-[hsl(var(--muted-foreground))]">{cat.percentage}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[hsl(var(--muted))]">
                    <div className={`h-full rounded-full ${cat.color} transition-all`} style={{ width: `${cat.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No category data available.</p>
          )}
        </div>
      </div>

      {/* Top Products + Growth */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Products</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">By revenue this month</p>

          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.map((product, i) => (
                <div key={product.name} className="flex items-center justify-between py-2 border-b border-[hsl(var(--border))] last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-[hsl(var(--muted-foreground))] w-5">{i + 1}</span>
                    <div>
                      <p className="font-medium text-sm text-[hsl(var(--card-foreground))]">{product.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">{product.units} units &middot; {product.type}</p>
                    </div>
                  </div>
                  <span className="font-semibold text-sm text-[hsl(var(--card-foreground))]">{formatCurrency(product.revenue)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No product data available.</p>
          )}
        </div>

        {/* Key Metrics */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Key Metrics</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Performance indicators</p>

          {metrics.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg bg-[hsl(var(--muted))] p-4">
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{metric.label}</p>
                  <p className="text-xl font-bold text-[hsl(var(--card-foreground))]">{metric.value}</p>
                  <div className={`flex items-center gap-1 text-xs mt-1 ${metric.trend === 'up' ? 'text-emerald-600' : metric.trend === 'down' ? 'text-red-500' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    {metric.trend === 'up' ? <TrendingUp className="w-3 h-3" /> : metric.trend === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
                    {metric.change}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No metrics data available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

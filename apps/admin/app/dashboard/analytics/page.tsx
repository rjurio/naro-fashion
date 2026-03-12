'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  DollarSign, ShoppingCart, Package, Repeat, Users, Loader2,
  TrendingUp, TrendingDown, AlertTriangle, Clock, Calendar,
  BarChart3, Boxes, Star, CreditCard, Eye, Percent,
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
const StockStatusDonut = dynamic(() => import('./charts').then(m => ({ default: m.StockStatusDonut })), { ssr: false });
const CategoryBarChart = dynamic(() => import('./charts').then(m => ({ default: m.CategoryBarChart })), { ssr: false });
type Tab = 'overview' | 'sales' | 'rentals' | 'inventory' | 'customers' | 'products';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'sales', label: 'Sales & Orders', icon: ShoppingCart },
  { key: 'rentals', label: 'Rentals', icon: Repeat },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'products', label: 'Products', icon: Package },
];

const formatLabel = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const changeType = (change?: string): 'positive' | 'negative' | 'neutral' => {
  if (!change) return 'neutral';
  return change.startsWith('+') && change !== '+0%' ? 'positive' : change.startsWith('-') ? 'negative' : 'neutral';
};

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [overview, setOverview] = useState<any>(null);
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<any>(null);
  const [rentalsData, setRentalsData] = useState<any>(null);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [customersData, setCustomersData] = useState<any>(null);
  const [productsData, setProductsData] = useState<any>(null);
  const [tabLoading, setTabLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch overview + revenue on mount
  useEffect(() => {
    if (!mounted) return;
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchOverview = async () => {
      setLoading(true);
      try {
        const [statsRes, revenueRes] = await Promise.allSettled([
          adminApi.getDashboardStats(),
          adminApi.getRevenueChart(period),
        ]);
        if (statsRes.status === 'fulfilled') setOverview(statsRes.value);
        if (revenueRes.status === 'fulfilled') {
          const d = revenueRes.value;
          setRevenueData(Array.isArray(d) ? d : (d as any)?.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOverview();
  }, [period, mounted]);

  // Fetch tab-specific data on tab change
  const fetchTabData = useCallback(async (tab: Tab) => {
    if (tab === 'overview') return;
    setTabLoading(true);
    try {
      switch (tab) {
        case 'sales':
          if (!salesData) setSalesData(await adminApi.getAnalyticsSales());
          break;
        case 'rentals':
          if (!rentalsData) setRentalsData(await adminApi.getAnalyticsRentals());
          break;
        case 'inventory':
          if (!inventoryData) setInventoryData(await adminApi.getAnalyticsInventory());
          break;
        case 'customers':
          if (!customersData) setCustomersData(await adminApi.getAnalyticsCustomers());
          break;
        case 'products':
          if (!productsData) setProductsData(await adminApi.getAnalyticsProducts());
          break;
      }
    } catch (err) {
      console.error(`Failed to fetch ${tab} analytics:`, err);
    } finally {
      setTabLoading(false);
    }
  }, [salesData, rentalsData, inventoryData, customersData, productsData]);

  useEffect(() => {
    fetchTabData(activeTab);
  }, [activeTab, fetchTabData]);

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (!overview) {
    return <p className="text-center text-[hsl(var(--muted-foreground))]">Failed to load analytics data.</p>;
  }

  const TabSpinner = () => (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Analytics</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Comprehensive performance metrics across all modules</p>
        </div>
        {activeTab === 'overview' && (
          <select
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none"
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
          >
            <option value="daily">Daily (30 days)</option>
            <option value="weekly">Weekly (3 months)</option>
            <option value="monthly">Monthly (12 months)</option>
          </select>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))] pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap border-b-2 ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold bg-[hsl(var(--accent))]'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab overview={overview} revenueData={revenueData} period={period} />}
      {activeTab === 'sales' && (tabLoading && !salesData ? <TabSpinner /> : salesData && <SalesTab data={salesData} overview={overview} />)}
      {activeTab === 'rentals' && (tabLoading && !rentalsData ? <TabSpinner /> : rentalsData && <RentalsTab data={rentalsData} />)}
      {activeTab === 'inventory' && (tabLoading && !inventoryData ? <TabSpinner /> : inventoryData && <InventoryTab data={inventoryData} />)}
      {activeTab === 'customers' && (tabLoading && !customersData ? <TabSpinner /> : customersData && <CustomersTab data={customersData} />)}
      {activeTab === 'products' && (tabLoading && !productsData ? <TabSpinner /> : productsData && <ProductsTab data={productsData} />)}
    </div>
  );
}

// ===== OVERVIEW TAB =====
function OverviewTab({ overview, revenueData, period }: { overview: any; revenueData: any[]; period: string }) {
  return (
    <div className="space-y-6">
      {/* Row 1: 6 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard title="Total Revenue" value={formatCurrency(overview.totalRevenue ?? 0)} change={overview.revenueChange || '0%'} changeType={changeType(overview.revenueChange)} icon={DollarSign} iconColor="text-emerald-600" />
        <StatsCard title="Total Orders" value={String(overview.totalOrders ?? 0)} change={overview.ordersChange || '0%'} changeType={changeType(overview.ordersChange)} icon={ShoppingCart} iconColor="text-brand-gold" />
        <StatsCard title="Net Profit" value={formatCurrency(overview.netProfit ?? 0)} change={`${overview.profitMargin ?? 0}% margin`} changeType={(overview.netProfit ?? 0) >= 0 ? 'positive' : 'negative'} icon={TrendingUp} iconColor="text-blue-600" />
        <StatsCard title="Customers" value={String(overview.customerCount ?? 0)} change={`+${overview.newCustomersThisPeriod ?? 0} new`} changeType="positive" icon={Users} iconColor="text-purple-600" />
        <StatsCard title="Active Rentals" value={String(overview.activeRentals ?? 0)} change={overview.rentalRevenueChange || '0%'} changeType={changeType(overview.rentalRevenueChange)} icon={Repeat} iconColor="text-brand-gold" />
        <StatsCard title="Low Stock" value={String((overview.lowStockCount ?? 0) + (overview.outOfStockCount ?? 0))} change={`${overview.outOfStockCount ?? 0} out`} changeType={(overview.lowStockCount ?? 0) + (overview.outOfStockCount ?? 0) > 0 ? 'negative' : 'neutral'} icon={AlertTriangle} iconColor="text-amber-600" />
      </div>

      {/* Row 2: Revenue Chart + Profit Summary */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Revenue Breakdown</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Sales vs Rental revenue ({period})</p>
          <RevenueChart data={revenueData} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Profit & Loss</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Last 30 days</p>
          <ProfitSummaryCard data={{
            totalRevenue: overview.totalRevenue ?? 0,
            cogs: overview.cogs ?? 0,
            grossProfit: overview.grossProfit ?? 0,
            totalExpenses: overview.totalExpenses ?? 0,
            netProfit: overview.netProfit ?? 0,
            profitMargin: overview.profitMargin ?? 0,
          }} />
        </div>
      </div>

      {/* Row 3: Quick Alerts */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Action Items</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Items requiring your attention</p>
        <AlertsPanel alerts={[
          { label: 'Low Stock Products', count: (overview.lowStockCount ?? 0) + (overview.outOfStockCount ?? 0), href: '/dashboard/inventory', icon: AlertTriangle, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
          { label: 'Pending Orders', count: overview.pendingOrders ?? 0, href: '/dashboard/orders', icon: ShoppingCart, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
          { label: 'Overdue Rentals', count: overview.overdueRentals ?? 0, href: '/dashboard/rentals', icon: Clock, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
          { label: 'Upcoming Returns (7 days)', count: overview.upcomingReturns ?? 0, href: '/dashboard/rentals', icon: Calendar, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
          { label: 'Pending Event Approvals', count: overview.pendingEvents ?? 0, href: '/dashboard/events', icon: Eye, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
        ]} />
      </div>

      {/* Row 4: Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard icon={DollarSign} iconColor="text-emerald-500" label="Rental Revenue" value={formatCurrency(overview.rentalRevenue ?? 0)} />
        <MiniCard icon={Package} iconColor="text-blue-500" label="Avg. Order Value" value={formatCurrency(overview.avgOrderValue ?? 0)} />
        <MiniCard icon={Percent} iconColor="text-amber-500" label="Cancellation Rate" value={`${overview.cancellationRate ?? 0}%`} />
        <MiniCard icon={BarChart3} iconColor="text-brand-gold" label="Total SKUs" value={String(overview.totalSkus ?? 0)} />
      </div>
    </div>
  );
}

// ===== SALES TAB =====
function SalesTab({ data, overview }: { data: any; overview: any }) {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Sales Revenue" value={formatCurrency(overview.totalRevenue ?? 0)} change={overview.revenueChange || '0%'} changeType={changeType(overview.revenueChange)} icon={DollarSign} iconColor="text-emerald-600" />
        <StatsCard title="Avg. Order Value" value={formatCurrency(overview.avgOrderValue ?? 0)} icon={CreditCard} iconColor="text-blue-600" />
        <StatsCard title="Cancellation Rate" value={`${overview.cancellationRate ?? 0}%`} changeType={(overview.cancellationRate ?? 0) > 10 ? 'negative' : 'neutral'} icon={TrendingDown} iconColor="text-red-600" />
        <StatsCard title="Pending Orders" value={String(overview.pendingOrders ?? 0)} icon={Clock} iconColor="text-amber-600" />
      </div>

      {/* Daily Orders + Order Status */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Daily Orders (14 days)</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Order count and revenue trend</p>
          <DailyOrdersChart data={data.dailyOrders || []} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Order Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Distribution</p>
          <StatusPieChart data={data.orderStatusDistribution || []} />
        </div>
      </div>

      {/* Category Breakdown + Payment Methods */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Sales by Category</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Revenue distribution</p>
          <CategoryPieChart data={data.categoryBreakdown || []} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Payment Methods</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Usage breakdown</p>
          <PaymentPieChart data={data.paymentMethodDistribution || []} />
        </div>
      </div>

      {/* Top Products Table */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Products</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">By revenue</p>
        <DataTable
          headers={['#', 'Product', 'Category', 'Type', 'Units', 'Revenue']}
          rows={(data.topProducts || []).map((p: any, i: number) => [
            String(i + 1),
            p.name,
            p.category,
            <TypeBadge key={i} type={p.type} />,
            String(p.units),
            formatCurrency(p.revenue),
          ])}
          emptyText="No product data available."
        />
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Recent Orders</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Latest 10 orders</p>
        <DataTable
          headers={['Order #', 'Customer', 'Total', 'Payment', 'Status', 'Date']}
          rows={(data.recentOrders || []).map((o: any) => [
            o.orderNumber,
            o.customer,
            formatCurrency(o.total),
            formatLabel(o.paymentMethod || 'N/A'),
            <StatusBadge key={o.id} status={o.status} />,
            new Date(o.date).toLocaleDateString(),
          ])}
          emptyText="No orders yet."
        />
      </div>
    </div>
  );
}

// ===== RENTALS TAB =====
function RentalsTab({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Rental Revenue" value={formatCurrency(data.rentalRevenue ?? 0)} icon={DollarSign} iconColor="text-emerald-600" />
        <StatsCard title="Active Rentals" value={String(data.activeRentals ?? 0)} icon={Repeat} iconColor="text-brand-gold" />
        <StatsCard title="Overdue" value={String(data.overdueRentals ?? 0)} changeType={(data.overdueRentals ?? 0) > 0 ? 'negative' : 'neutral'} icon={AlertTriangle} iconColor="text-red-600" />
        <StatsCard title="Avg. Duration" value={`${data.avgRentalDuration ?? 0} days`} icon={Calendar} iconColor="text-blue-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Rental Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Distribution</p>
          <StatusPieChart data={data.rentalStatusDistribution || []} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Utilization Rate</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
            {data.currentlyRentedProducts ?? 0} of {data.totalRentalProducts ?? 0} rental products currently rented
          </p>
          <div className="flex flex-col items-center justify-center py-8">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#D4AF37" strokeWidth="3" strokeDasharray={`${data.utilizationRate ?? 0}, 100`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{data.utilizationRate ?? 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Returns */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Upcoming Returns</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Rentals due back within 7 days</p>
        <DataTable
          headers={['Rental #', 'Product', 'Customer', 'Phone', 'Return Date', 'Amount']}
          rows={(data.upcomingReturns || []).map((r: any) => [
            r.rentalNumber,
            r.product,
            r.customer,
            r.phone || 'N/A',
            new Date(r.returnDate).toLocaleDateString(),
            formatCurrency(r.total),
          ])}
          emptyText="No upcoming returns."
        />
      </div>
    </div>
  );
}

// ===== INVENTORY TAB =====
function InventoryTab({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total SKUs" value={String(data.totalSkus ?? 0)} icon={Package} iconColor="text-blue-600" />
        <StatsCard title="Cost Value" value={formatCurrency(data.costValue ?? 0)} icon={DollarSign} iconColor="text-emerald-600" />
        <StatsCard title="Retail Value" value={formatCurrency(data.retailValue ?? 0)} icon={TrendingUp} iconColor="text-brand-gold" />
        <StatsCard title="Unrealized Profit" value={formatCurrency(data.unrealizedProfit ?? 0)} icon={TrendingUp} iconColor="text-purple-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Stock Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Product distribution by stock level</p>
          <StockStatusDonut data={data.stockDistribution || []} />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Recent Restocks</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Latest inventory additions</p>
          <DataTable
            headers={['Product', 'Qty', 'Stock After', 'By', 'Date']}
            rows={(data.recentRestocks || []).map((r: any) => [
              r.product,
              `+${r.quantity}`,
              String(r.stockAfter),
              r.performedBy,
              new Date(r.date).toLocaleDateString(),
            ])}
            emptyText="No restocks recorded."
          />
        </div>
      </div>
    </div>
  );
}

// ===== CUSTOMERS TAB =====
function CustomersTab({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard title="Total Customers" value={String(data.totalCustomers ?? 0)} icon={Users} iconColor="text-blue-600" />
        <StatsCard title="New This Month" value={String(data.newThisMonth ?? 0)} icon={TrendingUp} iconColor="text-emerald-600" />
        <StatsCard title="Returning Rate" value={`${data.returningRate ?? 0}%`} change={`${data.returningCustomers ?? 0} returning`} changeType="neutral" icon={Repeat} iconColor="text-brand-gold" />
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Customer Growth</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">New registrations (last 12 months)</p>
        <CustomerGrowthChart data={data.customerGrowth || []} />
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Customers</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">By total spend</p>
        <DataTable
          headers={['#', 'Customer', 'Email', 'Orders', 'Total Spend']}
          rows={(data.topCustomers || []).map((c: any, i: number) => [
            String(i + 1),
            c.name || 'N/A',
            c.email || 'N/A',
            String(c.orderCount),
            formatCurrency(c.total),
          ])}
          emptyText="No customer data available."
        />
      </div>
    </div>
  );
}

// ===== PRODUCTS TAB =====
function ProductsTab({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard title="Total Products" value={String(data.totalProducts ?? 0)} icon={Package} iconColor="text-blue-600" />
        <StatsCard title="Published" value={String(data.publishedProducts ?? 0)} icon={Eye} iconColor="text-emerald-600" />
        <StatsCard title="Draft / Inactive" value={String(data.draftProducts ?? 0)} icon={Package} iconColor="text-amber-600" />
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Category Performance</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Revenue by category</p>
        <CategoryBarChart data={data.categoryPerformance || []} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Category Details</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Products, units sold, and revenue</p>
          <DataTable
            headers={['Category', 'Products', 'Units Sold', 'Revenue']}
            rows={(data.categoryPerformance || []).map((c: any) => [
              c.name,
              String(c.productCount),
              String(c.units),
              formatCurrency(c.revenue),
            ])}
            emptyText="No category data."
          />
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))] mb-1">Top Rated Products</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Highest customer ratings</p>
          <DataTable
            headers={['Product', 'Category', 'Rating', 'Reviews']}
            rows={(data.topRated || []).map((p: any) => [
              p.name,
              p.category,
              <span key={p.name} className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />{p.avgRating.toFixed(1)}</span>,
              String(p.reviewCount),
            ])}
            emptyText="No reviews yet."
          />
        </div>
      </div>
    </div>
  );
}

// ===== HELPER COMPONENTS =====

function ProfitSummaryCard({ data }: { data: { totalRevenue: number; cogs: number; totalExpenses: number; grossProfit: number; netProfit: number; profitMargin: number } }) {
  const items = [
    { label: 'Revenue', value: data.totalRevenue, color: '#10B981' },
    { label: 'COGS', value: data.cogs, color: '#F59E0B' },
    { label: 'Gross Profit', value: data.grossProfit, color: '#3B82F6' },
    { label: 'Expenses', value: data.totalExpenses, color: '#EF4444' },
    { label: 'Net Profit', value: data.netProfit, color: data.netProfit >= 0 ? '#10B981' : '#EF4444' },
  ];
  const maxVal = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-[hsl(var(--muted-foreground))]">{item.label}</span>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{formatCurrency(item.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-[hsl(var(--muted))]">
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min((Math.abs(item.value) / maxVal) * 100, 100)}%`, backgroundColor: item.color }} />
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-[hsl(var(--border))]">
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--muted-foreground))]">Profit Margin</span>
          <span className={`font-bold ${data.profitMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{data.profitMargin}%</span>
        </div>
      </div>
    </div>
  );
}

function AlertsPanel({ alerts }: { alerts: { label: string; count: number; href: string; icon: any; color: string }[] }) {
  const activeAlerts = alerts.filter((a) => a.count > 0);
  if (!activeAlerts.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No alerts at this time.</p>;
  }
  return (
    <div className="space-y-3">
      {activeAlerts.map((alert) => (
        <Link key={alert.label} href={alert.href} className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
          <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${alert.color}`}>
            <alert.icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-[hsl(var(--card-foreground))]">{alert.label}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{alert.count} item{alert.count !== 1 ? 's' : ''} need attention</p>
          </div>
          <span className="text-lg font-bold text-[hsl(var(--card-foreground))]">{alert.count}</span>
        </Link>
      ))}
    </div>
  );
}

function MiniCard({ icon: Icon, iconColor, label, value }: { icon: any; iconColor: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-sm text-[hsl(var(--muted-foreground))]">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[hsl(var(--card-foreground))]">{value}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const styles = type === 'RENTAL_ONLY'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    : type === 'BOTH'
      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  return <span className={`px-2 py-0.5 text-xs rounded-full ${styles}`}>{formatLabel(type)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    PROCESSING: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    SHIPPED: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    DELIVERED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return <span className={`px-2 py-0.5 text-xs rounded-full ${colorMap[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'}`}>{formatLabel(status)}</span>;
}

function DataTable({ headers, rows, emptyText }: { headers: string[]; rows: (string | React.ReactNode)[][]; emptyText: string }) {
  if (!rows.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))]">
            {headers.map((h, i) => (
              <th key={i} className={`py-2 text-[hsl(var(--muted-foreground))] font-medium ${i >= headers.length - 2 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))] transition-colors">
              {row.map((cell, ci) => (
                <td key={ci} className={`py-3 text-[hsl(var(--card-foreground))] ${ci >= headers.length - 2 ? 'text-right' : ''} ${ci === 0 ? 'font-medium text-[hsl(var(--muted-foreground))]' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

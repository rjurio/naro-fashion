'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

const COLORS = ['#D4AF37', '#1A1A1A', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  CONFIRMED: '#3B82F6',
  PROCESSING: '#8B5CF6',
  SHIPPED: '#06B6D4',
  DELIVERED: '#10B981',
  CANCELLED: '#EF4444',
  REFUNDED: '#9CA3AF',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-lg text-sm">
      <p className="font-medium text-[hsl(var(--foreground))] mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="text-xs">
          {p.name}: {typeof p.value === 'number' && p.value > 100 ? formatCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

function formatTZS(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

const formatLabel = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Revenue Area Chart — replaces the old placeholder bars
export function RevenueAreaChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-64 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No revenue data available yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatTZS} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Area type="monotone" dataKey="sales" name="Sales" stroke="#D4AF37" fill="#D4AF3730" strokeWidth={2} />
        <Area type="monotone" dataKey="rentals" name="Rentals" stroke="#10B981" fill="#10B98130" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Top Products — horizontal bar chart
export function TopProductsBar({ data }: { data: { name: string; revenue: number }[] }) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">No product data yet.</div>;
  }
  const truncated = data.slice(0, 5).map((d) => ({
    ...d,
    shortName: d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={truncated} layout="vertical" margin={{ left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatTZS} />
        <YAxis type="category" dataKey="shortName" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={90} />
        <Tooltip formatter={(value: number) => formatCurrency(value)} />
        <Bar dataKey="revenue" name="Revenue" fill="#D4AF37" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Order Status Donut
export function OrderStatusDonut({ data }: { data: { status: string; count: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No order data.</p>;
  }
  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
            {data.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.status] || COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2">
        {data.map((s, i) => (
          <div key={s.status} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] || COLORS[i % COLORS.length] }} />
              <span className="text-[hsl(var(--card-foreground))]">{formatLabel(s.status)}</span>
            </div>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{s.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Sales by Channel Donut (Online vs POS)
export function SalesByChannelDonut({ data }: { data: { method: string; count: number; total: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No payment data.</p>;
  }
  const PAYMENT_COLORS = ['#D4AF37', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#1A1A1A'];
  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="method" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PAYMENT_COLORS[i % PAYMENT_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value: number) => formatCurrency(value)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2">
        {data.map((p, i) => (
          <div key={p.method} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }} />
              <span className="text-[hsl(var(--card-foreground))]">{formatLabel(p.method || 'Unknown')}</span>
            </div>
            <span className="text-[hsl(var(--muted-foreground))] text-xs">{formatCurrency(p.total)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Inventory Stock Status
export function InventoryStatusBars({ data }: { data: { status: string; count: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No inventory data.</p>;
  }
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const STOCK_COLORS: Record<string, string> = { OK: '#10B981', LOW: '#F59E0B', OUT: '#EF4444' };
  const STOCK_LABELS: Record<string, string> = { OK: 'In Stock', LOW: 'Low Stock', OUT: 'Out of Stock' };

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.status}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-[hsl(var(--muted-foreground))]">{STOCK_LABELS[d.status] || d.status}</span>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{d.count} ({Math.round((d.count / total) * 100)}%)</span>
          </div>
          <div className="h-2 rounded-full bg-[hsl(var(--muted))]">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${(d.count / total) * 100}%`, backgroundColor: STOCK_COLORS[d.status] || '#9CA3AF' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

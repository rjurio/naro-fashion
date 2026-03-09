'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area,
  LineChart, Line,
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
  ACTIVE: '#10B981',
  RETURNED: '#3B82F6',
  OVERDUE: '#EF4444',
  COMPLETED: '#10B981',
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

export function RevenueChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-64 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No revenue data available.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar dataKey="sales" name="Sales" fill="#D4AF37" radius={[4, 4, 0, 0]} />
        <Bar dataKey="rentals" name="Rentals" fill="#D4AF3780" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryPieChart({ data }: { data: { name: string; revenue: number; percentage: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No category data.</p>;
  }
  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value: number) => formatCurrency(value)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2 mt-2">
        {data.map((cat, i) => (
          <div key={cat.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-[hsl(var(--card-foreground))]">{cat.name}</span>
            </div>
            <span className="text-[hsl(var(--muted-foreground))]">{cat.percentage}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function DailyOrdersChart({ data }: { data: { day: string; count: number; revenue: number }[] }) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">No daily data.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Area yAxisId="left" type="monotone" dataKey="count" name="Orders" stroke="#D4AF37" fill="#D4AF3730" strokeWidth={2} />
        <Area yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#10B981" fill="#10B98130" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CustomerGrowthChart({ data }: { data: { month: string; count: number }[] }) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">No growth data.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="count" name="New Customers" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StatusPieChart({ data, colorMap }: { data: { status: string; count: number }[]; colorMap?: Record<string, string> }) {
  const colors = colorMap || STATUS_COLORS;
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No data available.</p>;
  }
  const formatLabel = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
            {data.map((entry, i) => <Cell key={i} fill={colors[entry.status] || COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2">
        {data.map((s, i) => (
          <div key={s.status} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[s.status] || COLORS[i % COLORS.length] }} />
              <span className="text-[hsl(var(--card-foreground))]">{formatLabel(s.status)}</span>
            </div>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{s.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function PaymentPieChart({ data }: { data: { method: string; count: number; total: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No payment data.</p>;
  }
  const formatLabel = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="method" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value: number) => formatCurrency(value)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2">
        {data.map((p, i) => (
          <div key={p.method} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-[hsl(var(--card-foreground))]">{formatLabel(p.method || 'Unknown')}</span>
            </div>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{p.count} ({formatCurrency(p.total)})</span>
          </div>
        ))}
      </div>
    </>
  );
}

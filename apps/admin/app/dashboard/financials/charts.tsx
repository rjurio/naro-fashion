'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function formatTZS(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

interface FinancialBarChartProps {
  data: Array<{
    monthName: string;
    revenue: number;
    expenses: number;
    netProfit: number;
  }>;
}

export function FinancialBarChart({ data }: FinancialBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="monthName" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tickFormatter={formatTZS} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip formatter={(value: any) => `TZS ${Number(value).toLocaleString('en')}`} />
        <Legend />
        <Bar dataKey="revenue" name="Revenue" fill="#D4AF37" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
        <Bar dataKey="netProfit" name="Net Profit" fill="#10B981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

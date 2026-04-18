'use client';

import { useState, useEffect, useCallback } from 'react';
import { ReceiptText, Loader2, Search, Download } from 'lucide-react';
import adminApi from '@/lib/api';

interface TenantPayment {
  id: string;
  tenantId: string;
  amount: number | string;
  currency: string;
  method: string;
  status: string;
  transactionRef?: string | null;
  invoiceNumber?: string | null;
  periodStart: string;
  periodEnd: string;
  paidAt?: string | null;
  notes?: string | null;
  createdAt: string;
  tenant?: { name: string; slug: string };
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
};

const METHOD_LABELS: Record<string, string> = {
  MOBILE_MONEY: 'Mobile Money',
  BANK_TRANSFER: 'Bank Transfer',
  MANUAL: 'Manual',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-TZ', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(amount: number | string, currency = 'TZS'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return `${currency} ${n.toLocaleString('en-TZ', { minimumFractionDigits: 0 })}`;
}

export default function PlatformPaymentsPage() {
  const [payments, setPayments] = useState<TenantPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = statusFilter !== 'all' ? { status: statusFilter } : undefined;
      const data = await adminApi.getAllTenantPayments(params);
      setPayments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load payments');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const filtered = payments.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.tenant?.name?.toLowerCase().includes(q) ||
      p.tenant?.slug?.toLowerCase().includes(q) ||
      p.transactionRef?.toLowerCase().includes(q) ||
      p.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  const totals = payments.reduce(
    (acc, p) => {
      const amount = Number(p.amount);
      if (p.status === 'COMPLETED') acc.completed += amount;
      else if (p.status === 'PENDING') acc.pending += amount;
      return acc;
    },
    { completed: 0, pending: 0 }
  );

  const handleExport = () => {
    const header = ['Date', 'Tenant', 'Invoice', 'Amount', 'Currency', 'Method', 'Status', 'Transaction Ref', 'Period Start', 'Period End'];
    const rows = filtered.map((p) => [
      formatDate(p.createdAt),
      p.tenant?.name ?? p.tenantId,
      p.invoiceNumber ?? '',
      String(p.amount),
      p.currency,
      METHOD_LABELS[p.method] ?? p.method,
      p.status,
      p.transactionRef ?? '',
      formatDate(p.periodStart),
      formatDate(p.periodEnd),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenant-payments-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <ReceiptText className="h-6 w-6 text-brand-gold" />
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">All Tenant Payments</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
              {payments.length} payment{payments.length === 1 ? '' : 's'} across all tenants
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--foreground))] hover:border-brand-gold hover:text-brand-gold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Completed</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totals.completed)}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Pending</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(totals.pending)}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Total Records</p>
          <p className="text-2xl font-bold text-[hsl(var(--foreground))] mt-1">{payments.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search by tenant, invoice, or ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        >
          <option value="all">All Statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="PENDING">Pending</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-12 text-center">
          <ReceiptText className="h-12 w-12 mx-auto text-[hsl(var(--muted-foreground))] opacity-50 mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">No payments found.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Tenant</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Invoice</th>
                  <th className="px-4 py-3 text-right font-semibold text-[hsl(var(--foreground))]">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Method</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Period</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-[hsl(var(--foreground))]">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-[hsl(var(--muted))]/50 transition-colors">
                    <td className="px-4 py-3 text-[hsl(var(--foreground))] whitespace-nowrap">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[hsl(var(--foreground))]">{p.tenant?.name ?? '—'}</div>
                      {p.tenant?.slug && <div className="text-xs text-[hsl(var(--muted-foreground))]">{p.tenant.slug}</div>}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))] font-mono text-xs">{p.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[hsl(var(--foreground))] whitespace-nowrap">{formatCurrency(p.amount, p.currency)}</td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))]">{METHOD_LABELS[p.method] ?? p.method}</td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {formatDate(p.periodStart)} &rarr; {formatDate(p.periodEnd)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full border ${STATUS_COLORS[p.status] ?? STATUS_COLORS.PENDING}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[hsl(var(--muted-foreground))]">{p.transactionRef ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

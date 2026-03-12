'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, ReceiptText, RefreshCw, ArrowLeft } from 'lucide-react';
import adminApi from '../../../../lib/api';
import { PAYMENT_METHOD_LABELS } from '@naro/shared';

export default function PosSalesHistoryPage() {
  const router = useRouter();
  const [sales, setSales] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [summary, setSummary] = useState<any>(null);

  const limit = 20;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);
  }, []);

  useEffect(() => {
    loadSales();
  }, [page, search, startDate, endDate, paymentMethod]);

  useEffect(() => {
    adminApi.posGetDailySummary().then(setSummary).catch(() => {});
  }, []);

  const loadSales = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
      };
      if (search) params.search = search;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (paymentMethod) params.paymentMethod = paymentMethod;

      const result = await adminApi.posGetSales(params);
      setSales(result?.data || []);
      setTotal(result?.meta?.total || 0);
    } catch {
      setSales([]);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => router.push('/dashboard/pos')}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">POS Sales History</h1>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            View and manage all point-of-sale transactions
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/pos')}
          className="px-4 py-2 rounded-lg bg-brand-gold text-black text-sm font-medium hover:bg-brand-gold/90"
        >
          Open POS
        </button>
      </div>

      {/* Today's Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Today&apos;s Sales</p>
            <p className="text-xl font-bold text-[hsl(var(--foreground))]">
              {(summary.totalSales ?? 0).toLocaleString()} TZS
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Transactions</p>
            <p className="text-xl font-bold text-[hsl(var(--foreground))]">
              {summary.totalTransactions ?? 0}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Items Sold</p>
            <p className="text-xl font-bold text-[hsl(var(--foreground))]">
              {summary.totalItems ?? 0}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Net Sales</p>
            <p className="text-xl font-bold text-green-600">
              {(summary.netSales ?? 0).toLocaleString()} TZS
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by order #, customer..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm w-64"
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
        />
        <select
          value={paymentMethod}
          onChange={(e) => { setPaymentMethod(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm"
        >
          <option value="">All Methods</option>
          <option value="CASH">Cash</option>
          <option value="MPESA">M-Pesa</option>
          <option value="TIGO_PESA">Tigo Pesa</option>
          <option value="AIRTEL_MONEY">Airtel Money</option>
          <option value="MIX_BY_YAS">MIX by YAS</option>
          <option value="CARD">Card</option>
          <option value="SPLIT">Split</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--accent))]">
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Order #</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Items</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Payment</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[hsl(var(--muted-foreground))]">Total</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))]">Status</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[hsl(var(--muted-foreground))]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-gold" />
                </td>
              </tr>
            )}

            {!loading && sales.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))]">
                  No sales found
                </td>
              </tr>
            )}

            {!loading &&
              sales.map((sale) => (
                <tr key={sale.id} className="hover:bg-[hsl(var(--accent))]">
                  <td className="px-4 py-3 font-medium text-[hsl(var(--foreground))]">
                    {sale.orderNumber}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground))]">
                    {sale.user
                      ? `${sale.user.firstName ?? ''} ${sale.user.lastName ?? ''}`.trim()
                      : sale.customerName || 'Walk-in'}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {sale.items?.length ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]">
                      {PAYMENT_METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground))]">
                    {Number(sale.total).toLocaleString()} TZS
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {new Date(sale.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        sale.status === 'DELIVERED'
                          ? 'bg-green-500/10 text-green-600'
                          : sale.status === 'REFUNDED'
                          ? 'bg-red-500/10 text-red-600'
                          : 'bg-amber-500/10 text-amber-600'
                      }`}
                    >
                      {sale.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => {/* Could open detail modal */}}
                        className="p-1.5 rounded hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          const printWindow = window.open(`/dashboard/pos/sales?receipt=${sale.id}`, '_blank');
                        }}
                        className="p-1.5 rounded hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))]"
                        title="Receipt"
                      >
                        <ReceiptText className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-sm disabled:opacity-30"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-sm disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

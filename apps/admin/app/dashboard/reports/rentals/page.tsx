'use client';
import { useState, useEffect } from 'react';
import { CalendarClock, Download, Eye, DollarSign, Package, TrendingUp } from 'lucide-react';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';

function formatTZS(value: number) {
  return `TZS ${value.toLocaleString('en')}`;
}

function rentalStatusBadge(status: string) {
  const map: Record<string, any> = {
    RETURNED: 'success',
    ACTIVE: 'info',
    CANCELLED: 'error',
    PENDING_ID_VERIFICATION: 'warning',
    PENDING_PAYMENT: 'warning',
  };
  return <Badge variant={map[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}

export default function RentalReportsPage() {
  const toast = useToast();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [historyModal, setHistoryModal] = useState<{ open: boolean; productId: string; productName: string }>({
    open: false,
    productId: '',
    productName: '',
  });
  const [history, setHistory] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    adminApi
      .getRentalReportByProduct()
      .then(setStats)
      .catch(() => toast.error('Failed to load rental reports'))
      .finally(() => setLoading(false));
  }, []);

  const openHistory = async (productId: string, productName: string) => {
    setHistoryModal({ open: true, productId, productName });
    setHistoryLoading(true);
    setHistory(null);
    try {
      const data = await adminApi.getRentalHistoryForProduct(productId, { page: '1', limit: '20' });
      setHistory(data);
    } catch {
      toast.error('Failed to load rental history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const products = stats?.data ?? [];
  const totalRevenue = products.reduce((s: number, p: any) => s + (p.totalIncome ?? 0), 0);
  const totalRentals = products.reduce((s: number, p: any) => s + (p.rentalCount ?? 0), 0);
  const topProduct = products[0]?.productName ?? '—';

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Rental Reports"
        subtitle="Track item performance and rental history"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Reports' },
          { label: 'Rental Reports' },
        ]}
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { title: 'Total Rental Revenue', value: formatTZS(totalRevenue), icon: DollarSign },
          { title: 'Total Rental Orders', value: totalRentals.toLocaleString(), icon: Package },
          { title: 'Most Rented Item', value: topProduct, icon: TrendingUp },
        ].map((card) => (
          <div key={card.title} className="bg-card border border-border rounded-xl p-5 flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{card.title}</p>
              <p className="text-xl font-bold mt-1 text-foreground">{card.value}</p>
            </div>
            <div className="p-2 rounded-lg bg-brand-gold/10">
              <card.icon className="w-5 h-5 text-brand-gold" />
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Item Performance</h2>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
        {loading ? (
          <SkeletonTable rows={5} cols={6} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No rental data yet"
            description="Rentals will appear here once items are rented."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  {['Product', 'Category', 'Rental Count', 'Cumulative Income', 'Avg / Rental', 'Last Rented', 'Actions'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {products.map((p: any) => (
                  <tr key={p.productId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                        )}
                        <span className="font-medium text-foreground">{p.productName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.categoryName}</td>
                    <td className="px-4 py-3 font-medium">{p.rentalCount}</td>
                    <td className="px-4 py-3 font-medium text-green-600">{formatTZS(p.totalIncome ?? 0)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatTZS(Math.round(p.avgPerRental ?? 0))}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.lastRentedAt ? new Date(p.lastRentedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openHistory(p.productId, p.productName)}
                        className="flex items-center gap-1 text-xs text-brand-gold hover:underline"
                      >
                        <Eye className="w-3.5 h-3.5" /> View History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History Modal */}
      <Modal
        isOpen={historyModal.open}
        onClose={() => setHistoryModal((p) => ({ ...p, open: false }))}
        title={`Rental History — ${historyModal.productName}`}
        size="xl"
      >
        {historyLoading ? (
          <SkeletonTable rows={5} cols={7} />
        ) : !history || history.data?.length === 0 ? (
          <EmptyState title="No rentals for this item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  {['Rental #', 'Customer', 'Phone', 'Start Date', 'Return Date', 'Amount', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{r.rentalNumber}</td>
                    <td className="px-3 py-2">
                      {r.user ? `${r.user.firstName} ${r.user.lastName}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.user?.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.startDate).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.returnDate).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 font-medium">{formatTZS(Number(r.totalRentalPrice))}</td>
                    <td className="px-3 py-2">{rentalStatusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between items-center pt-3 text-sm text-muted-foreground">
              <span>Total: {history.total ?? 0} rentals</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

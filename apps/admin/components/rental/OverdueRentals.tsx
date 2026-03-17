'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Phone, Mail, ChevronRight, Loader2, User, MapPin, Calendar } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { adminApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

interface OverdueItem {
  id: string;
  rentalNumber: string;
  gownName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  dueDate: string;
  daysOverdue: number;
  depositAmount: number;
  size: string;
  totalRentalPrice: number;
  downPaymentAmount: number;
  lateFee: number;
  rentalStatus: string;
  weddingDate: string | null;
  weddingLocation: string | null;
  startDate: string;
}

function mapRentalToOverdue(rental: any): OverdueItem {
  const returnDate = new Date(rental.returnDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  returnDate.setHours(0, 0, 0, 0);
  const daysOverdue = Math.max(0, Math.ceil((now.getTime() - returnDate.getTime()) / (1000 * 60 * 60 * 24)));

  const user = rental.user || {};
  const product = rental.product || {};
  const variant = rental.variant || {};

  return {
    id: rental.id,
    rentalNumber: rental.rentalNumber || rental.id,
    gownName: product.name || 'Unknown Product',
    customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown',
    customerPhone: user.phone || '',
    customerEmail: user.email || '',
    dueDate: rental.returnDate,
    daysOverdue,
    depositAmount: Number(rental.damageDeposit) || 0,
    size: variant.size || variant.name || '',
    totalRentalPrice: Number(rental.totalRentalPrice) || 0,
    downPaymentAmount: Number(rental.downPaymentAmount) || 0,
    lateFee: Number(rental.lateFee) || 0,
    rentalStatus: rental.status || '',
    weddingDate: rental.weddingDate,
    weddingLocation: rental.weddingLocation,
    startDate: rental.startDate,
  };
}

export default function OverdueRentals() {
  const router = useRouter();
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<OverdueItem | null>(null);

  const fetchOverdue = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) adminApi.setToken(token);
      const data = await adminApi.getOverdueRentals();
      const items = Array.isArray(data) ? data : (data as any)?.data || [];
      setOverdueItems(items.map(mapRentalToOverdue));
    } catch (err) {
      console.error('Failed to fetch overdue rentals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverdue(); }, [fetchOverdue]);

  if (loading) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Overdue Rentals</h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-red-500" />
        </div>
      </div>
    );
  }

  if (overdueItems.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Overdue Rentals</h3>
          </div>
          <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2.5 py-0.5">
            {overdueItems.length}
          </span>
        </div>

        <div className="space-y-3">
          {overdueItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className="p-3 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:shadow-sm transition-shadow cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">{item.gownName}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{item.customerName}</p>
                </div>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0',
                  item.daysOverdue >= 5 ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                )}>
                  {item.daysOverdue}d overdue
                </span>
              </div>

              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  Deposit: {formatCurrency(item.depositAmount)}
                </span>
                <div className="flex items-center gap-1">
                  {item.customerPhone && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`tel:${item.customerPhone}`); }}
                      className="p-1.5 rounded-md hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
                      title="Call customer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.customerEmail && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`mailto:${item.customerEmail}`); }}
                      className="p-1.5 rounded-md hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
                      title="Email customer"
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/dashboard/rentals')}
          className="w-full mt-3 text-sm text-red-600 hover:text-red-700 font-medium text-center py-2 rounded-lg hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors"
        >
          Manage overdue rentals
        </button>
      </div>

      {/* Overdue Rental Detail Modal */}
      <Modal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        title={`Overdue Rental ${selectedItem?.rentalNumber || ''}`}
        size="lg"
      >
        {selectedItem && (
          <div className="space-y-5">
            {/* Header with overdue badge */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">{selectedItem.gownName}</h3>
                {selectedItem.size && (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Size: {selectedItem.size}</p>
                )}
              </div>
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold bg-red-600 text-white">
                {selectedItem.daysOverdue} days overdue
              </span>
            </div>

            {/* Customer */}
            <div className="rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Customer</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                  <span>{selectedItem.customerName}</span>
                </div>
                {selectedItem.customerPhone && (
                  <a href={`tel:${selectedItem.customerPhone}`} className="flex items-center gap-2 text-brand-gold hover:underline">
                    <Phone className="w-4 h-4" />
                    {selectedItem.customerPhone}
                  </a>
                )}
                {selectedItem.customerEmail && (
                  <a href={`mailto:${selectedItem.customerEmail}`} className="flex items-center gap-2 text-brand-gold hover:underline">
                    <Mail className="w-4 h-4" />
                    {selectedItem.customerEmail}
                  </a>
                )}
              </div>
            </div>

            {/* Rental Details */}
            <div className="rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Rental Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Rental Period</span>
                  <p className="font-medium">{formatDate(selectedItem.startDate)} — {formatDate(selectedItem.dueDate)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Status</span>
                  <p className="font-medium text-red-600">{selectedItem.rentalStatus.replace(/_/g, ' ')}</p>
                </div>
                {selectedItem.weddingDate && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Wedding Date</span>
                    <p className="font-medium">{formatDate(selectedItem.weddingDate)}</p>
                  </div>
                )}
                {selectedItem.weddingLocation && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Location</span>
                    <p className="font-medium flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {selectedItem.weddingLocation}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Financial */}
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-4">
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3">Financial Summary</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Total</span>
                  <p className="font-semibold">{formatCurrency(selectedItem.totalRentalPrice)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Down Payment</span>
                  <p className="font-medium">{formatCurrency(selectedItem.downPaymentAmount)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Deposit</span>
                  <p className="font-medium">{formatCurrency(selectedItem.depositAmount)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Late Fee</span>
                  <p className="font-semibold text-red-600">{formatCurrency(selectedItem.lateFee)}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

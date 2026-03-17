'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, User, ChevronRight, CheckCircle2, Circle, Loader2, MapPin, Phone, Clock } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { adminApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

interface PickupItem {
  id: string;
  rentalNumber: string;
  gownName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  pickupDate: string;
  pickupTime: string;
  daysUntil: number;
  size: string;
  status: 'preparing' | 'ready' | 'urgent';
  isReadyForPickup: boolean;
  weddingDate: string | null;
  weddingLocation: string | null;
  weddingRegion: string | null;
  deliveryModality: string | null;
  totalRentalPrice: number;
  downPaymentAmount: number;
  damageDeposit: number;
  rentalStatus: string;
}

function getDaysUrgencyColor(days: number) {
  if (days <= 1) return 'text-red-600 dark:text-red-400';
  if (days <= 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function getDaysBgColor(days: number) {
  if (days <= 1) return 'bg-red-100 dark:bg-red-900/30';
  if (days <= 3) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-emerald-100 dark:bg-emerald-900/30';
}

const statusConfig = {
  preparing: { label: 'Preparing', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ready: { label: 'Ready', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

function mapRentalToPickup(rental: any): PickupItem {
  const pickupDate = new Date(rental.pickupDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  pickupDate.setHours(0, 0, 0, 0);
  const daysUntil = Math.max(0, Math.ceil((pickupDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  let status: 'preparing' | 'ready' | 'urgent' = 'preparing';
  if (rental.isReadyForPickup || rental.status === 'READY_FOR_PICKUP') {
    status = 'ready';
  } else if (daysUntil <= 1) {
    status = 'urgent';
  }

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
    pickupDate: rental.pickupDate,
    pickupTime: rental.pickupTime || '',
    daysUntil,
    size: variant.size || variant.name || '',
    status,
    isReadyForPickup: rental.isReadyForPickup || false,
    weddingDate: rental.weddingDate,
    weddingLocation: rental.weddingLocation,
    weddingRegion: rental.weddingRegion,
    deliveryModality: rental.deliveryModality,
    totalRentalPrice: Number(rental.totalRentalPrice) || 0,
    downPaymentAmount: Number(rental.downPaymentAmount) || 0,
    damageDeposit: Number(rental.damageDeposit) || 0,
    rentalStatus: rental.status || '',
  };
}

export default function UpcomingPickups() {
  const router = useRouter();
  const [pickups, setPickups] = useState<PickupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPickup, setSelectedPickup] = useState<PickupItem | null>(null);
  const [markingReady, setMarkingReady] = useState<string | null>(null);

  const fetchPickups = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) adminApi.setToken(token);
      const data = await adminApi.getUpcomingPickups(8);
      const items = Array.isArray(data) ? data : (data as any)?.data || [];
      setPickups(items.map(mapRentalToPickup));
    } catch (err) {
      console.error('Failed to fetch upcoming pickups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPickups(); }, [fetchPickups]);

  const handleMarkReady = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMarkingReady(id);
    try {
      await adminApi.markRentalReady(id);
      await fetchPickups();
    } catch (err) {
      console.error('Failed to mark as ready:', err);
    } finally {
      setMarkingReady(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="w-5 h-5 text-brand-gold" />
          <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">Upcoming Pickups (Next 8 Days)</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-brand-gold" />
            <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">
              Upcoming Pickups (Next 8 Days)
            </h3>
          </div>
          <span className="text-xs font-medium text-brand-gold bg-brand-gold/10 rounded-full px-2.5 py-0.5">
            {pickups.length}
          </span>
        </div>

        {pickups.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-6">No upcoming pickups in the next 8 days.</p>
        ) : (
          <div className="space-y-3">
            {pickups.map((pickup) => (
              <div
                key={pickup.id}
                onClick={() => setSelectedPickup(pickup)}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer group"
              >
                <div className={cn('flex flex-col items-center justify-center w-12 h-12 rounded-lg flex-shrink-0', getDaysBgColor(pickup.daysUntil))}>
                  <span className={cn('text-lg font-bold leading-none', getDaysUrgencyColor(pickup.daysUntil))}>
                    {pickup.daysUntil}
                  </span>
                  <span className={cn('text-[10px] font-medium leading-tight', getDaysUrgencyColor(pickup.daysUntil))}>
                    {pickup.daysUntil === 1 ? 'day' : 'days'}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">{pickup.gownName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <User className="w-3 h-3" />
                      {pickup.customerName}
                    </div>
                    {pickup.size && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">&middot; Size {pickup.size}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', statusConfig[pickup.status].className)}>
                      {statusConfig[pickup.status].label}
                    </span>
                    {pickup.pickupTime && (
                      <span className="flex items-center gap-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <Clock className="w-3 h-3" />
                        {pickup.pickupTime}
                      </span>
                    )}
                  </div>

                  {pickup.status !== 'ready' && (
                    <button
                      onClick={(e) => handleMarkReady(pickup.id, e)}
                      disabled={markingReady === pickup.id}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-gold hover:text-brand-gold-dark bg-brand-gold/10 hover:bg-brand-gold/20 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50"
                    >
                      {markingReady === pickup.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      Mark as Ready
                    </button>
                  )}
                </div>

                <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => router.push('/dashboard/rentals')}
          className="w-full mt-3 text-sm text-brand-gold hover:text-brand-gold-dark font-medium text-center py-2 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors"
        >
          View all pickups
        </button>
      </div>

      {/* Rental Detail Modal */}
      <Modal
        isOpen={!!selectedPickup}
        onClose={() => setSelectedPickup(null)}
        title={`Rental ${selectedPickup?.rentalNumber || ''}`}
        size="lg"
      >
        {selectedPickup && (
          <div className="space-y-5">
            {/* Product & Status */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">{selectedPickup.gownName}</h3>
                {selectedPickup.size && (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Size: {selectedPickup.size}</p>
                )}
              </div>
              <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', statusConfig[selectedPickup.status].className)}>
                {statusConfig[selectedPickup.status].label}
              </span>
            </div>

            {/* Customer Info */}
            <div className="rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Customer</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                  <span>{selectedPickup.customerName}</span>
                </div>
                {selectedPickup.customerPhone && (
                  <a href={`tel:${selectedPickup.customerPhone}`} className="flex items-center gap-2 text-brand-gold hover:underline">
                    <Phone className="w-4 h-4" />
                    {selectedPickup.customerPhone}
                  </a>
                )}
              </div>
            </div>

            {/* Pickup & Event Details */}
            <div className="rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Pickup & Event Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Pickup Date</span>
                  <p className="font-medium">{formatDate(selectedPickup.pickupDate)}</p>
                </div>
                {selectedPickup.pickupTime && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Pickup Time</span>
                    <p className="font-medium">{selectedPickup.pickupTime}</p>
                  </div>
                )}
                {selectedPickup.weddingDate && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Wedding Date</span>
                    <p className="font-medium">{formatDate(selectedPickup.weddingDate)}</p>
                  </div>
                )}
                {selectedPickup.weddingLocation && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Location</span>
                    <p className="font-medium flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {selectedPickup.weddingLocation}{selectedPickup.weddingRegion ? `, ${selectedPickup.weddingRegion}` : ''}
                    </p>
                  </div>
                )}
                {selectedPickup.deliveryModality && (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Delivery</span>
                    <p className="font-medium capitalize">{selectedPickup.deliveryModality.toLowerCase().replace('_', ' ')}</p>
                  </div>
                )}
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Status</span>
                  <p className="font-medium">{selectedPickup.rentalStatus.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </div>

            {/* Financial */}
            <div className="rounded-lg border border-[hsl(var(--border))] p-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3">Payment</h4>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Total</span>
                  <p className="font-semibold">{formatCurrency(selectedPickup.totalRentalPrice)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Down Payment</span>
                  <p className="font-medium">{formatCurrency(selectedPickup.downPaymentAmount)}</p>
                </div>
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">Deposit</span>
                  <p className="font-medium">{formatCurrency(selectedPickup.damageDeposit)}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

'use client';

import { useState } from 'react';
import { CalendarClock, Clock, User, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PickupItem {
  id: string;
  gownName: string;
  customerName: string;
  pickupDate: string;
  daysUntil: number;
  size: string;
  status: 'preparing' | 'ready' | 'urgent';
  checklistChecked: number;
  checklistTotal: number;
}

const mockPickups: PickupItem[] = [
  {
    id: 'RNT-201',
    gownName: 'Royal Red Ball Gown',
    customerName: 'Amina Kigoma',
    pickupDate: '2026-03-10',
    daysUntil: 2,
    size: 'M',
    status: 'preparing',
    checklistChecked: 8,
    checklistTotal: 14,
  },
  {
    id: 'RNT-203',
    gownName: 'Gold Beaded Evening Gown',
    customerName: 'Grace Tarimo',
    pickupDate: '2026-03-09',
    daysUntil: 1,
    size: 'S',
    status: 'urgent',
    checklistChecked: 3,
    checklistTotal: 14,
  },
  {
    id: 'RNT-205',
    gownName: 'Classic Black Tuxedo',
    customerName: 'David Kimaro',
    pickupDate: '2026-03-12',
    daysUntil: 4,
    size: 'L',
    status: 'ready',
    checklistChecked: 9,
    checklistTotal: 9,
  },
  {
    id: 'RNT-207',
    gownName: 'White Lace Wedding Gown',
    customerName: 'Fatma Mushi',
    pickupDate: '2026-03-15',
    daysUntil: 7,
    size: 'S',
    status: 'preparing',
    checklistChecked: 2,
    checklistTotal: 14,
  },
];

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
  preparing: {
    label: 'Preparing',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  ready: {
    label: 'Ready',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  urgent: {
    label: 'Urgent',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

export default function UpcomingPickups() {
  const [pickups, setPickups] = useState(mockPickups);

  const handleMarkReady = (id: string) => {
    setPickups((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status: 'ready' as const, checklistChecked: p.checklistTotal }
          : p
      )
    );
  };

  return (
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

      <div className="space-y-3">
        {pickups.map((pickup) => {
          const checklistPct = Math.round(
            (pickup.checklistChecked / pickup.checklistTotal) * 100
          );

          return (
            <div
              key={pickup.id}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer group"
            >
              {/* Days until pickup indicator */}
              <div
                className={cn(
                  'flex flex-col items-center justify-center w-12 h-12 rounded-lg flex-shrink-0',
                  getDaysBgColor(pickup.daysUntil)
                )}
              >
                <span
                  className={cn(
                    'text-lg font-bold leading-none',
                    getDaysUrgencyColor(pickup.daysUntil)
                  )}
                >
                  {pickup.daysUntil}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-medium leading-tight',
                    getDaysUrgencyColor(pickup.daysUntil)
                  )}
                >
                  {pickup.daysUntil === 1 ? 'day' : 'days'}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">
                  {pickup.gownName}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <User className="w-3 h-3" />
                    {pickup.customerName}
                  </div>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    &middot; Size {pickup.size}
                  </span>
                </div>

                {/* Status and checklist row */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                      statusConfig[pickup.status].className
                    )}
                  >
                    {statusConfig[pickup.status].label}
                  </span>

                  {/* Checklist completion indicator */}
                  <div className="flex items-center gap-1">
                    {pickup.checklistChecked === pickup.checklistTotal ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                    )}
                    <span
                      className={cn(
                        'text-xs font-medium',
                        pickup.checklistChecked === pickup.checklistTotal
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-[hsl(var(--muted-foreground))]'
                      )}
                    >
                      {pickup.checklistChecked}/{pickup.checklistTotal} items checked
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-1.5 w-full bg-[hsl(var(--muted))] rounded-full h-1.5">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      checklistPct === 100
                        ? 'bg-emerald-500'
                        : checklistPct >= 50
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    )}
                    style={{ width: `${checklistPct}%` }}
                  />
                </div>

                {/* Mark as Ready button */}
                {pickup.status !== 'ready' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkReady(pickup.id);
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-gold hover:text-brand-gold-dark bg-brand-gold/10 hover:bg-brand-gold/20 rounded-md px-2.5 py-1 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark as Ready
                  </button>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
            </div>
          );
        })}
      </div>

      <button className="w-full mt-3 text-sm text-brand-gold hover:text-brand-gold-dark font-medium text-center py-2 rounded-lg hover:bg-[hsl(var(--accent))] transition-colors">
        View all pickups
      </button>
    </div>
  );
}

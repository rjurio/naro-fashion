'use client';

import { AlertTriangle, Phone, Mail, ChevronRight } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

interface OverdueItem {
  id: string;
  gownName: string;
  customerName: string;
  customerPhone: string;
  dueDate: string;
  daysOverdue: number;
  depositAmount: number;
}

const mockOverdue: OverdueItem[] = [
  {
    id: 'RNT-195',
    gownName: 'Emerald Sequin Mermaid Dress',
    customerName: 'Fatima Said',
    customerPhone: '+255 712 345 678',
    dueDate: '2026-03-05',
    daysOverdue: 3,
    depositAmount: 130000,
  },
  {
    id: 'RNT-192',
    gownName: 'Ivory Lace Wedding Gown',
    customerName: 'Sarah Mushi',
    customerPhone: '+255 756 789 012',
    dueDate: '2026-03-03',
    daysOverdue: 5,
    depositAmount: 220000,
  },
];

export default function OverdueRentals() {
  if (mockOverdue.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
            Overdue Rentals
          </h3>
        </div>
        <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2.5 py-0.5">
          {mockOverdue.length}
        </span>
      </div>

      <div className="space-y-3">
        {mockOverdue.map((item) => (
          <div
            key={item.id}
            className="p-3 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:shadow-sm transition-shadow cursor-pointer group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">
                  {item.gownName}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  {item.customerName}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0',
                  item.daysOverdue >= 5
                    ? 'bg-red-600 text-white'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                )}
              >
                {item.daysOverdue}d overdue
              </span>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                Deposit: {formatCurrency(item.depositAmount)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1.5 rounded-md hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
                  title="Call customer"
                >
                  <Phone className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1.5 rounded-md hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
                  title="Email customer"
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full mt-3 text-sm text-red-600 hover:text-red-700 font-medium text-center py-2 rounded-lg hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors">
        Manage overdue rentals
      </button>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  iconColor?: string;
}

export default function StatsCard({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  iconColor = 'text-brand-gold',
}: StatsCardProps) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0 flex-1">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] truncate" title={title}>{title}</p>
          <p
            className="text-xl xl:text-2xl font-bold text-[hsl(var(--card-foreground))] break-words leading-tight"
            title={String(value)}
          >
            {value}
          </p>
          {change && (
            <p
              className={cn(
                'text-xs font-medium truncate',
                changeType === 'positive' && 'text-emerald-600 dark:text-emerald-400',
                changeType === 'negative' && 'text-red-600 dark:text-red-400',
                changeType === 'neutral' && 'text-[hsl(var(--muted-foreground))]'
              )}
              title={change}
            >
              {changeType === 'positive' && '+'}
              {change}
            </p>
          )}
        </div>
        <div
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--accent))] flex-shrink-0',
            iconColor
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

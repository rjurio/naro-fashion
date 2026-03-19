'use client';

import { useState, useEffect } from 'react';
import { Building2, Users, TrendingUp, AlertTriangle, CreditCard } from 'lucide-react';
import adminApi from '@/lib/api';

export default function PlatformDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getPlatformStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const cards = [
    { label: 'Total Tenants', value: stats?.totalTenants ?? 0, icon: Building2, color: 'bg-blue-500' },
    { label: 'Active Tenants', value: stats?.activeTenants ?? 0, icon: Users, color: 'bg-green-500' },
    { label: 'Monthly Revenue (TZS)', value: (stats?.mrr ?? 0).toLocaleString(), icon: TrendingUp, color: 'bg-yellow-500' },
    { label: 'Expiring Soon', value: stats?.expiringSoon ?? 0, icon: AlertTriangle, color: 'bg-red-500' },
    { label: 'Trial Tenants', value: stats?.trialTenants ?? 0, icon: CreditCard, color: 'bg-purple-500' },
    { label: 'Suspended', value: stats?.suspendedTenants ?? 0, icon: AlertTriangle, color: 'bg-orange-500' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Platform Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{card.label}</p>
                <p className="text-2xl font-bold text-[hsl(var(--foreground))] mt-1">{card.value}</p>
              </div>
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Payments */}
      {stats?.recentPayments?.length > 0 && (
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">Recent Payments</h2>
          <div className="space-y-3">
            {stats.recentPayments.map((payment: any) => (
              <div key={payment.id} className="flex items-center justify-between py-2 border-b border-[hsl(var(--card-border))] last:border-0">
                <div>
                  <p className="font-medium text-[hsl(var(--foreground))]">{payment.tenant?.name}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{new Date(payment.createdAt).toLocaleDateString()}</p>
                </div>
                <p className="font-semibold text-green-600">TZS {Number(payment.amount).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

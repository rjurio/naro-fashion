'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Building2, CreditCard, Settings, Power, Pause, Play } from 'lucide-react';
import adminApi from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { PLATFORM_MODULES, CORE_MODULES } from '@naro/shared';

const statusColors: Record<string, string> = {
  ACTIVE: 'success',
  TRIAL: 'purple',
  SUSPENDED: 'warning',
  DEACTIVATED: 'error',
};

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tenant, setTenant] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenant = () => {
    adminApi.getTenant(id).then(setTenant).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTenant(); }, [id]);

  const handleStatusChange = async (status: string) => {
    await adminApi.updateTenantStatus(id, status);
    fetchTenant();
  };

  const handleModuleToggle = async (moduleCode: string, isEnabled: boolean) => {
    await adminApi.toggleTenantModule(id, moduleCode, isEnabled);
    fetchTenant();
  };

  if (loading || !tenant) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const currentSub = tenant.subscriptions?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-blue-100 p-3 rounded-lg">
            <Building2 className="h-8 w-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              {tenant.branding?.companyName || tenant.name}
            </h1>
            <p className="text-[hsl(var(--muted-foreground))]">{tenant.slug} | {tenant.domain || 'No custom domain'}</p>
          </div>
          <Badge variant={statusColors[tenant.status] as any || 'neutral'}>{tenant.status}</Badge>
        </div>
        <div className="flex gap-2">
          {tenant.status === 'ACTIVE' && (
            <button onClick={() => handleStatusChange('SUSPENDED')} className="flex items-center gap-1 px-3 py-2 bg-yellow-100 text-yellow-700 rounded-lg text-sm hover:bg-yellow-200">
              <Pause className="h-4 w-4" /> Suspend
            </button>
          )}
          {tenant.status === 'SUSPENDED' && (
            <button onClick={() => handleStatusChange('ACTIVE')} className="flex items-center gap-1 px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm hover:bg-green-200">
              <Play className="h-4 w-4" /> Activate
            </button>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Current Plan</p>
          <p className="text-xl font-bold text-[hsl(var(--foreground))]">{currentSub?.plan?.name || 'None'}</p>
          {currentSub && (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Expires: {new Date(currentSub.endDate).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Admin Users</p>
          <p className="text-xl font-bold text-[hsl(var(--foreground))]">{tenant._count?.adminUsers ?? 0}</p>
        </div>
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Customers</p>
          <p className="text-xl font-bold text-[hsl(var(--foreground))]">{tenant._count?.users ?? 0}</p>
        </div>
      </div>

      {/* Module Management */}
      <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">Module Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(PLATFORM_MODULES).map(([code, info]) => {
            const moduleEntry = tenant.modules?.find((m: any) => m.moduleCode === code);
            const isEnabled = moduleEntry?.isEnabled ?? false;
            const isCore = (CORE_MODULES as readonly string[]).includes(code);

            return (
              <div key={code} className="flex items-center justify-between p-3 border border-[hsl(var(--card-border))] rounded-lg">
                <div>
                  <p className="font-medium text-[hsl(var(--foreground))] text-sm">{info.name}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{info.description}</p>
                </div>
                <button
                  onClick={() => !isCore && handleModuleToggle(code, !isEnabled)}
                  disabled={isCore}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isEnabled
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  } ${isCore ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={isCore ? 'Core module — always enabled' : isEnabled ? 'Disable' : 'Enable'}
                >
                  <Power className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4">Payment History</h2>
        {tenant.payments?.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--card-border))]">
                <th className="text-left px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Date</th>
                <th className="text-left px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Amount</th>
                <th className="text-left px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Method</th>
                <th className="text-left px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Status</th>
                <th className="text-left px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Period</th>
              </tr>
            </thead>
            <tbody>
              {tenant.payments.map((p: any) => (
                <tr key={p.id} className="border-b border-[hsl(var(--card-border))] last:border-0">
                  <td className="px-3 py-2 text-sm text-[hsl(var(--foreground))]">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))]">TZS {Number(p.amount).toLocaleString()}</td>
                  <td className="px-3 py-2 text-sm text-[hsl(var(--foreground))]">{p.method}</td>
                  <td className="px-3 py-2"><Badge variant={p.status === 'COMPLETED' ? 'success' : 'warning'}>{p.status}</Badge></td>
                  <td className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                    {new Date(p.periodStart).toLocaleDateString()} - {new Date(p.periodEnd).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[hsl(var(--muted-foreground))] text-center py-4">No payments recorded</p>
        )}
      </div>
    </div>
  );
}

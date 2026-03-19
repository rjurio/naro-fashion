'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Building2 } from 'lucide-react';
import adminApi from '@/lib/api';
import { Badge } from '@/components/ui/Badge';

const statusColors: Record<string, string> = {
  ACTIVE: 'success',
  TRIAL: 'purple',
  SUSPENDED: 'warning',
  DEACTIVATED: 'error',
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchTenants = () => {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    adminApi
      .getTenants(params)
      .then(setTenants)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTenants();
  }, [search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Tenants</h1>
        <Link
          href="/platform/tenants/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Tenant
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-[hsl(var(--input-bg))] border border-[hsl(var(--input-border))] rounded-lg text-[hsl(var(--foreground))]"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-[hsl(var(--card-bg))] border border-[hsl(var(--card-border))] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[hsl(var(--card-border))]">
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Tenant</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Plan</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Admins</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Customers</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[hsl(var(--muted-foreground))]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-[hsl(var(--card-border))] last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 p-2 rounded-lg">
                        <Building2 className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-[hsl(var(--foreground))]">
                          {tenant.branding?.companyName || tenant.name}
                        </p>
                        <p className="text-sm text-[hsl(var(--muted-foreground))]">{tenant.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusColors[tenant.status] as any || 'neutral'}>
                      {tenant.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground))]">
                    {tenant.currentPlan || 'None'}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground))]">{tenant.adminCount}</td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground))]">{tenant.customerCount}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${tenant.id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                    No tenants found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

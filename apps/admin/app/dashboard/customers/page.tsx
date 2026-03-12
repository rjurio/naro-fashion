'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Loader2, UserX, UserCheck } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import adminApi from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';

interface Customer {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  orders: number;
  rentals: number;
  totalSpent: string;
  joined: string;
  isActive: boolean;
  status: string;
  [key: string]: unknown;
}

const columns: Column<Customer>[] = [
  {
    key: 'name',
    header: 'Customer',
    sortable: true,
    render: (customer) => (
      <div>
        <p className="font-medium text-[hsl(var(--foreground))]">{customer.name}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{customer.email}</p>
      </div>
    ),
  },
  { key: 'phone', header: 'Phone' },
  { key: 'orders', header: 'Orders', sortable: true },
  { key: 'rentals', header: 'Rentals', sortable: true },
  { key: 'totalSpent', header: 'Total Spent', sortable: true },
  { key: 'joined', header: 'Joined', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (customer) => {
      if (!customer.isActive) return <Badge variant="error">Suspended</Badge>;
      const colors: Record<string, any> = {
        Active: 'success', VIP: 'gold', New: 'info', Inactive: 'neutral',
      };
      return <Badge variant={colors[customer.status] ?? 'neutral'}>{customer.status || (customer.isActive ? 'Active' : 'Inactive')}</Badge>;
    },
  },
];

export default function CustomersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getCustomers();
      setCustomers(Array.isArray(data) ? data : (data as any)?.data || (data as any)?.users || []);
    } catch {
      toast.error('Failed to load customers');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const handleSuspend = async (customer: Customer) => {
    const ok = await confirm({ title: 'Suspend Customer', message: `Suspend ${customer.firstName || customer.name}? They will not be able to log in.`, confirmLabel: 'Suspend', variant: 'warning' });
    if (!ok) return;
    try {
      await adminApi.suspendUser(customer.id);
      toast.success('Customer suspended');
      fetchCustomers();
    } catch {
      toast.error('Failed to suspend customer');
    }
  };

  const handleActivate = async (customer: Customer) => {
    try {
      await adminApi.activateUser(customer.id);
      toast.success('Customer reactivated');
      fetchCustomers();
    } catch {
      toast.error('Failed to reactivate customer');
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const matchesSearch =
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone || '').includes(searchQuery);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'suspended' && !c.isActive)
      || (statusFilter === 'active' && c.isActive && c.status?.toLowerCase() === 'active')
      || (c.status || '').toLowerCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const allColumns = [
    ...columns,
    {
      key: 'actions' as const,
      header: 'Actions',
      render: (customer: Customer) => (
        <div className="flex items-center gap-1">
          {customer.isActive !== false ? (
            <button
              onClick={() => handleSuspend(customer)}
              title="Suspend customer"
              className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors text-amber-600"
            >
              <UserX className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => handleActivate(customer)}
              title="Reactivate customer"
              className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900 transition-colors text-green-600"
            >
              <UserCheck className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Customers</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {customers.length} registered customers
          </p>
        </div>
        <Button variant="outline">
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="vip">VIP</option>
          <option value="new">New</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <DataTable columns={allColumns as any} data={filteredCustomers} pageSize={10} />
      )}
    </div>
  );
}

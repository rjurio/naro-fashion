'use client';

import { useState, useEffect } from 'react';
import { Search, Download, Loader2 } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  rentals: number;
  totalSpent: string;
  joined: string;
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
      const colors: Record<string, string> = {
        Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        VIP: 'bg-[#D4AF37]/20 text-[#D4AF37] dark:bg-[#D4AF37]/10 dark:text-[#D4AF37]',
        New: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        Inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
      };
      return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[customer.status] || ''}`}>
          {customer.status}
        </span>
      );
    },
  },
];

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchCustomers = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getCustomers();
        setCustomers(Array.isArray(data) ? data : data?.data || data?.users || []);
      } catch (err) {
        console.error('Failed to fetch customers:', err);
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomers();
  }, []);

  const filteredCustomers = customers.filter((c) => {
    const matchesSearch =
      (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone || '').includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || (c.status || '').toLowerCase() === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
        <DataTable columns={columns} data={filteredCustomers} pageSize={10} />
      )}
    </div>
  );
}

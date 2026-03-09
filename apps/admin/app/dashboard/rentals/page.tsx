'use client';

import { useState, useEffect } from 'react';
import { Search, CalendarClock, AlertTriangle, ClipboardCheck, Loader2 } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { adminApi } from '@/lib/api';

interface Rental {
  id: string;
  customer: string;
  item: string;
  startDate: string;
  endDate: string;
  total: string;
  deposit: string;
  status: string;
  idVerified: boolean;
  [key: string]: unknown;
}

type TabKey = 'active' | 'requests' | 'overdue';

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'active', label: 'Active Rentals', icon: CalendarClock },
  { key: 'requests', label: 'Requests', icon: ClipboardCheck },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle },
];

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchRentals = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getRentals();
        setRentals(Array.isArray(data) ? data : data?.data || data?.rentals || []);
      } catch (err) {
        console.error('Failed to fetch rentals:', err);
        setRentals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRentals();
  }, []);

  const handleStatusUpdate = async (rentalId: string, newStatus: string) => {
    try {
      await adminApi.updateRentalStatus(rentalId, newStatus);
      setRentals((prev) =>
        prev.map((r) => (r.id === rentalId ? { ...r, status: newStatus } : r))
      );
    } catch (err) {
      console.error('Failed to update rental status:', err);
    }
  };

  const columns: Column<Rental>[] = [
    { key: 'id', header: 'Rental ID', sortable: true },
    { key: 'customer', header: 'Customer', sortable: true },
    { key: 'item', header: 'Item', sortable: true },
    { key: 'startDate', header: 'Start', sortable: true },
    { key: 'endDate', header: 'End', sortable: true },
    { key: 'total', header: 'Total', sortable: true },
    { key: 'deposit', header: 'Deposit' },
    {
      key: 'idVerified',
      header: 'ID Verified',
      render: (rental) => (
        <span className={rental.idVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {rental.idVerified ? 'Verified' : 'Pending'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (rental) => {
        const colors: Record<string, string> = {
          Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
          Pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
          Overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
          Returned: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
        };
        return (
          <select
            value={rental.status}
            onChange={(e) => handleStatusUpdate(rental.id, e.target.value)}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${colors[rental.status] || ''}`}
          >
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Overdue">Overdue</option>
            <option value="Returned">Returned</option>
          </select>
        );
      },
    },
  ];

  const filteredRentals = rentals.filter((r) => {
    const matchesSearch =
      (r.customer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.item || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.id || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === 'active') return matchesSearch && r.status === 'Active';
    if (activeTab === 'requests') return matchesSearch && r.status === 'Pending';
    if (activeTab === 'overdue') return matchesSearch && r.status === 'Overdue';
    return matchesSearch;
  });

  const activeCounts = {
    active: rentals.filter((r) => r.status === 'Active').length,
    requests: rentals.filter((r) => r.status === 'Pending').length,
    overdue: rentals.filter((r) => r.status === 'Overdue').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Rentals</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Manage rental bookings, returns, and overdue items
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[hsl(var(--border))]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-gold text-brand-gold'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span
              className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium ${
                activeTab === tab.key
                  ? 'bg-brand-gold text-white'
                  : tab.key === 'overdue' && activeCounts.overdue > 0
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {activeCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 max-w-sm">
        <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search rentals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <DataTable columns={columns} data={filteredRentals} pageSize={10} />
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Eye, Search, ShieldCheck, CreditCard, Clock, Loader2 } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { formatCurrency, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { adminApi } from '@/lib/api';

interface RentalRequest {
  id: string;
  rentalNo: string;
  customer: string;
  customerEmail: string;
  item: string;
  startDate: string;
  endDate: string;
  total: number;
  deposit: number;
  idStatus: string;
  paymentStatus: string;
  status: string;
  [key: string]: unknown;
}

type FilterTab = 'all' | 'pending_id' | 'id_verified' | 'down_payment';

const idStatusStyles: Record<string, string> = {
  Verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const paymentStatusStyles: Record<string, string> = {
  'Down Payment Paid': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function RentalRequestsPage() {
  const [requests, setRequests] = useState<RentalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchRequests = async () => {
      try {
        setLoading(true);
        const data = await adminApi.getRentals({ status: 'PENDING_ID_VERIFICATION,ID_VERIFIED,DOWN_PAYMENT_PAID' });
        setRequests(Array.isArray(data) ? data : data?.data || data?.rentals || []);
      } catch (err) {
        console.error('Failed to fetch rental requests:', err);
        setRequests([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  const filteredRequests = requests.filter((r) => {
    const matchesSearch =
      (r.customer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.rentalNo || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.item || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    switch (activeTab) {
      case 'pending_id':
        return r.idStatus === 'Pending';
      case 'id_verified':
        return r.idStatus === 'Verified';
      case 'down_payment':
        return r.paymentStatus === 'Down Payment Paid';
      default:
        return true;
    }
  });

  const tabs: { key: FilterTab; label: string; icon: React.ReactNode; count: number }[] = [
    {
      key: 'all',
      label: 'All Requests',
      icon: <Clock className="w-4 h-4" />,
      count: requests.length,
    },
    {
      key: 'pending_id',
      label: 'Pending ID',
      icon: <ShieldCheck className="w-4 h-4" />,
      count: requests.filter((r) => r.idStatus === 'Pending').length,
    },
    {
      key: 'id_verified',
      label: 'ID Verified',
      icon: <CheckCircle className="w-4 h-4" />,
      count: requests.filter((r) => r.idStatus === 'Verified').length,
    },
    {
      key: 'down_payment',
      label: 'Down Payment Paid',
      icon: <CreditCard className="w-4 h-4" />,
      count: requests.filter((r) => r.paymentStatus === 'Down Payment Paid').length,
    },
  ];

  const columns: Column<RentalRequest>[] = [
    {
      key: 'rentalNo',
      header: 'Rental #',
      sortable: true,
      render: (item) => (
        <span className="font-medium text-brand-gold">{item.rentalNo as string}</span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      render: (item) => (
        <div>
          <p className="font-medium text-[hsl(var(--card-foreground))]">{item.customer as string}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.customerEmail as string}</p>
        </div>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
    },
    {
      key: 'startDate',
      header: 'Dates',
      render: (item) => (
        <div className="text-xs">
          <p>{formatDate(item.startDate as string)}</p>
          <p className="text-[hsl(var(--muted-foreground))]">to {formatDate(item.endDate as string)}</p>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      render: (item) => (
        <div>
          <p className="font-medium">{formatCurrency(item.total as number)}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Deposit: {formatCurrency(item.deposit as number)}
          </p>
        </div>
      ),
    },
    {
      key: 'idStatus',
      header: 'ID Status',
      render: (item) => (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            idStatusStyles[item.idStatus as string]
          )}
        >
          {item.idStatus as string}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-brand-gold transition-colors"
            title="View details"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-emerald-100 text-[hsl(var(--muted-foreground))] hover:text-emerald-600 transition-colors"
            title="Approve & assign checklist"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-red-100 text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
            title="Reject"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Rental Requests</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Review and manage pending rental requests
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-brand-gold text-white'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            )}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span
              className={cn(
                'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
                activeTab === tab.key
                  ? 'bg-white/20 text-white'
                  : 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))]'
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search by rental #, customer, or item..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-4 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <DataTable columns={columns} data={filteredRequests} pageSize={10} />
      )}
    </div>
  );
}

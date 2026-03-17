'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  ArrowLeft,
  Search,
  Users,
  UserCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { formatDate } from '@/lib/utils';

interface Subscriber {
  id: string;
  email: string;
  name?: string;
  source?: string;
  status: string;
  subscribedAt?: string;
  createdAt: string;
  unsubscribedAt?: string;
}

interface SubscriberStats {
  total: number;
  active: number;
  unsubscribed: number;
}

const sourceStyles: Record<string, string> = {
  CHECKOUT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  FOOTER: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  POPUP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MANUAL: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  IMPORT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  ACCOUNT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

export default function SubscribersPage() {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<SubscriberStats>({ total: 0, active: 0, unsubscribed: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 15;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchStats = async () => {
      try {
        const data = await adminApi.getSubscriberStats();
        setStats({
          total: data?.total ?? 0,
          active: data?.active ?? 0,
          unsubscribed: data?.unsubscribed ?? 0,
        });
      } catch (err) {
        console.error('Failed to fetch subscriber stats:', err);
      }
    };

    fetchStats();
  }, []);

  useEffect(() => {
    const fetchSubscribers = async () => {
      try {
        setLoading(true);
        const params: Record<string, string> = {
          page: String(page),
          limit: String(limit),
        };
        if (searchQuery.trim()) {
          params.search = searchQuery.trim();
        }
        const res = await adminApi.getSubscribers(params);
        const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setSubscribers(data);
        setTotal(res?.total ?? data.length ?? 0);
      } catch (err) {
        console.error('Failed to fetch subscribers:', err);
        toast.error('Failed to load subscribers');
        setSubscribers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscribers();
  }, [page, searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / limit) || 1;

  const statCards = [
    {
      label: 'Total',
      value: stats.total,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      label: 'Active',
      value: stats.active,
      icon: UserCheck,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
    {
      label: 'Unsubscribed',
      value: stats.unsubscribed,
      icon: UserX,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard/newsletter')}
          className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Subscribers</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage newsletter subscribers
          </p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm flex items-center gap-4"
          >
            <div className={`p-3 rounded-xl ${card.bgColor}`}>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{card.value}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 max-w-md">
        <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search by email..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          className="bg-transparent border-none outline-none text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] w-full"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : subscribers.length === 0 ? (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center shadow-sm">
          <Users className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">
            {searchQuery ? 'No subscribers match your search' : 'No subscribers yet'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Subscribed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {subscribers.map((sub) => (
                  <tr key={sub.id} className="hover:bg-[hsl(var(--muted))] transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-medium text-[hsl(var(--foreground))]">{sub.email}</span>
                    </td>
                    <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                      {sub.name || '--'}
                    </td>
                    <td className="px-6 py-4">
                      {sub.source ? (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            sourceStyles[sub.source] || sourceStyles.MANUAL
                          }`}
                        >
                          {sub.source}
                        </span>
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">--</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                      {formatDate(sub.subscribedAt || sub.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          sub.status === 'ACTIVE' || sub.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {sub.status === 'ACTIVE' || sub.status === 'active'
                          ? 'Active'
                          : 'Unsubscribed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-[hsl(var(--border))]">
            {subscribers.map((sub) => (
              <div key={sub.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[hsl(var(--foreground))] truncate">{sub.email}</p>
                    {sub.name && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{sub.name}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                      sub.status === 'ACTIVE' || sub.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    {sub.status === 'ACTIVE' || sub.status === 'active' ? 'Active' : 'Unsubscribed'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {sub.source && (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        sourceStyles[sub.source] || sourceStyles.MANUAL
                      }`}
                    >
                      {sub.source}
                    </span>
                  )}
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {formatDate(sub.subscribedAt || sub.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-[hsl(var(--border))]">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Page {page} of {totalPages} ({total} subscribers)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  ArrowLeft,
  Mail,
  Send,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { formatDate } from '@/lib/utils';

interface Newsletter {
  id: string;
  subject: string;
  templateType: string;
  status: string;
  sentAt?: string;
  createdAt: string;
  deliveryStats?: {
    total: number;
    delivered: number;
    failed: number;
  };
  _count?: {
    deliveries: number;
  };
}

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  SENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const templateTypeStyles: Record<string, string> = {
  NEW_ARRIVALS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  NEW_DEALS: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  TIPS: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CUSTOM: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

export default function SentNewslettersPage() {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);
  }, []);

  useEffect(() => {
    const fetchNewsletters = async () => {
      try {
        setLoading(true);
        const res = await adminApi.getNewsletters({
          page: String(page),
          limit: String(limit),
        });
        const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setNewsletters(data);
        setTotal(res?.total ?? data.length ?? 0);
      } catch (err) {
        console.error('Failed to fetch newsletters:', err);
        toast.error('Failed to load newsletters');
        setNewsletters([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNewsletters();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/newsletter')}
            className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">All Newsletters</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {total} newsletter{total !== 1 ? 's' : ''} total
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : newsletters.length === 0 ? (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center shadow-sm">
          <Mail className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
          <p className="text-[hsl(var(--muted-foreground))]">No newsletters found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Delivery
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {newsletters.map((nl) => {
                  const stats = nl.deliveryStats;
                  const delivered = stats?.delivered ?? 0;
                  const failed = stats?.failed ?? 0;
                  const totalDeliveries = stats?.total ?? nl._count?.deliveries ?? 0;

                  return (
                    <tr
                      key={nl.id}
                      onClick={() => router.push(`/dashboard/newsletter/${nl.id}`)}
                      className="hover:bg-[hsl(var(--muted))] cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 rounded-lg bg-[hsl(var(--muted))]">
                            {nl.status === 'SENT' ? (
                              <Send className="w-4 h-4 text-emerald-600" />
                            ) : nl.status === 'FAILED' ? (
                              <AlertCircle className="w-4 h-4 text-red-600" />
                            ) : (
                              <Mail className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                            )}
                          </div>
                          <span className="font-medium text-[hsl(var(--foreground))]">
                            {nl.subject || 'Untitled'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            templateTypeStyles[nl.templateType] || templateTypeStyles.CUSTOM
                          }`}
                        >
                          {(nl.templateType || 'CUSTOM').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            statusStyles[nl.status] || statusStyles.DRAFT
                          }`}
                        >
                          {nl.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                        {formatDate(nl.sentAt || nl.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {nl.status === 'SENT' || nl.status === 'FAILED' ? (
                          <div className="text-xs">
                            <span className="text-emerald-600 font-medium">{delivered}</span>
                            {failed > 0 && (
                              <>
                                {' / '}
                                <span className="text-red-600 font-medium">{failed}</span>
                              </>
                            )}
                            <span className="text-[hsl(var(--muted-foreground))]">
                              {' '}/ {totalDeliveries}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-[hsl(var(--border))]">
            {newsletters.map((nl) => {
              const stats = nl.deliveryStats;
              const delivered = stats?.delivered ?? 0;
              const failed = stats?.failed ?? 0;
              const totalDeliveries = stats?.total ?? nl._count?.deliveries ?? 0;

              return (
                <div
                  key={nl.id}
                  onClick={() => router.push(`/dashboard/newsletter/${nl.id}`)}
                  className="p-4 hover:bg-[hsl(var(--muted))] cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-[hsl(var(--foreground))] truncate">
                        {nl.subject || 'Untitled'}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        {formatDate(nl.sentAt || nl.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                        statusStyles[nl.status] || statusStyles.DRAFT
                      }`}
                    >
                      {nl.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        templateTypeStyles[nl.templateType] || templateTypeStyles.CUSTOM
                      }`}
                    >
                      {(nl.templateType || 'CUSTOM').replace(/_/g, ' ')}
                    </span>
                    {(nl.status === 'SENT' || nl.status === 'FAILED') && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {delivered}/{totalDeliveries} delivered
                        {failed > 0 && `, ${failed} failed`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-[hsl(var(--border))]">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Page {page} of {totalPages}
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

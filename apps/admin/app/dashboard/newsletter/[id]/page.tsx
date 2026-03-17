'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Edit,
  Mail,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/utils';

interface Newsletter {
  id: string;
  subject: string;
  templateType: string;
  status: string;
  body?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt?: string;
  deliveryStats?: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
  };
}

interface FailedDelivery {
  id: string;
  status: string;
  failureReason: string;
  subscriber: {
    email: string;
    name?: string;
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

export default function NewsletterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDelivery[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchData = async () => {
      try {
        setLoading(true);
        const [nlRes, failedRes] = await Promise.allSettled([
          adminApi.getNewsletter(id),
          adminApi.getNewsletterFailed(id),
        ]);

        if (nlRes.status === 'fulfilled') {
          setNewsletter(nlRes.value);
        } else {
          toast.error('Failed to load newsletter');
          router.push('/dashboard/newsletter');
          return;
        }

        if (failedRes.status === 'fulfilled') {
          const data = failedRes.value;
          setFailedDeliveries(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch newsletter detail:', err);
        toast.error('Failed to load newsletter');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResendFailed = async () => {
    const confirmed = await confirm({
      title: 'Resend Failed Emails',
      message: `This will resend the newsletter to ${failedDeliveries.length} subscriber${failedDeliveries.length !== 1 ? 's' : ''} that failed previously.`,
      confirmText: 'Resend',
      variant: 'warning',
    });

    if (!confirmed) return;

    try {
      setResending(true);
      const result = await adminApi.resendFailedNewsletter(id);
      toast.success(result?.message || 'Failed emails resent successfully');

      // Refresh data
      const [nlRes, failedRes] = await Promise.allSettled([
        adminApi.getNewsletter(id),
        adminApi.getNewsletterFailed(id),
      ]);
      if (nlRes.status === 'fulfilled') setNewsletter(nlRes.value);
      if (failedRes.status === 'fulfilled') {
        const data = failedRes.value;
        setFailedDeliveries(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to resend:', err);
      toast.error('Failed to resend emails');
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (!newsletter) {
    return (
      <div className="text-center py-20">
        <Mail className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
        <p className="text-[hsl(var(--muted-foreground))]">Newsletter not found</p>
      </div>
    );
  }

  const stats = newsletter.deliveryStats ?? { total: 0, delivered: 0, failed: 0, pending: 0 };

  const deliveryCards = [
    {
      label: 'Delivered',
      value: stats.delivered ?? 0,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
    {
      label: 'Failed',
      value: stats.failed ?? 0,
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
    },
    {
      label: 'Pending',
      value: stats.pending ?? 0,
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    },
  ];

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
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Newsletter Detail</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              View delivery performance and details
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {newsletter.status === 'DRAFT' && (
            <Link href={`/dashboard/newsletter/compose?id=${newsletter.id}`}>
              <Button variant="outline" size="sm">
                <Edit className="w-4 h-4" />
                Edit Draft
              </Button>
            </Link>
          )}
          {failedDeliveries.length > 0 && (
            <Button
              size="sm"
              onClick={handleResendFailed}
              disabled={resending}
            >
              {resending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Resend Failed ({failedDeliveries.length})
            </Button>
          )}
        </div>
      </div>

      {/* Newsletter Info */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Send className="w-5 h-5 text-brand-gold" />
              <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
                {newsletter.subject || 'Untitled'}
              </h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  templateTypeStyles[newsletter.templateType] || templateTypeStyles.CUSTOM
                }`}
              >
                {(newsletter.templateType || 'CUSTOM').replace(/_/g, ' ')}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  statusStyles[newsletter.status] || statusStyles.DRAFT
                }`}
              >
                {newsletter.status}
              </span>
              {newsletter.sentAt && (
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  Sent on {formatDate(newsletter.sentAt)}
                </span>
              )}
              {!newsletter.sentAt && newsletter.createdAt && (
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  Created on {formatDate(newsletter.createdAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delivery Stats */}
      {(newsletter.status === 'SENT' || newsletter.status === 'SENDING' || newsletter.status === 'FAILED') && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {deliveryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{card.label}</p>
                  <p className="text-2xl font-bold text-[hsl(var(--foreground))] mt-1">{card.value}</p>
                </div>
                <div className={`p-3 rounded-xl ${card.bgColor}`}>
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Body Preview */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
        <div className="p-4 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Email Body Preview</h3>
        </div>
        <div className="p-6">
          {newsletter.body ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: newsletter.body }}
            />
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))] italic">No body content</p>
          )}
        </div>
      </div>

      {/* Failed Deliveries Table */}
      {failedDeliveries.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="p-6 pb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
                Failed Deliveries
              </h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {failedDeliveries.length} delivery{failedDeliveries.length !== 1 ? 'ies' : ''} failed
              </p>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                    Failure Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {failedDeliveries.map((delivery) => (
                  <tr key={delivery.id} className="hover:bg-[hsl(var(--muted))] transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-medium text-[hsl(var(--foreground))]">
                        {delivery.subscriber?.email || '--'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                      {delivery.subscriber?.name || '--'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-red-600 dark:text-red-400 text-xs">
                        {delivery.failureReason || 'Unknown error'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-[hsl(var(--border))]">
            {failedDeliveries.map((delivery) => (
              <div key={delivery.id} className="p-4">
                <p className="font-medium text-[hsl(var(--foreground))]">
                  {delivery.subscriber?.email || '--'}
                </p>
                {delivery.subscriber?.name && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {delivery.subscriber.name}
                  </p>
                )}
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {delivery.failureReason || 'Unknown error'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

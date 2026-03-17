'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Users,
  UserCheck,
  Mail,
  TrendingUp,
  Plus,
  Eye,
  Send,
  ArrowUpRight,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { adminApi } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { formatDate } from '@/lib/utils';

interface DashboardData {
  subscribers: { total: number; active: number; unsubscribed: number };
  newsletters: { total: number; draft: number; sent: number };
  deliveries: { total: number; delivered: number; failed: number; deliveryRate: number };
}

interface Newsletter {
  id: string;
  subject: string;
  templateType: string;
  status: string;
  sentAt?: string;
  createdAt: string;
}

const statusStyles: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  SENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function NewsletterDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentNewsletters, setRecentNewsletters] = useState<Newsletter[]>([]);
  const toast = useToast();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchData = async () => {
      try {
        setLoading(true);
        const [dashRes, nlRes] = await Promise.allSettled([
          adminApi.getNewsletterDashboard(),
          adminApi.getNewsletters({ limit: '5', sort: 'newest' }),
        ]);

        if (dashRes.status === 'fulfilled') {
          setDashboard(dashRes.value);
        }
        if (nlRes.status === 'fulfilled') {
          const raw = nlRes.value;
          const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
          setRecentNewsletters(list);
        }
      } catch (err) {
        console.error('Failed to fetch newsletter dashboard:', err);
        toast.error('Failed to load newsletter dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  const subscribers = dashboard?.subscribers ?? { total: 0, active: 0, unsubscribed: 0 };
  const deliveries = dashboard?.deliveries ?? { total: 0, delivered: 0, failed: 0, deliveryRate: 0 };

  const statCards = [
    {
      title: 'Total Subscribers',
      value: subscribers.total ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      title: 'Active Subscribers',
      value: subscribers.active ?? 0,
      icon: UserCheck,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
    {
      title: 'Emails Sent',
      value: deliveries.total ?? 0,
      icon: Mail,
      color: 'text-brand-gold',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    },
    {
      title: 'Delivery Rate',
      value: `${deliveries.deliveryRate ?? 0}%`,
      icon: TrendingUp,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Newsletter</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage email campaigns and subscribers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/newsletter/subscribers">
            <Button variant="outline" size="sm">
              <Users className="w-4 h-4" />
              View Subscribers
            </Button>
          </Link>
          <Link href="/dashboard/newsletter/compose">
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Compose New
            </Button>
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{card.title}</p>
                <p className="text-2xl font-bold text-[hsl(var(--foreground))] mt-1">
                  {card.value}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${card.bgColor}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Newsletters */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              Recent Newsletters
            </h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Last 5 newsletters sent or drafted
            </p>
          </div>
          <Link href="/dashboard/newsletter/sent">
            <Button variant="ghost" size="sm" className="gap-1.5 text-brand-gold">
              View All <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="px-6 pb-6">
          {recentNewsletters.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-12 h-12 mx-auto text-[hsl(var(--muted-foreground))] mb-3" />
              <p className="text-[hsl(var(--muted-foreground))]">No newsletters yet</p>
              <Link href="/dashboard/newsletter/compose" className="inline-block mt-3">
                <Button size="sm">
                  <Plus className="w-4 h-4" />
                  Create your first newsletter
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentNewsletters.map((nl) => (
                <Link
                  key={nl.id}
                  href={`/dashboard/newsletter/${nl.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors group"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-lg bg-[hsl(var(--muted))]">
                      {nl.status === 'SENT' ? (
                        <Send className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Mail className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-[hsl(var(--foreground))] truncate">
                        {nl.subject || 'Untitled'}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                        {nl.templateType?.replace(/_/g, ' ') || 'Custom'} &middot;{' '}
                        {formatDate(nl.sentAt || nl.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        statusStyles[nl.status] || statusStyles.DRAFT
                      }`}
                    >
                      {nl.status}
                    </span>
                    <Eye className="w-4 h-4 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

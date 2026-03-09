'use client';

import { useState, useEffect } from 'react';
import { Search, Gift, Users, TrendingUp, Copy, Plus, Loader2 } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { adminApi } from '@/lib/api';

interface Referral {
  code: string;
  referrer: string;
  email: string;
  referredCount: number;
  conversions: number;
  rewardsGiven: string;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

interface ReferralStats {
  referrals?: Referral[];
  totalReferrals?: number;
  totalConversions?: number;
  totalRewards?: number;
}

const REFERRAL_DISCOUNT = 5000;

const columns: Column<Referral>[] = [
  {
    key: 'code',
    header: 'Code',
    sortable: true,
    render: (r) => (
      <div className="flex items-center gap-2">
        <span className="font-mono font-semibold text-brand-gold">{r.code}</span>
        <button
          onClick={() => navigator.clipboard.writeText(r.code)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          title="Copy code"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
  },
  {
    key: 'referrer',
    header: 'Referrer',
    sortable: true,
    render: (r) => (
      <div>
        <p className="font-medium text-[hsl(var(--foreground))]">{r.referrer}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{r.email}</p>
      </div>
    ),
  },
  { key: 'referredCount', header: 'Referred Users', sortable: true },
  { key: 'conversions', header: 'Conversions', sortable: true },
  { key: 'rewardsGiven', header: 'Rewards Given', sortable: true },
  {
    key: 'status',
    header: 'Status',
    render: (r) => {
      const colors: Record<string, string> = {
        Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        Paused: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
        Expired: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      };
      return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[r.status] || ''}`}>
          {r.status}
        </span>
      );
    },
  },
  { key: 'createdAt', header: 'Created', sortable: true },
];

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState<{ totalReferrals: number; totalConversions: number; totalRewards: number }>({
    totalReferrals: 0,
    totalConversions: 0,
    totalRewards: 0,
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    const fetchReferrals = async () => {
      try {
        setLoading(true);
        const data: ReferralStats = await adminApi.getReferralStats();
        const referralList = Array.isArray(data) ? data : data?.referrals || [];
        setReferrals(referralList);

        if (data?.totalReferrals !== undefined) {
          setStats({
            totalReferrals: data.totalReferrals || 0,
            totalConversions: data.totalConversions || 0,
            totalRewards: data.totalRewards || 0,
          });
        } else {
          // Compute from list
          const totalReferrals = referralList.reduce((sum: number, r: Referral) => sum + (r.referredCount || 0), 0);
          const totalConversions = referralList.reduce((sum: number, r: Referral) => sum + (r.conversions || 0), 0);
          const totalRewards = referralList.reduce((sum: number, r: Referral) => sum + (r.conversions || 0) * REFERRAL_DISCOUNT, 0);
          setStats({ totalReferrals, totalConversions, totalRewards });
        }
      } catch (err) {
        console.error('Failed to fetch referral stats:', err);
        setReferrals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchReferrals();
  }, []);

  const filteredReferrals = referrals.filter(
    (r) =>
      (r.referrer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.code || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Referrals</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Manage referral codes and track conversions. Default discount: {formatCurrency(REFERRAL_DISCOUNT)}
          </p>
        </div>
        <Button>
          <Plus className="w-4 h-4" />
          Create Referral Code
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-gold/10 rounded-lg">
              <Users className="w-5 h-5 text-brand-gold" />
            </div>
            <div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Total Referrals</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{stats.totalReferrals}</p>
            </div>
          </div>
        </div>
        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Successful Conversions</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{stats.totalConversions}</p>
            </div>
          </div>
        </div>
        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-gold/10 rounded-lg">
              <Gift className="w-5 h-5 text-brand-gold" />
            </div>
            <div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Total Rewards Given</p>
              <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{formatCurrency(stats.totalRewards)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-3 py-2 max-w-sm">
        <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
        <input
          type="text"
          placeholder="Search by code or referrer..."
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
        <DataTable columns={columns} data={filteredReferrals} pageSize={10} />
      )}
    </div>
  );
}

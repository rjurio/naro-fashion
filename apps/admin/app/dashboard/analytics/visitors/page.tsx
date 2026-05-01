'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Eye, Users, MousePointerClick, Loader2, Globe, Smartphone, Monitor, Tablet, Bot,
  Calendar, ArrowUp, ArrowDown, Minus, TrendingUp,
} from 'lucide-react';
import { adminApi } from '@/lib/api';

const VisitorTimeseriesChart = dynamic(
  () => import('./charts').then((m) => ({ default: m.VisitorTimeseriesChart })),
  { ssr: false },
);
const VisitorDeviceDonut = dynamic(
  () => import('./charts').then((m) => ({ default: m.VisitorDeviceDonut })),
  { ssr: false },
);
const VisitorBrowserBars = dynamic(
  () => import('./charts').then((m) => ({ default: m.VisitorBrowserBars })),
  { ssr: false },
);
const VisitorHourlyHeatmap = dynamic(
  () => import('./charts').then((m) => ({ default: m.VisitorHourlyHeatmap })),
  { ssr: false },
);

const RANGE_OPTIONS = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

// ISO 3166-1 alpha-2 → country name (subset most relevant to TZ market)
const COUNTRY_NAMES: Record<string, string> = {
  TZ: 'Tanzania', KE: 'Kenya', UG: 'Uganda', RW: 'Rwanda', BI: 'Burundi',
  ZM: 'Zambia', MW: 'Malawi', MZ: 'Mozambique', ZA: 'South Africa', ET: 'Ethiopia',
  US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  IT: 'Italy', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden', AE: 'UAE',
  IN: 'India', CN: 'China', JP: 'Japan', AU: 'Australia', CA: 'Canada',
  NG: 'Nigeria', GH: 'Ghana', EG: 'Egypt', SA: 'Saudi Arabia', QA: 'Qatar',
};
const flagEmoji = (cc: string) => cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

function ChangeBadge({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-[hsl(var(--muted-foreground))]">
        <Minus className="w-3 h-3" /> 0%
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {positive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value)}%
    </span>
  );
}

interface Overview {
  pageViews: number;
  uniqueVisitors: number;
  avgPagesPerSession: number;
  changes: { pageViews: number; uniqueVisitors: number };
}

export default function VisitorAnalyticsPage() {
  const [range, setRange] = useState<string>('7d');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [topPages, setTopPages] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [devices, setDevices] = useState<{ devices: any[]; browsers: any[]; operatingSystems: any[] }>({ devices: [], browsers: [], operatingSystems: [] });
  const [referrers, setReferrers] = useState<any[]>([]);
  const [hourly, setHourly] = useState<any[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = { range };
      const [ov, ts, pages, ctry, dev, refs, hr] = await Promise.all([
        adminApi.getVisitorOverview(params),
        adminApi.getVisitorTimeseries(params),
        adminApi.getVisitorTopPages(params),
        adminApi.getVisitorCountries(params),
        adminApi.getVisitorDevices(params),
        adminApi.getVisitorReferrers(params),
        adminApi.getVisitorHourly(params),
      ]);
      setOverview(ov);
      setTimeseries(Array.isArray(ts) ? ts : []);
      setTopPages(Array.isArray(pages) ? pages : []);
      setCountries(Array.isArray(ctry) ? ctry : []);
      setDevices(dev || { devices: [], browsers: [], operatingSystems: [] });
      setReferrers(Array.isArray(refs) ? refs : []);
      setHourly(Array.isArray(hr) ? hr : []);
    } catch {
      // Silent — show empty states
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalCountryViews = countries.reduce((s, c) => s + (c.views || 0), 0);
  const cardClass = 'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Eye className="w-6 h-6 text-brand-gold" />
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Visitor Analytics</h1>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 max-w-2xl">
            Anonymous traffic insights for your storefront — pages visited, where visitors come from, what device they use, and when they browse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label="Date range"
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-brand-gold/50"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && !overview ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Page views</p>
                  <p className="text-3xl font-bold text-[hsl(var(--foreground))] mt-1">
                    {(overview?.pageViews ?? 0).toLocaleString()}
                  </p>
                </div>
                <Eye className="w-5 h-5 text-brand-gold" />
              </div>
              {overview && <ChangeBadge value={overview.changes.pageViews} />}
            </div>
            <div className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Unique visitors</p>
                  <p className="text-3xl font-bold text-[hsl(var(--foreground))] mt-1">
                    {(overview?.uniqueVisitors ?? 0).toLocaleString()}
                  </p>
                </div>
                <Users className="w-5 h-5 text-brand-gold" />
              </div>
              {overview && <ChangeBadge value={overview.changes.uniqueVisitors} />}
            </div>
            <div className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Avg pages/visit</p>
                  <p className="text-3xl font-bold text-[hsl(var(--foreground))] mt-1">
                    {(overview?.avgPagesPerSession ?? 0).toFixed(1)}
                  </p>
                </div>
                <MousePointerClick className="w-5 h-5 text-brand-gold" />
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">how deep they explore per session</p>
            </div>
          </div>

          {/* Timeseries */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-[hsl(var(--foreground))]">Traffic over time</h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Daily page views and unique visitors</p>
              </div>
              <TrendingUp className="w-4 h-4 text-brand-gold" />
            </div>
            <VisitorTimeseriesChart data={timeseries} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top pages */}
            <div className={cardClass}>
              <h2 className="font-semibold text-[hsl(var(--foreground))] mb-4">Top pages</h2>
              {topPages.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {topPages.slice(0, 10).map((p) => {
                    const pct = topPages[0]?.views ? (p.views / topPages[0].views) * 100 : 0;
                    return (
                      <div key={p.path}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-mono text-xs truncate text-[hsl(var(--foreground))]">{p.path}</span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))] ml-2">{p.views.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-[hsl(var(--muted))] rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-brand-gold rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Countries */}
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[hsl(var(--foreground))]">Visitors by country</h2>
                <Globe className="w-4 h-4 text-brand-gold" />
              </div>
              {countries.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No geographic data yet.</p>
              ) : (
                <div className="space-y-2">
                  {countries.slice(0, 10).map((c) => {
                    const pct = totalCountryViews ? (c.views / totalCountryViews) * 100 : 0;
                    return (
                      <div key={c.country}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[hsl(var(--foreground))]">
                            <span className="mr-2">{c.country ? flagEmoji(c.country) : '🏳️'}</span>
                            {COUNTRY_NAMES[c.country] || c.country || 'Unknown'}
                          </span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {c.views.toLocaleString()} <span className="text-[hsl(var(--muted-foreground))]/60">({pct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-[hsl(var(--muted))] rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-brand-gold rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Devices */}
            <div className={cardClass}>
              <h2 className="font-semibold text-[hsl(var(--foreground))] mb-4">Devices</h2>
              <VisitorDeviceDonut data={devices.devices} />
            </div>
            {/* Browsers */}
            <div className={cardClass}>
              <h2 className="font-semibold text-[hsl(var(--foreground))] mb-4">Browsers</h2>
              <VisitorBrowserBars data={devices.browsers} />
            </div>
            {/* Operating systems */}
            <div className={cardClass}>
              <h2 className="font-semibold text-[hsl(var(--foreground))] mb-4">Operating systems</h2>
              <VisitorBrowserBars data={devices.operatingSystems} />
            </div>
          </div>

          {/* Hourly heatmap */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-[hsl(var(--foreground))]">When do they visit?</h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Day of week × hour of day. Darker = more views.</p>
              </div>
            </div>
            <VisitorHourlyHeatmap data={hourly} />
          </div>

          {/* Referrers */}
          <div className={cardClass}>
            <h2 className="font-semibold text-[hsl(var(--foreground))] mb-4">Top referrers</h2>
            {referrers.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">No referrer data yet (most visitors come direct).</p>
            ) : (
              <div className="space-y-1.5">
                {referrers.slice(0, 10).map((r) => (
                  <div key={r.referrer} className="flex items-center justify-between text-sm py-1.5 border-b border-[hsl(var(--border))]/50 last:border-b-0">
                    <span className="text-[hsl(var(--foreground))] truncate text-xs">{r.referrer}</span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))] ml-2 whitespace-nowrap">{r.views.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

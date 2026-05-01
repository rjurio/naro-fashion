'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
} from 'recharts';

const GOLD = '#D4AF37';
const DARK = '#1A1A1A';
const COLORS = [GOLD, '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'];

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-lg text-sm">
      <p className="font-medium text-[hsl(var(--foreground))] mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="text-xs">
          {p.name}: {Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export function VisitorTimeseriesChart({ data }: { data: { date: string; views: number; sessions: number }[] }) {
  if (!data.length) {
    return <div className="h-64 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No traffic in this range yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="vViews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={GOLD} stopOpacity={0.4} />
            <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="vSessions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <Tooltip content={<Tip />} />
        <Legend wrapperStyle={{ fontSize: '12px' }} />
        <Area type="monotone" dataKey="views" name="Page views" stroke={GOLD} fill="url(#vViews)" strokeWidth={2} />
        <Area type="monotone" dataKey="sessions" name="Unique visitors" stroke="#3B82F6" fill="url(#vSessions)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VisitorDeviceDonut({ data }: { data: { name: string; views: number }[] }) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No device data yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="views"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={75}
          paddingAngle={2}
          label={(entry: any) => entry.name}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<Tip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VisitorBrowserBars({ data }: { data: { name: string; views: number }[] }) {
  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No data yet.</div>;
  }
  const sorted = [...data].sort((a, b) => b.views - a.views).slice(0, 8);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={sorted} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
        <Tooltip content={<Tip />} />
        <Bar dataKey="views" fill={GOLD} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function VisitorHourlyHeatmap({ data }: { data: { dow: number; hour: number; views: number }[] }) {
  // Build a 7×24 grid
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const d of data) {
    if (d.dow >= 0 && d.dow < 7 && d.hour >= 0 && d.hour < 24) {
      grid[d.dow][d.hour] = d.views;
      if (d.views > max) max = d.views;
    }
  }

  const cellColor = (v: number) => {
    if (v === 0) return 'rgba(212, 175, 55, 0.05)';
    const intensity = Math.min(v / Math.max(max, 1), 1);
    // brand-gold with variable opacity
    return `rgba(212, 175, 55, ${0.15 + intensity * 0.85})`;
  };

  if (max === 0) {
    return <div className="h-32 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">No traffic data to map yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Hour labels */}
        <div className="flex pl-12 mb-1">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[10px] text-[hsl(var(--muted-foreground))]">
              {h % 3 === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>
        {grid.map((row, dow) => (
          <div key={dow} className="flex items-center mb-0.5">
            <div className="w-12 text-xs text-[hsl(var(--muted-foreground))] pr-2 text-right">{DOW_LABELS[dow]}</div>
            {row.map((v, h) => (
              <div
                key={h}
                className="flex-1 aspect-square rounded-sm mx-px"
                style={{ backgroundColor: cellColor(v), minWidth: '14px', maxWidth: '32px' }}
                title={`${DOW_LABELS[dow]} ${h}:00 — ${v} views`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

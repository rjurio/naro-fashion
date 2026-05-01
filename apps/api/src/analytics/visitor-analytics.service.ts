import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import * as geoip from 'geoip-lite';

// Cheap regex-based UA parser — no third-party dep.
// We only need coarse buckets for the dashboard, not perfect coverage.
function parseUserAgent(ua: string | undefined | null): {
  deviceType: string;
  browser: string;
  os: string;
  isBot: boolean;
} {
  const u = (ua || '').toLowerCase();

  const isBot =
    /bot|crawler|spider|crawling|slurp|baiduspider|yandex|googlebot|bingbot|duckduckbot|facebookexternalhit|twitterbot|slackbot|telegrambot|whatsapp|preview/i.test(
      u,
    );

  let deviceType: string;
  if (isBot) {
    deviceType = 'bot';
  } else if (/ipad|tablet|kindle|playbook/.test(u)) {
    deviceType = 'tablet';
  } else if (/mobile|android|iphone|ipod|webos|blackberry|opera mini/.test(u)) {
    deviceType = 'mobile';
  } else {
    deviceType = 'desktop';
  }

  let browser = 'Other';
  if (/edg\//.test(u)) browser = 'Edge';
  else if (/opr\/|opera/.test(u)) browser = 'Opera';
  else if (/chrome|crios/.test(u)) browser = 'Chrome';
  else if (/firefox|fxios/.test(u)) browser = 'Firefox';
  else if (/safari/.test(u)) browser = 'Safari';
  else if (/msie|trident/.test(u)) browser = 'IE';

  let os = 'Other';
  if (/windows/.test(u)) os = 'Windows';
  else if (/mac os x|macintosh/.test(u)) os = 'macOS';
  else if (/iphone|ipad|ipod/.test(u)) os = 'iOS';
  else if (/android/.test(u)) os = 'Android';
  else if (/linux/.test(u)) os = 'Linux';

  return { deviceType, browser, os, isBot };
}

function lookupGeo(ip: string | undefined): { country: string | null; city: string | null } {
  if (!ip) return { country: null, city: null };
  // Strip IPv4-mapped IPv6 prefix
  const clean = ip.replace(/^::ffff:/, '');
  // localhost / private IPs return null from geoip
  if (clean === '127.0.0.1' || clean === '::1' || clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('172.')) {
    return { country: null, city: null };
  }
  try {
    const result = geoip.lookup(clean);
    if (!result) return { country: null, city: null };
    return { country: result.country || null, city: result.city || null };
  } catch {
    return { country: null, city: null };
  }
}

// Sanitize the path — drop query, fragment, and clamp length.
function normalizePath(input: string | undefined): string {
  if (!input || typeof input !== 'string') return '/';
  let p = input.trim();
  if (!p.startsWith('/')) p = '/' + p;
  // Strip query and fragment
  p = p.split('?')[0].split('#')[0];
  // Clamp very long paths (defensive cap)
  if (p.length > 500) p = p.substring(0, 500);
  return p;
}

// Trim referrer to scheme+host+path, drop querystring and fragment.
function normalizeReferrer(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return `${u.origin}${u.pathname}`.substring(0, 500);
  } catch {
    return trimmed.substring(0, 500);
  }
}

interface RangeQuery {
  range?: '24h' | '7d' | '30d' | '90d';
  from?: string;
  to?: string;
}

function resolveRange(q: RangeQuery): { from: Date; to: Date } {
  const to = q.to ? new Date(q.to) : new Date();
  if (q.from) return { from: new Date(q.from), to };
  const days =
    q.range === '24h' ? 1 : q.range === '7d' ? 7 : q.range === '90d' ? 90 : 30;
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
}

@Injectable()
export class VisitorAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  // -------- Public tracking endpoint --------

  async track(payload: {
    tenantId: string;
    sessionId: string;
    userId?: string | null;
    path: string;
    referrer?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    if (!payload.tenantId || !payload.sessionId) return { ok: false };

    const { deviceType, browser, os, isBot } = parseUserAgent(payload.userAgent);

    // Drop bot traffic at the gate — keeps dashboards focused on humans.
    if (isBot) return { ok: true, skipped: 'bot' };

    const { country, city } = lookupGeo(payload.ip ?? undefined);

    await this.prisma.pageView.create({
      data: {
        tenantId: payload.tenantId,
        sessionId: payload.sessionId.substring(0, 100),
        userId: payload.userId || null,
        path: normalizePath(payload.path),
        referrer: normalizeReferrer(payload.referrer),
        country,
        city,
        deviceType,
        browser,
        os,
        isBot: false,
      },
    });

    return { ok: true };
  }

  // -------- Admin stats endpoints --------

  async overview(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = from;

    const [pageViews, prevPageViews, sessions, prevSessions] = await Promise.all([
      this.prisma.pageView.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.pageView.count({ where: { tenantId, createdAt: { gte: prevFrom, lte: prevTo } } }),
      this.prisma.pageView
        .findMany({
          where: { tenantId, createdAt: { gte: from, lte: to } },
          select: { sessionId: true },
          distinct: ['sessionId'],
        })
        .then((r) => r.length),
      this.prisma.pageView
        .findMany({
          where: { tenantId, createdAt: { gte: prevFrom, lte: prevTo } },
          select: { sessionId: true },
          distinct: ['sessionId'],
        })
        .then((r) => r.length),
    ]);

    const avgPagesPerSession = sessions > 0 ? pageViews / sessions : 0;

    const pct = (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 100);
    };

    return {
      pageViews,
      uniqueVisitors: sessions,
      avgPagesPerSession: Math.round(avgPagesPerSession * 10) / 10,
      changes: {
        pageViews: pct(pageViews, prevPageViews),
        uniqueVisitors: pct(sessions, prevSessions),
      },
      range: { from, to },
    };
  }

  async timeseries(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);

    // Bucket by day in a single SQL groupBy. Returns one row per day with views + sessions.
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; views: bigint; sessions: bigint }>
    >`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COUNT(*)::bigint AS views,
        COUNT(DISTINCT "sessionId")::bigint AS sessions
      FROM "PageView"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${to}
      GROUP BY day
      ORDER BY day ASC
    `;

    return rows.map((r) => ({
      date: r.day.toISOString().split('T')[0],
      views: Number(r.views),
      sessions: Number(r.sessions),
    }));
  }

  async topPages(query: RangeQuery & { limit?: number }) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);
    const limit = Math.min(query.limit ?? 10, 50);

    const rows = await this.prisma.pageView.groupBy({
      by: ['path'],
      where: { tenantId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      orderBy: { _count: { path: 'desc' } },
      take: limit,
    });

    return rows.map((r) => ({ path: r.path, views: r._count._all }));
  }

  async countries(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);

    const rows = await this.prisma.pageView.groupBy({
      by: ['country'],
      where: { tenantId, createdAt: { gte: from, lte: to }, country: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { country: 'desc' } },
      take: 20,
    });

    return rows.map((r) => ({ country: r.country, views: r._count._all }));
  }

  async devices(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);

    const [deviceRows, browserRows, osRows] = await Promise.all([
      this.prisma.pageView.groupBy({
        by: ['deviceType'],
        where: { tenantId, createdAt: { gte: from, lte: to }, deviceType: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.pageView.groupBy({
        by: ['browser'],
        where: { tenantId, createdAt: { gte: from, lte: to }, browser: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.pageView.groupBy({
        by: ['os'],
        where: { tenantId, createdAt: { gte: from, lte: to }, os: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      devices: deviceRows.map((r) => ({ name: r.deviceType, views: r._count._all })),
      browsers: browserRows.map((r) => ({ name: r.browser, views: r._count._all })),
      operatingSystems: osRows.map((r) => ({ name: r.os, views: r._count._all })),
    };
  }

  async referrers(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);

    const rows = await this.prisma.pageView.groupBy({
      by: ['referrer'],
      where: { tenantId, createdAt: { gte: from, lte: to }, referrer: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referrer: 'desc' } },
      take: 15,
    });

    return rows.map((r) => ({ referrer: r.referrer, views: r._count._all }));
  }

  async hourly(query: RangeQuery) {
    const tenantId = this.tenantContext.requireId;
    const { from, to } = resolveRange(query);

    // Day-of-week × hour-of-day heatmap. Postgres dow: 0=Sunday..6=Saturday.
    const rows = await this.prisma.$queryRaw<
      Array<{ dow: number; hour: number; views: bigint }>
    >`
      SELECT
        EXTRACT(DOW FROM "createdAt")::int AS dow,
        EXTRACT(HOUR FROM "createdAt")::int AS hour,
        COUNT(*)::bigint AS views
      FROM "PageView"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${to}
      GROUP BY dow, hour
      ORDER BY dow, hour
    `;

    return rows.map((r) => ({ dow: r.dow, hour: r.hour, views: Number(r.views) }));
  }
}

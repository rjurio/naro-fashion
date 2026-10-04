import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_PAGEVIEW_RETENTION_DAYS = 400;
const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 200; // ≤1M rows per night; the rest goes tomorrow

export function resolveRetentionDays(raw: string | undefined): number {
  const n = Number(raw);
  // Never accept < 30 days — a typo must not wipe the analytics history.
  if (!Number.isFinite(n) || n < 30) return DEFAULT_PAGEVIEW_RETENTION_DAYS;
  return Math.floor(n);
}

/**
 * Nightly PageView pruning. `POST /analytics/track` inserts one row per
 * storefront route change for every tenant, forever — without retention the
 * table (and its 4 composite indexes) grows unbounded on a 64GB VPS.
 *
 * Deletes rows older than `PAGEVIEW_RETENTION_DAYS` (default 400 — keeps a
 * full year plus the dashboard's 90-day prev-period comparison) in batches
 * of 5000 ids so no single statement holds long locks or bloats WAL.
 *
 * Deliberately a SEPARATE singleton: VisitorAnalyticsService injects the
 * request-scoped TenantContext, and @Cron handlers on request-scoped
 * providers are never registered by @nestjs/schedule.
 */
@Injectable()
export class PageViewRetentionService {
  private readonly logger = new Logger(PageViewRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *', { name: 'pageview-retention' })
  async handleCron() {
    await this.prune();
  }

  async prune(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const days = resolveRetentionDays(process.env.PAGEVIEW_RETENTION_DAYS);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const batch = await this.prisma.pageView.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (batch.length === 0) break;
        const res = await this.prisma.pageView.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        total += res.count;
        if (batch.length < BATCH_SIZE) break;
      }
      if (total > 0) {
        this.logger.log(`Pruned ${total} PageView rows older than ${days} days (< ${cutoff.toISOString()})`);
      }
    } catch (err) {
      this.logger.error(`PageView retention failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return total;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { resolveIdempotencyRetentionDays } from './idempotency.util';

const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 100;

/**
 * Nightly IdempotencyKey pruning (`IDEMPOTENCY_RETENTION_DAYS`, default 30).
 * An offline device replays its queue within the retention window; after
 * that a key is just dead weight. Batched like PageViewRetentionService.
 *
 * SINGLETON (PrismaService only) — @Cron on a request-scoped provider is
 * never registered (see common/request-scope-lifecycle.shape.spec.ts).
 * Runs outside a request, so the tenant-scope guard does not apply.
 */
@Injectable()
export class IdempotencyRetentionService {
  private readonly logger = new Logger(IdempotencyRetentionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('45 3 * * *', { name: 'idempotency-retention' })
  async handleCron() {
    await this.prune();
  }

  async prune(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const days = resolveIdempotencyRetentionDays(process.env.IDEMPOTENCY_RETENTION_DAYS);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const batch = await this.prisma.idempotencyKey.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (batch.length === 0) break;
        const res = await this.prisma.idempotencyKey.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        total += res.count;
        if (batch.length < BATCH_SIZE) break;
      }
      if (total > 0) {
        this.logger.log(`Pruned ${total} IdempotencyKey rows older than ${days} days`);
      }
    } catch (err) {
      this.logger.error(`Idempotency retention failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return total;
  }
}

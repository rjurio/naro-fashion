import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  UNPAID_PAYMENT_STATUSES,
  releasePromoUsage,
  restockOrderItems,
} from './order-lifecycle.util';

/**
 * Auto-cancels abandoned online orders so their reserved stock goes back on
 * sale. An order qualifies when ALL of:
 *   - channel ONLINE, status PENDING, paymentStatus unpaid
 *   - paymentMethod is NOT CASH_ON_DELIVERY (COD is legitimately unpaid
 *     until delivery; it's bounded by MAX_OPEN_COD_ORDERS at create time)
 *   - older than ORDER_PAYMENT_TTL_HOURS (default 24)
 *   - no PENDING/PROCESSING Payment touched in the last 30 minutes (a
 *     customer may be mid Mobile-Money PIN prompt; reconciliation owns it)
 *
 * Runs across all tenants (no request → no TenantContext); every write is
 * scoped by the order's own tenantId. The cancel uses the same conditional
 * flip + restock-only-if-won pattern as OrdersService.updateStatus, so a
 * payment landing concurrently (paymentStatus no longer unpaid) or an admin
 * acting on the order makes the flip a no-op.
 */
@Injectable()
export class OrderExpiryCron {
  private readonly logger = new Logger(OrderExpiryCron.name);
  private running = false;
  static readonly BATCH = 200;
  static readonly RECENT_PAYMENT_MINUTES = 30;

  constructor(private readonly prisma: PrismaService) {}

  ttlHours(): number {
    const n = Number(process.env.ORDER_PAYMENT_TTL_HOURS);
    return Number.isFinite(n) && n > 0 ? n : 24;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.expireStaleOrders();
      if (n > 0) this.logger.log(`Auto-cancelled ${n} unpaid order(s) older than ${this.ttlHours()}h`);
    } catch (err: any) {
      this.logger.error(`Order expiry sweep failed: ${err?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns the number of orders cancelled. Exposed for tests. */
  async expireStaleOrders(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.ttlHours() * 3600_000);
    const recentPaymentCutoff = new Date(now.getTime() - OrderExpiryCron.RECENT_PAYMENT_MINUTES * 60_000);

    const candidates = await this.prisma.order.findMany({
      where: {
        channel: 'ONLINE',
        status: 'PENDING',
        paymentStatus: { in: UNPAID_PAYMENT_STATUSES },
        paymentMethod: { not: 'CASH_ON_DELIVERY' },
        createdAt: { lt: cutoff },
        tenantId: { not: null },
      },
      select: { id: true, tenantId: true, promoCodeId: true },
      orderBy: { createdAt: 'asc' },
      take: OrderExpiryCron.BATCH,
    });

    let cancelled = 0;
    for (const order of candidates) {
      const tenantId = order.tenantId as string;
      try {
        const inFlight = await this.prisma.payment.count({
          where: {
            orderId: order.id,
            tenantId,
            status: { in: ['PENDING', 'PROCESSING'] },
            OR: [{ createdAt: { gte: recentPaymentCutoff } }, { updatedAt: { gte: recentPaymentCutoff } }],
          },
        });
        if (inFlight > 0) continue;

        const won = await this.prisma.$transaction(async (tx) => {
          const flipped = await tx.order.updateMany({
            where: {
              id: order.id,
              tenantId,
              status: 'PENDING',
              paymentStatus: { in: UNPAID_PAYMENT_STATUSES },
            },
            data: { status: 'CANCELLED', paymentStatus: 'CANCELLED' },
          });
          if (flipped.count !== 1) return false;
          await restockOrderItems(tx, order.id, tenantId, 'Order auto-cancelled (unpaid) — reserved stock restored');
          await releasePromoUsage(tx, order, tenantId);
          return true;
        });
        if (won) cancelled++;
      } catch (err: any) {
        this.logger.warn(`Failed to expire order ${order.id}: ${err?.message ?? err}`);
      }
    }
    return cancelled;
  }
}

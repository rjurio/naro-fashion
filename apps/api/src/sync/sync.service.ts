import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

export interface SyncChangesResult {
  serverTime: string;
  since: string;
  changes: {
    products: number;
    categories: number;
    orders: number;
    rentals: number;
    expenses: number;
  };
  total: number;
}

/**
 * Admin offline mode: "is there newer data online?" Counts rows of this
 * tenant whose updatedAt is after `since`. Soft-deleted rows are included on
 * purpose (a delete is a change). BusinessExpense is hard-deleted, so expense
 * deletions are not visible here.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async changes(sinceRaw: string, now: Date = new Date()): Promise<SyncChangesResult> {
    const tenantId = this.tenantContext.requireId;
    const parsed = new Date(sinceRaw);
    if (!sinceRaw || Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('since must be a valid ISO date');
    }
    // A device clock ahead of the server must not hide changes forever.
    const since = parsed.getTime() > now.getTime() ? now : parsed;
    const where = { tenantId, updatedAt: { gt: since } };

    const [products, categories, orders, rentals, expenses] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.category.count({ where }),
      this.prisma.order.count({ where }),
      this.prisma.rentalOrder.count({ where }),
      this.prisma.businessExpense.count({ where }),
    ]);

    return {
      serverTime: now.toISOString(),
      since: since.toISOString(),
      changes: { products, categories, orders, rentals, expenses },
      total: products + categories + orders + rentals + expenses,
    };
  }
}

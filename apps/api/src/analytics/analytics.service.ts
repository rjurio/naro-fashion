import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RevenuePeriod = 'daily' | 'weekly' | 'monthly';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const [
      totalRevenue,
      orderCount,
      customerCount,
      activeRentals,
    ] = await Promise.all([
      this.prisma.order
        .aggregate({
          _sum: { total: true },
          where: { status: { not: 'CANCELLED' } },
        })
        .then((r) => r._sum?.total ?? 0),

      this.prisma.order.count({
        where: { status: { not: 'CANCELLED' } },
      }),

      this.prisma.user.count(),

      this.prisma.rentalOrder.count({
        where: { status: 'ACTIVE' },
      }),
    ]);

    return {
      totalRevenue,
      orderCount,
      customerCount,
      activeRentals,
    };
  }

  async getRevenue(period: RevenuePeriod) {
    const now = new Date();
    let startDate: Date;
    let groupByFormat: string;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        groupByFormat = 'day';
        break;
      case 'weekly':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        groupByFormat = 'week';
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        groupByFormat = 'month';
        break;
    }

    // Use raw query for date-based grouping
    const results = await this.prisma.$queryRaw<
      Array<{ period: string; revenue: number; count: number }>
    >`
      SELECT
        DATE_TRUNC(${groupByFormat}, "createdAt") AS "period",
        COALESCE(SUM("total"), 0) AS "revenue",
        COUNT(*)::int AS "count"
      FROM "Order"
      WHERE "createdAt" >= ${startDate}
        AND "status" != 'CANCELLED'
      GROUP BY DATE_TRUNC(${groupByFormat}, "createdAt")
      ORDER BY "period" ASC
    `;

    return { period, data: results };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RevenuePeriod = 'daily' | 'weekly' | 'monthly';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const sixtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);

    const [
      totalRevenue,
      orderCount,
      customerCount,
      activeRentals,
      prevPeriodRevenue,
      prevPeriodOrders,
      rentalRevenue,
      prevRentalRevenue,
      avgOrderValue,
      topProducts,
      categoryBreakdown,
      orderStatusDist,
      paymentMethodDist,
      customerGrowth,
      rentalStats,
      recentOrders,
    ] = await Promise.all([
      // Current period revenue
      this.prisma.order
        .aggregate({
          _sum: { total: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: thirtyDaysAgo } },
        })
        .then((r) => Number(r._sum?.total ?? 0)),

      // Current period order count
      this.prisma.order.count({
        where: { status: { not: 'CANCELLED' }, createdAt: { gte: thirtyDaysAgo } },
      }),

      // Total customers
      this.prisma.user.count(),

      // Active rentals
      this.prisma.rentalOrder.count({
        where: { status: 'ACTIVE' },
      }),

      // Previous period revenue (for comparison)
      this.prisma.order
        .aggregate({
          _sum: { total: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        })
        .then((r) => Number(r._sum?.total ?? 0)),

      // Previous period orders
      this.prisma.order.count({
        where: { status: { not: 'CANCELLED' }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Rental revenue
      this.prisma.rentalOrder
        .aggregate({
          _sum: { totalRentalPrice: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: thirtyDaysAgo } },
        })
        .then((r) => Number(r._sum?.totalRentalPrice ?? 0)),

      // Previous rental revenue
      this.prisma.rentalOrder
        .aggregate({
          _sum: { totalRentalPrice: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        })
        .then((r) => Number(r._sum?.totalRentalPrice ?? 0)),

      // Average order value
      this.prisma.order
        .aggregate({
          _avg: { total: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: thirtyDaysAgo } },
        })
        .then((r) => Number(r._avg?.total ?? 0)),

      // Top products by revenue (via order items)
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { subtotal: true, quantity: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 10,
      }),

      // Category breakdown
      this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>`
        SELECT c."name", COALESCE(SUM(oi."subtotal"), 0)::float AS "revenue"
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p."id"
        JOIN "Category" c ON p."categoryId" = c."id"
        JOIN "Order" o ON oi."orderId" = o."id"
        WHERE o."status" != 'CANCELLED'
        GROUP BY c."name"
        ORDER BY "revenue" DESC
        LIMIT 6
      `,

      // Order status distribution
      this.prisma.order.groupBy({
        by: ['status'],
        _count: true,
      }),

      // Payment method distribution
      this.prisma.order.groupBy({
        by: ['paymentMethod'],
        _count: true,
        _sum: { total: true },
      }),

      // Customer growth (last 6 months)
      this.prisma.$queryRaw<Array<{ month: string; count: number }>>`
        SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon') AS "month",
               COUNT(*)::int AS "count"
        FROM "User"
        WHERE "createdAt" >= ${new Date(now.getFullYear(), now.getMonth() - 6, 1)}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt") ASC
      `,

      // Rental stats
      this.prisma.rentalOrder.groupBy({
        by: ['status'],
        _count: true,
      }),

      // Recent orders count by day (last 14 days)
      this.prisma.$queryRaw<Array<{ day: string; count: number; revenue: number }>>`
        SELECT TO_CHAR("createdAt"::date, 'Mon DD') AS "day",
               COUNT(*)::int AS "count",
               COALESCE(SUM("total"), 0)::float AS "revenue"
        FROM "Order"
        WHERE "createdAt" >= ${new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)}
          AND "status" != 'CANCELLED'
        GROUP BY "createdAt"::date
        ORDER BY "createdAt"::date ASC
      `,
    ]);

    // Enrich top products with names
    const productIds = topProducts.map((p) => p.productId);
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, availabilityMode: true, categoryId: true },
          take: 10,
        })
      : [];

    const productMap = new Map(products.map((p) => [p.id, p]));
    const enrichedTopProducts = topProducts.map((tp) => {
      const prod = productMap.get(tp.productId);
      return {
        name: prod?.name || 'Unknown Product',
        revenue: Number(tp._sum.subtotal ?? 0),
        units: Number(tp._sum.quantity ?? 0),
        type: prod?.availabilityMode || 'PURCHASE_ONLY',
      };
    });

    // Calculate percentage changes
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? '+100%' : '0%';
      const pct = ((current - previous) / previous) * 100;
      return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    };

    // Category breakdown with percentages
    const totalCategoryRevenue = categoryBreakdown.reduce((sum, c) => sum + Number(c.revenue), 0);
    const categoryWithPct = categoryBreakdown.map((c) => ({
      name: c.name,
      revenue: Number(c.revenue),
      percentage: totalCategoryRevenue > 0 ? Math.round((Number(c.revenue) / totalCategoryRevenue) * 100) : 0,
    }));

    return {
      totalRevenue,
      totalOrders: orderCount,
      customerCount,
      activeRentals,
      rentalRevenue,
      avgOrderValue: Math.round(avgOrderValue),
      revenueChange: calcChange(totalRevenue, prevPeriodRevenue),
      ordersChange: calcChange(orderCount, prevPeriodOrders),
      rentalRevenueChange: calcChange(rentalRevenue, prevRentalRevenue),
      avgOrderValueChange: calcChange(avgOrderValue, avgOrderValue),
      topProducts: enrichedTopProducts,
      categoryBreakdown: categoryWithPct,
      orderStatusDistribution: orderStatusDist.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      paymentMethodDistribution: paymentMethodDist.map((p) => ({
        method: p.paymentMethod,
        count: p._count,
        total: Number(p._sum.total ?? 0),
      })),
      customerGrowth,
      rentalStatusDistribution: rentalStats.map((r) => ({
        status: r.status,
        count: r._count,
      })),
      dailyOrders: recentOrders,
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

    // Orders revenue
    const orderResults = await this.prisma.$queryRaw<
      Array<{ period: string; revenue: number; count: number }>
    >`
      SELECT
        TO_CHAR(DATE_TRUNC(${groupByFormat}, "createdAt"), 'Mon') AS "period",
        COALESCE(SUM("total"), 0)::float AS "revenue",
        COUNT(*)::int AS "count"
      FROM "Order"
      WHERE "createdAt" >= ${startDate}
        AND "status" != 'CANCELLED'
      GROUP BY DATE_TRUNC(${groupByFormat}, "createdAt"), TO_CHAR(DATE_TRUNC(${groupByFormat}, "createdAt"), 'Mon')
      ORDER BY DATE_TRUNC(${groupByFormat}, "createdAt") ASC
    `;

    // Rental revenue
    const rentalResults = await this.prisma.$queryRaw<
      Array<{ period: string; revenue: number; count: number }>
    >`
      SELECT
        TO_CHAR(DATE_TRUNC(${groupByFormat}, "createdAt"), 'Mon') AS "period",
        COALESCE(SUM("totalRentalPrice"), 0)::float AS "revenue",
        COUNT(*)::int AS "count"
      FROM "RentalOrder"
      WHERE "createdAt" >= ${startDate}
        AND "status" != 'CANCELLED'
      GROUP BY DATE_TRUNC(${groupByFormat}, "createdAt"), TO_CHAR(DATE_TRUNC(${groupByFormat}, "createdAt"), 'Mon')
      ORDER BY DATE_TRUNC(${groupByFormat}, "createdAt") ASC
    `;

    // Merge into combined data
    const rentalMap = new Map(rentalResults.map((r) => [r.period, r]));
    const combined = orderResults.map((o) => ({
      month: o.period,
      sales: Number(o.revenue),
      rentals: Number(rentalMap.get(o.period)?.revenue ?? 0),
      orderCount: o.count,
      rentalCount: rentalMap.get(o.period)?.count ?? 0,
    }));

    return { period, data: combined };
  }
}

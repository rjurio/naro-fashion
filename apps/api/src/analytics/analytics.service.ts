import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RevenuePeriod = 'daily' | 'weekly' | 'monthly';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private calcChange(current: number, previous: number): string {
    if (previous === 0) return current > 0 ? '+100%' : '0%';
    const pct = ((current - previous) / previous) * 100;
    return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  async getDashboard() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const sixtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysFromNow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

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
      // Inventory KPIs
      lowStockProducts,
      outOfStockProducts,
      totalSkus,
      // Financial KPIs
      totalExpenses,
      // Order KPIs
      pendingOrders,
      cancelledOrders,
      totalOrdersAll,
      // Rental KPIs
      overdueRentals,
      upcomingReturns,
      // CMS/Events KPIs
      activeBanners,
      publishedPages,
      approvedEvents,
      pendingEvents,
      // New customers
      newCustomersThisPeriod,
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
      this.prisma.rentalOrder.count({ where: { status: 'ACTIVE' } }),

      // Previous period revenue
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

      // Low stock count (products where total variant stock < minimumStock)
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(DISTINCT p."id")::int AS "count"
        FROM "Product" p
        JOIN "ProductVariant" pv ON pv."productId" = p."id"
        WHERE p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY p."id", p."minimumStock"
        HAVING SUM(pv."stock") > 0 AND SUM(pv."stock") < p."minimumStock"
      `.then((rows) => rows.length),

      // Out of stock count
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(DISTINCT p."id")::int AS "count"
        FROM "Product" p
        LEFT JOIN "ProductVariant" pv ON pv."productId" = p."id"
        WHERE p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY p."id"
        HAVING COALESCE(SUM(pv."stock"), 0) = 0
      `.then((rows) => rows.length),

      // Total SKUs
      this.prisma.product.count({ where: { deletedAt: null, isActive: true } }),

      // Total expenses this month
      this.prisma.businessExpense
        .aggregate({
          _sum: { amount: true },
          where: { expenseDate: { gte: thisMonthStart } },
        })
        .then((r) => Number(r._sum?.amount ?? 0)),

      // Pending orders
      this.prisma.order.count({ where: { status: 'PENDING' } }),

      // Cancelled orders (last 30 days)
      this.prisma.order.count({
        where: { status: 'CANCELLED', createdAt: { gte: thirtyDaysAgo } },
      }),

      // Total orders last 30 days (including cancelled)
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),

      // Overdue rentals
      this.prisma.rentalOrder.count({ where: { status: 'OVERDUE' } }),

      // Upcoming returns (next 7 days)
      this.prisma.rentalOrder.count({
        where: {
          status: 'ACTIVE',
          returnDate: { gte: now, lte: sevenDaysFromNow },
        },
      }),

      // Active banners
      this.prisma.banner.count({ where: { isActive: true, deletedAt: null } }),

      // Published pages
      this.prisma.page.count({ where: { isPublished: true, deletedAt: null } }),

      // Approved events
      this.prisma.customerEvent.count({ where: { status: 'APPROVED', deletedAt: null } }),

      // Pending events
      this.prisma.customerEvent.count({ where: { status: 'PENDING_APPROVAL', deletedAt: null } }),

      // New customers this period
      this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    // COGS calculation (purchasePrice × quantity sold in last 30 days)
    const cogsResult = await this.prisma.$queryRaw<[{ cogs: number }]>`
      SELECT COALESCE(SUM(oi."quantity" * p."purchasePrice"), 0)::float AS "cogs"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p."id"
      JOIN "Order" o ON oi."orderId" = o."id"
      WHERE o."status" != 'CANCELLED'
        AND o."createdAt" >= ${thirtyDaysAgo}
        AND p."purchasePrice" IS NOT NULL
    `;
    const cogs = cogsResult[0]?.cogs ?? 0;
    const grossProfit = totalRevenue - cogs;
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100 * 10) / 10 : 0;
    const cancellationRate = totalOrdersAll > 0 ? Math.round((cancelledOrders / totalOrdersAll) * 100 * 10) / 10 : 0;

    return {
      totalRevenue,
      totalOrders: orderCount,
      customerCount,
      activeRentals,
      rentalRevenue,
      avgOrderValue: Math.round(avgOrderValue),
      revenueChange: this.calcChange(totalRevenue, prevPeriodRevenue),
      ordersChange: this.calcChange(orderCount, prevPeriodOrders),
      rentalRevenueChange: this.calcChange(rentalRevenue, prevRentalRevenue),
      avgOrderValueChange: this.calcChange(avgOrderValue, avgOrderValue),
      // New KPIs
      lowStockCount: lowStockProducts,
      outOfStockCount: outOfStockProducts,
      totalSkus,
      cogs,
      grossProfit,
      totalExpenses,
      netProfit,
      profitMargin,
      pendingOrders,
      cancellationRate,
      overdueRentals,
      upcomingReturns,
      newCustomersThisPeriod,
      activeBanners,
      publishedPages,
      approvedEvents,
      pendingEvents,
    };
  }

  async getSalesAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);

    const [
      topProducts,
      categoryBreakdown,
      orderStatusDist,
      paymentMethodDist,
      dailyOrders,
      recentOrders,
    ] = await Promise.all([
      // Top products by revenue
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { total: true, quantity: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),

      // Category breakdown
      this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>`
        SELECT c."name", COALESCE(SUM(oi."total"), 0)::float AS "revenue"
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p."id"
        JOIN "Category" c ON p."categoryId" = c."id"
        JOIN "Order" o ON oi."orderId" = o."id"
        WHERE o."status" != 'CANCELLED'
        GROUP BY c."name"
        ORDER BY "revenue" DESC
        LIMIT 8
      `,

      // Order status distribution
      this.prisma.order.groupBy({ by: ['status'], _count: true }),

      // Payment method distribution
      this.prisma.order.groupBy({
        by: ['paymentMethod'],
        _count: true,
        _sum: { total: true },
      }),

      // Daily orders (last 14 days)
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

      // Recent orders
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    // Enrich top products
    const productIds = topProducts.map((p) => p.productId);
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, availabilityMode: true, category: { select: { name: true } } },
        })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Low performers (bottom 5)
    const lowPerformers = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { total: true, quantity: true },
      orderBy: { _sum: { total: 'asc' } },
      take: 5,
    });
    const lowPerfIds = lowPerformers.map((p) => p.productId);
    const lowPerfProducts = lowPerfIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: lowPerfIds } },
          select: { id: true, name: true, category: { select: { name: true } } },
        })
      : [];
    const lowPerfMap = new Map(lowPerfProducts.map((p) => [p.id, p]));

    const totalCategoryRevenue = categoryBreakdown.reduce((sum, c) => sum + Number(c.revenue), 0);

    return {
      topProducts: topProducts.map((tp) => {
        const prod = productMap.get(tp.productId);
        return {
          name: prod?.name || 'Unknown',
          category: prod?.category?.name || 'N/A',
          revenue: Number(tp._sum.total ?? 0),
          units: Number(tp._sum.quantity ?? 0),
          type: prod?.availabilityMode || 'PURCHASE_ONLY',
        };
      }),
      lowPerformers: lowPerformers.map((tp) => {
        const prod = lowPerfMap.get(tp.productId);
        return {
          name: prod?.name || 'Unknown',
          category: prod?.category?.name || 'N/A',
          revenue: Number(tp._sum.total ?? 0),
          units: Number(tp._sum.quantity ?? 0),
        };
      }),
      categoryBreakdown: categoryBreakdown.map((c) => ({
        name: c.name,
        revenue: Number(c.revenue),
        percentage: totalCategoryRevenue > 0 ? Math.round((Number(c.revenue) / totalCategoryRevenue) * 100) : 0,
      })),
      orderStatusDistribution: orderStatusDist.map((s) => ({ status: s.status, count: s._count })),
      paymentMethodDistribution: paymentMethodDist.map((p) => ({
        method: p.paymentMethod,
        count: p._count,
        total: Number(p._sum.total ?? 0),
      })),
      dailyOrders,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customer: `${o.user?.firstName || ''} ${o.user?.lastName || ''}`.trim() || o.user?.email || 'N/A',
        total: Number(o.total),
        status: o.status,
        paymentMethod: o.paymentMethod,
        date: o.createdAt,
      })),
    };
  }

  async getRentalsAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const sevenDaysFromNow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

    const [
      rentalRevenue,
      activeRentals,
      overdueRentals,
      rentalStatusDist,
      totalRentalProducts,
      currentlyRentedProducts,
      upcomingReturnsList,
      avgDuration,
    ] = await Promise.all([
      this.prisma.rentalOrder
        .aggregate({
          _sum: { totalRentalPrice: true },
          where: { status: { not: 'CANCELLED' }, createdAt: { gte: thirtyDaysAgo } },
        })
        .then((r) => Number(r._sum?.totalRentalPrice ?? 0)),

      this.prisma.rentalOrder.count({ where: { status: 'ACTIVE' } }),
      this.prisma.rentalOrder.count({ where: { status: 'OVERDUE' } }),

      this.prisma.rentalOrder.groupBy({ by: ['status'], _count: true }),

      // Total rental-eligible products
      this.prisma.product.count({
        where: {
          deletedAt: null,
          isActive: true,
          availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
        },
      }),

      // Currently rented (distinct products)
      this.prisma.rentalOrder
        .groupBy({
          by: ['productId'],
          where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
        })
        .then((r) => r.length),

      // Upcoming returns
      this.prisma.rentalOrder.findMany({
        where: {
          status: 'ACTIVE',
          returnDate: { gte: now, lte: sevenDaysFromNow },
        },
        orderBy: { returnDate: 'asc' },
        take: 10,
        select: {
          id: true,
          rentalNumber: true,
          returnDate: true,
          totalRentalPrice: true,
          product: { select: { name: true } },
          user: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),

      // Average rental duration
      this.prisma.$queryRaw<[{ avg: number }]>`
        SELECT COALESCE(AVG(EXTRACT(DAY FROM ("returnDate" - "startDate"))), 0)::float AS "avg"
        FROM "RentalOrder"
        WHERE "status" != 'CANCELLED'
      `.then((r) => Math.round(r[0]?.avg ?? 0)),
    ]);

    const utilizationRate = totalRentalProducts > 0
      ? Math.round((currentlyRentedProducts / totalRentalProducts) * 100)
      : 0;

    return {
      rentalRevenue,
      activeRentals,
      overdueRentals,
      avgRentalDuration: avgDuration,
      utilizationRate,
      totalRentalProducts,
      currentlyRentedProducts,
      rentalStatusDistribution: rentalStatusDist.map((r) => ({ status: r.status, count: r._count })),
      upcomingReturns: upcomingReturnsList.map((r) => ({
        id: r.id,
        rentalNumber: r.rentalNumber,
        product: r.product.name,
        customer: `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim(),
        phone: r.user.phone,
        returnDate: r.returnDate,
        total: Number(r.totalRentalPrice),
      })),
    };
  }

  async getInventoryAnalytics() {
    const [
      totalSkus,
      inventoryValuation,
      stockDistribution,
      recentRestocks,
    ] = await Promise.all([
      this.prisma.product.count({ where: { deletedAt: null, isActive: true } }),

      // Inventory valuation
      this.prisma.$queryRaw<[{ costValue: number; retailValue: number }]>`
        SELECT
          COALESCE(SUM(pv."stock" * p."purchasePrice"), 0)::float AS "costValue",
          COALESCE(SUM(pv."stock" * pv."price"), 0)::float AS "retailValue"
        FROM "ProductVariant" pv
        JOIN "Product" p ON pv."productId" = p."id"
        WHERE p."deletedAt" IS NULL AND p."isActive" = true
      `.then((r) => r[0] || { costValue: 0, retailValue: 0 }),

      // Stock status distribution
      this.prisma.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT
          CASE
            WHEN COALESCE(total_stock, 0) = 0 THEN 'OUT'
            WHEN COALESCE(total_stock, 0) < p."minimumStock" THEN 'LOW'
            ELSE 'OK'
          END AS "status",
          COUNT(*)::int AS "count"
        FROM "Product" p
        LEFT JOIN (
          SELECT "productId", SUM("stock") AS total_stock
          FROM "ProductVariant"
          GROUP BY "productId"
        ) pv ON pv."productId" = p."id"
        WHERE p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY "status"
      `,

      // Recent restocks
      this.prisma.inventoryTransaction.findMany({
        where: { type: 'RESTOCK' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          quantityChange: true,
          quantityAfter: true,
          createdAt: true,
          performedBy: true,
          note: true,
          product: { select: { name: true } },
        },
      }),
    ]);

    // Resolve performedBy to admin names
    const adminIds = [...new Set(recentRestocks.map((r) => r.performedBy).filter(Boolean))] as string[];
    const admins = adminIds.length > 0
      ? await this.prisma.adminUser.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

    return {
      totalSkus,
      costValue: inventoryValuation.costValue,
      retailValue: inventoryValuation.retailValue,
      unrealizedProfit: inventoryValuation.retailValue - inventoryValuation.costValue,
      stockDistribution,
      recentRestocks: recentRestocks.map((r) => ({
        id: r.id,
        product: r.product.name,
        quantity: r.quantityChange,
        stockAfter: r.quantityAfter,
        date: r.createdAt,
        performedBy: r.performedBy ? adminMap.get(r.performedBy) || 'Unknown' : 'System',
        note: r.note,
      })),
    };
  }

  async getCustomersAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);

    const [
      totalCustomers,
      newThisMonth,
      customerGrowth,
      topCustomers,
      returningCustomers,
      totalWithOrders,
    ] = await Promise.all([
      this.prisma.user.count(),

      this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),

      // Customer growth (last 12 months)
      this.prisma.$queryRaw<Array<{ month: string; count: number }>>`
        SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YY') AS "month",
               COUNT(*)::int AS "count"
        FROM "User"
        WHERE "createdAt" >= ${new Date(now.getFullYear() - 1, now.getMonth(), 1)}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt") ASC
      `,

      // Top customers by spend
      this.prisma.$queryRaw<Array<{ id: string; name: string; email: string; total: number; orderCount: number }>>`
        SELECT u."id", CONCAT(u."firstName", ' ', u."lastName") AS "name",
               u."email", COALESCE(SUM(o."total"), 0)::float AS "total",
               COUNT(o."id")::int AS "orderCount"
        FROM "User" u
        JOIN "Order" o ON o."userId" = u."id"
        WHERE o."status" != 'CANCELLED'
        GROUP BY u."id", u."firstName", u."lastName", u."email"
        ORDER BY "total" DESC
        LIMIT 10
      `,

      // Returning customers (>1 order)
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(*)::int AS "count"
        FROM (
          SELECT "userId" FROM "Order" WHERE "status" != 'CANCELLED'
          GROUP BY "userId" HAVING COUNT(*) > 1
        ) sub
      `.then((r) => r[0]?.count ?? 0),

      // Total customers with at least 1 order
      this.prisma.$queryRaw<[{ count: number }]>`
        SELECT COUNT(DISTINCT "userId")::int AS "count"
        FROM "Order" WHERE "status" != 'CANCELLED'
      `.then((r) => r[0]?.count ?? 0),
    ]);

    const returningRate = totalWithOrders > 0
      ? Math.round((returningCustomers / totalWithOrders) * 100)
      : 0;

    return {
      totalCustomers,
      newThisMonth,
      returningRate,
      returningCustomers,
      customerGrowth,
      topCustomers,
    };
  }

  async getProductsAnalytics() {
    const [
      totalProducts,
      publishedProducts,
      categoryPerformance,
      topRated,
    ] = await Promise.all([
      this.prisma.product.count({ where: { deletedAt: null } }),

      this.prisma.product.count({ where: { deletedAt: null, isActive: true } }),

      // Category performance
      this.prisma.$queryRaw<Array<{ name: string; productCount: number; revenue: number; units: number }>>`
        SELECT c."name",
               COUNT(DISTINCT p."id")::int AS "productCount",
               COALESCE(SUM(oi."total"), 0)::float AS "revenue",
               COALESCE(SUM(oi."quantity"), 0)::int AS "units"
        FROM "Category" c
        LEFT JOIN "Product" p ON p."categoryId" = c."id" AND p."deletedAt" IS NULL
        LEFT JOIN "OrderItem" oi ON oi."productId" = p."id"
        LEFT JOIN "Order" o ON oi."orderId" = o."id" AND o."status" != 'CANCELLED'
        WHERE c."deletedAt" IS NULL
        GROUP BY c."id", c."name"
        ORDER BY "revenue" DESC
      `,

      // Top rated products
      this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true, reviewCount: { gt: 0 } },
        orderBy: { avgRating: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          avgRating: true,
          reviewCount: true,
          category: { select: { name: true } },
        },
      }),
    ]);

    return {
      totalProducts,
      publishedProducts,
      draftProducts: totalProducts - publishedProducts,
      categoryPerformance,
      topRated: topRated.map((p) => ({
        name: p.name,
        category: p.category.name,
        avgRating: p.avgRating,
        reviewCount: p.reviewCount,
      })),
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

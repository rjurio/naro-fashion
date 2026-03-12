import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRentalsByProduct(params: { page?: number; limit?: number }) {
    const { page = 1, limit = 50 } = params;
    const groups = await this.prisma.rentalOrder.groupBy({
      by: ['productId'],
      _count: { id: true },
      _sum: { totalRentalPrice: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const productIds = groups.map(g => g.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: { select: { name: true } }, images: { where: { isPrimary: true }, take: 1 } },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    // Get last rental date per product
    const lastRentals = await this.prisma.rentalOrder.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['productId'],
    });
    const lastRentalMap = new Map(lastRentals.map(r => [r.productId, r.createdAt]));

    const result = groups.map(g => {
      const p = productMap.get(g.productId);
      const count = g._count.id;
      const totalIncome = Number(g._sum.totalRentalPrice ?? 0);
      return {
        productId: g.productId,
        productName: p?.name ?? 'Unknown',
        categoryName: p?.category?.name ?? '',
        imageUrl: p?.images?.[0]?.url ?? null,
        rentalCount: count,
        totalIncome,
        avgPerRental: count > 0 ? totalIncome / count : 0,
        lastRentedAt: lastRentalMap.get(g.productId) ?? null,
      };
    });

    const total = result.length;
    const paginated = result.slice((page - 1) * limit, page * limit);
    return { data: paginated, total, page, limit };
  }

  async getRentalHistoryForProduct(productId: string, params: { page?: number; limit?: number }) {
    const { page = 1, limit = 25 } = params;
    const where = { productId };
    const [data, total] = await Promise.all([
      this.prisma.rentalOrder.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          variant: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.rentalOrder.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getIncomeStatement(period: string) {
    // period = "YYYY-MM"
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Revenue
    const ordersAgg = await this.prisma.order.aggregate({
      where: { createdAt: { gte: startDate, lte: endDate }, paymentStatus: 'PAID' },
      _sum: { total: true },
    });
    const rentalsAgg = await this.prisma.rentalOrder.aggregate({
      where: { createdAt: { gte: startDate, lte: endDate }, status: { in: ['RETURNED', 'ACTIVE'] } },
      _sum: { totalRentalPrice: true },
    });

    const salesRevenue = Number(ordersAgg._sum.total ?? 0);
    const rentalRevenue = Number(rentalsAgg._sum.totalRentalPrice ?? 0);
    const totalRevenue = salesRevenue + rentalRevenue;

    // COGS: SUM(orderItem.quantity * product.purchasePrice) for orders in period
    const orderItems = await this.prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: startDate, lte: endDate }, paymentStatus: 'PAID' } },
      include: { product: { select: { purchasePrice: true } } },
    });
    const cogs = orderItems.reduce((sum, item) => {
      const cost = Number(item.product.purchasePrice ?? 0);
      return sum + cost * item.quantity;
    }, 0);

    const grossProfit = totalRevenue - cogs;
    const grossMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    // Expenses
    const expenseSummary = await this.prisma.businessExpense.findMany({
      where: { period },
      include: { category: { select: { name: true, categoryType: true } } },
    });

    const expensesByCategory: Record<string, { category: string; type: string; amount: number }> = {};
    let totalExpenses = 0;
    for (const e of expenseSummary) {
      const key = e.category.name;
      if (!expensesByCategory[key]) expensesByCategory[key] = { category: key, type: e.category.categoryType, amount: 0 };
      const amt = Number(e.amount);
      expensesByCategory[key].amount += amt;
      totalExpenses += amt;
    }

    const netProfit = grossProfit - totalExpenses;
    const netMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    // Period status
    const financialPeriod = await this.prisma.financialPeriod.findUnique({ where: { periodKey: period } });

    return {
      period, salesRevenue, rentalRevenue, totalRevenue,
      cogs, grossProfit, grossMargin: `${grossMargin}%`,
      expenses: Object.values(expensesByCategory),
      totalExpenses, netProfit, netMargin: `${netMargin}%`,
      periodStatus: financialPeriod?.status ?? 'OPEN',
    };
  }

  async getFinancialSummary(year: number) {
    const rows: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, '0')}`;
      const stmt = await this.getIncomeStatement(period);
      rows.push({
        month: period,
        monthName: new Date(year, m - 1, 1).toLocaleString('en', { month: 'short' }),
        revenue: stmt.totalRevenue,
        cogs: stmt.cogs,
        grossProfit: stmt.grossProfit,
        expenses: stmt.totalExpenses,
        netProfit: stmt.netProfit,
        netMargin: stmt.netMargin,
      });
    }
    return rows;
  }

  async getExpenseBreakdown(period: string) {
    const expenses = await this.prisma.businessExpense.findMany({
      where: { period },
      include: { category: true },
    });
    const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const byCategory: Record<string, any> = {};
    for (const e of expenses) {
      const key = e.category.name;
      if (!byCategory[key]) byCategory[key] = { category: key, type: e.category.categoryType, amount: 0 };
      byCategory[key].amount += Number(e.amount);
    }
    return Object.values(byCategory).map(c => ({
      ...c,
      percentage: total > 0 ? ((c.amount / total) * 100).toFixed(1) : '0.0',
    }));
  }

  async getFinancialPeriods() {
    return this.prisma.financialPeriod.findMany({ orderBy: { periodKey: 'desc' } });
  }

  async createFinancialPeriod(data: { periodKey: string; periodName: string; startDate: string; endDate: string }) {
    return this.prisma.financialPeriod.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
    });
  }

  async closePeriod(id: string, closedBy?: string) {
    return this.prisma.financialPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedBy, closedAt: new Date() },
    });
  }
}

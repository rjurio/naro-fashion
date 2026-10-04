import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { eatMonthBounds } from './eat-time.util';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';

/** Order paymentStatus values that count as realised sales revenue. */
export const REVENUE_PAYMENT_STATUSES = ['PAID', 'REFUNDED'] as const;

/** Rental statuses that represent a paid (down payment onwards) rental. */
export const RENTAL_REVENUE_STATUSES = [
  'DOWN_PAYMENT_PAID',
  'FULLY_PAID',
  'READY_FOR_PICKUP',
  'ITEM_DISPATCHED',
  'ACTIVE',
  'RETURNED',
  'INSPECTION',
  'CLOSED',
  'CONFIRMED', // legacy value written by payment reconciliation
  'COMPLETED',
] as const;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async getRentalsByProduct(params: { page?: number; limit?: number }) {
    const tenantId = this.tenantContext.requireId;
    const { page = 1, limit = 50 } = params;
    const groups = await this.prisma.rentalOrder.groupBy({
      by: ['productId'],
      where: { tenantId },
      _count: { id: true },
      _sum: { totalRentalPrice: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const productIds = groups.map(g => g.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true, name: true, category: { select: { name: true } }, images: { where: { isPrimary: true }, take: 1 } },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    // Get last rental date per product
    const lastRentals = await this.prisma.rentalOrder.findMany({
      where: { productId: { in: productIds }, tenantId },
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
    const where = { productId, tenantId: this.tenantContext.requireId };
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
    const tenantId = this.tenantContext.requireId;
    // period = "YYYY-MM", bounded in Africa/Dar_es_Salaam time (server is UTC).
    let startDate: Date;
    let endDate: Date;
    try {
      ({ start: startDate, end: endDate } = eatMonthBounds(period));
    } catch {
      throw new BadRequestException('period must be YYYY-MM');
    }

    // Sales revenue. An order counts when it was paid: PAID, or REFUNDED
    // (fully refunded — its refund payments are subtracted below, netting to
    // 0), or for POS also PARTIAL (= partially refunded/exchanged; online
    // PARTIAL means partially PAID and is excluded until settled). Previously
    // only PAID counted, so a POS sale with one returned item vanished from
    // revenue entirely.
    const salesWhere = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      OR: [
        { paymentStatus: { in: [...REVENUE_PAYMENT_STATUSES] } },
        { channel: 'POS', paymentStatus: 'PARTIAL' },
      ],
    };
    const ordersAgg = await this.prisma.order.aggregate({
      where: salesWhere,
      _sum: { total: true },
    });

    // Refunds are booked in the month the money went back (keeps closed
    // periods immutable), on any sales order of the tenant.
    const refundsAgg = await this.prisma.payment.aggregate({
      where: {
        tenantId,
        status: 'REFUNDED',
        orderId: { not: null },
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    });

    // Rental revenue: every rental that reached a paid state (down payment
    // onwards — DOWN_PAYMENT_PAID … INSPECTION, RETURNED, CLOSED, plus legacy
    // CONFIRMED/COMPLETED), never cancelled/unpaid holds. Previously only
    // ACTIVE/RETURNED counted, so revenue disappeared once a rental moved to
    // INSPECTION/CLOSED. Late fees are rental revenue too.
    const rentalsAgg = await this.prisma.rentalOrder.aggregate({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        status: { in: [...RENTAL_REVENUE_STATUSES] },
      },
      _sum: { totalRentalPrice: true, lateFee: true },
    });

    const grossSales = Number(ordersAgg._sum.total ?? 0);
    const refunds = Number(refundsAgg._sum.amount ?? 0);
    const salesRevenue = grossSales - refunds;
    const rentalRevenue =
      Number(rentalsAgg._sum.totalRentalPrice ?? 0) + Number(rentalsAgg._sum.lateFee ?? 0);
    const totalRevenue = salesRevenue + rentalRevenue;

    // COGS: units actually kept by the customer (quantity − refunded/returned,
    // which went back to stock) × purchase price, same order set as revenue.
    const orderItems = await this.prisma.orderItem.findMany({
      where: { order: salesWhere },
      include: { product: { select: { purchasePrice: true } } },
    });
    const cogs = orderItems.reduce((sum, item) => {
      const cost = Number(item.product.purchasePrice ?? 0);
      const kept = Math.max(0, item.quantity - (item.refundedQuantity ?? 0));
      return sum + cost * kept;
    }, 0);

    const grossProfit = totalRevenue - cogs;
    const grossMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    // Expenses
    const expenseSummary = await this.prisma.businessExpense.findMany({
      where: { tenantId, period },
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
    const financialPeriod = await this.prisma.financialPeriod.findFirst({ where: { periodKey: period, tenantId } });

    return {
      period, grossSales, refunds, salesRevenue, rentalRevenue, totalRevenue,
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
        monthName: new Date(Date.UTC(year, m - 1, 15)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
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
      where: { tenantId: this.tenantContext.requireId, period },
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
    return this.prisma.financialPeriod.findMany({
      where: { tenantId: this.tenantContext.requireId },
      orderBy: { periodKey: 'desc' },
    });
  }

  async createFinancialPeriod(dto: CreateFinancialPeriodDto) {
    // Bounds are derived from periodKey in EAT so the lock window used by
    // ExpensesService always matches the period exactly (client-supplied
    // start/end dates are ignored for MONTH periods).
    const { start, end } = eatMonthBounds(dto.periodKey);
    return this.prisma.financialPeriod.create({
      data: {
        tenantId: this.tenantContext.requireId,
        periodKey: dto.periodKey,
        periodName: dto.periodName,
        periodType: 'MONTH',
        startDate: start,
        endDate: end,
        notes: dto.notes,
        status: 'OPEN',
      },
    });
  }

  async closePeriod(id: string, closedBy?: string) {
    const tenantId = this.tenantContext.requireId;
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period) throw new NotFoundException('Financial period not found');
    if (period.status !== 'OPEN') {
      throw new ConflictException(`Financial period is already ${period.status}`);
    }
    return this.prisma.financialPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedBy, closedAt: new Date() },
    });
  }
}
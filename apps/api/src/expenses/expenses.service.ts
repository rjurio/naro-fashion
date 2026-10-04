import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { toEatPeriod } from '../reports/eat-time.util';

/**
 * Financial period key for an expense date, in Africa/Dar_es_Salaam time.
 * The old version used server-local getMonth() (UTC on the VPS), so an
 * expense dated 00:00–03:00 EAT on the 1st landed in the previous month.
 */
export function toPeriod(date: Date | string): string {
  try {
    return toEatPeriod(date);
  } catch {
    throw new BadRequestException('Invalid expense date');
  }
}

/** FinancialPeriod statuses that freeze the books for that month. */
export const LOCKED_PERIOD_STATUSES = ['CLOSED', 'LOCKED'];

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async findAll(params: { categoryId?: string; period?: string; startDate?: string; endDate?: string; vendor?: string; page?: number; limit?: number }) {
    const { categoryId, period, startDate, endDate, vendor, page = 1, limit = 25 } = params;
    const where: any = { tenantId: this.tenantContext.requireId };
    if (categoryId) where.categoryId = categoryId;
    if (period) where.period = period;
    if (vendor) where.vendor = { contains: vendor, mode: 'insensitive' };
    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate);
      if (endDate) where.expenseDate.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.businessExpense.findMany({
        where,
        include: { category: { select: { id: true, name: true, categoryType: true } } },
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.businessExpense.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getSummary(period: string) {
    const expenses = await this.prisma.businessExpense.findMany({
      where: { tenantId: this.tenantContext.requireId, period },
      include: { category: true },
    });
    const byCategory: Record<string, { name: string; type: string; total: number }> = {};
    let grandTotal = 0;
    for (const e of expenses) {
      const key = e.categoryId;
      if (!byCategory[key]) byCategory[key] = { name: e.category.name, type: e.category.categoryType, total: 0 };
      const amt = Number(e.amount);
      byCategory[key].total += amt;
      grandTotal += amt;
    }
    return { period, categories: Object.values(byCategory), grandTotal };
  }

  async findOne(id: string) {
    const e = await this.prisma.businessExpense.findFirst({ where: { id, tenantId: this.tenantContext.requireId }, include: { category: true } });
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }

  /**
   * Closed financial periods are enforced, not just labels: no expense may be
   * created in, moved into, edited within, or deleted from a CLOSED/LOCKED
   * period of this tenant (matched by periodKey).
   */
  private async assertPeriodOpen(period: string) {
    const locked = await this.prisma.financialPeriod.findFirst({
      where: {
        tenantId: this.tenantContext.requireId,
        periodKey: period,
        status: { in: LOCKED_PERIOD_STATUSES },
      },
      select: { periodKey: true, status: true },
    });
    if (locked) {
      throw new ForbiddenException(
        `Financial period ${locked.periodKey} is ${locked.status}; expenses in it cannot be changed.`,
      );
    }
  }

  /** The category must exist, be active and belong to this tenant. */
  private async assertCategoryInTenant(categoryId: string) {
    const cat = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, tenantId: this.tenantContext.requireId, deletedAt: null },
      select: { id: true },
    });
    if (!cat) throw new BadRequestException('Expense category not found');
  }

  async create(dto: CreateExpenseDto, createdBy?: string) {
    const period = toPeriod(dto.expenseDate);
    await this.assertCategoryInTenant(dto.categoryId);
    await this.assertPeriodOpen(period);
    return this.prisma.businessExpense.create({
      data: {
        tenantId: this.tenantContext.requireId,
        categoryId: dto.categoryId,
        amount: dto.amount,
        description: dto.description,
        vendor: dto.vendor,
        expenseDate: new Date(dto.expenseDate),
        period,
        receiptUrl: dto.receiptUrl,
        createdBy,
      },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.findOne(id);
    // Both the period it is in now and (if moving) the period it moves to
    // must be open.
    await this.assertPeriodOpen(existing.period);
    const period = dto.expenseDate ? toPeriod(dto.expenseDate) : undefined;
    if (period && period !== existing.period) await this.assertPeriodOpen(period);
    if (dto.categoryId) await this.assertCategoryInTenant(dto.categoryId);

    return this.prisma.businessExpense.update({
      where: { id },
      data: {
        // Explicit whitelist (no spread of the DTO).
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
        ...(dto.receiptUrl !== undefined ? { receiptUrl: dto.receiptUrl } : {}),
        ...(dto.expenseDate ? { expenseDate: new Date(dto.expenseDate) } : {}),
        ...(period ? { period } : {}),
      },
      include: { category: true },
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    await this.assertPeriodOpen(existing.period);
    await this.prisma.businessExpense.delete({ where: { id } });
    return { message: 'Expense deleted' };
  }
}

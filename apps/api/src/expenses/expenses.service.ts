import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

function toPeriod(date: Date | string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { categoryId?: string; period?: string; startDate?: string; endDate?: string; vendor?: string; page?: number; limit?: number }) {
    const { categoryId, period, startDate, endDate, vendor, page = 1, limit = 25 } = params;
    const where: any = {};
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
      where: { period },
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
    const e = await this.prisma.businessExpense.findUnique({ where: { id }, include: { category: true } });
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }

  async create(dto: CreateExpenseDto, createdBy?: string) {
    const period = toPeriod(dto.expenseDate);
    return this.prisma.businessExpense.create({
      data: {
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
    await this.findOne(id);
    const period = dto.expenseDate ? toPeriod(dto.expenseDate) : undefined;
    return this.prisma.businessExpense.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.expenseDate ? { expenseDate: new Date(dto.expenseDate) } : {}),
        ...(period ? { period } : {}),
      },
      include: { category: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.businessExpense.delete({ where: { id } });
    return { message: 'Expense deleted' };
  }
}

import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';

const DEFAULT_CATEGORIES = [
  { name: 'Rent', categoryType: 'OPERATING', sortOrder: 1 },
  { name: 'Electricity', categoryType: 'OPERATING', sortOrder: 2 },
  { name: 'Water', categoryType: 'OPERATING', sortOrder: 3 },
  { name: 'Internet', categoryType: 'OPERATING', sortOrder: 4 },
  { name: 'Salary', categoryType: 'OPERATING', sortOrder: 5 },
  { name: 'Government Tax', categoryType: 'TAX', sortOrder: 6 },
  { name: 'Advertisement', categoryType: 'OPERATING', sortOrder: 7 },
  { name: 'Supplies', categoryType: 'OPERATING', sortOrder: 8 },
  { name: 'Maintenance', categoryType: 'OPERATING', sortOrder: 9 },
  { name: 'Services', categoryType: 'OPERATING', sortOrder: 10 },
  { name: 'Packaging', categoryType: 'COGS', sortOrder: 11 },
  { name: 'Shipping Cost', categoryType: 'COGS', sortOrder: 12 },
  { name: 'Other', categoryType: 'OTHER', sortOrder: 99 },
];

@Injectable()
export class ExpenseCategoriesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const cat of DEFAULT_CATEGORIES) {
      await this.prisma.expenseCategory.upsert({
        where: { name: cat.name },
        create: cat,
        update: {},
      });
    }
  }

  async findAll(params: { isActive?: boolean; includeDeleted?: boolean }) {
    return this.prisma.expenseCategory.findMany({
      where: {
        ...(params.includeDeleted ? {} : { deletedAt: null }),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      },
      include: { _count: { select: { expenses: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Expense category not found');
    return cat;
  }

  async create(dto: CreateExpenseCategoryDto) {
    try {
      return await this.prisma.expenseCategory.create({ data: dto });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A category with this name already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateExpenseCategoryDto) {
    await this.findOne(id);
    try {
      return await this.prisma.expenseCategory.update({ where: { id }, data: dto });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A category with this name already exists');
      throw e;
    }
  }

  async toggle(id: string) {
    const cat = await this.findOne(id);
    return this.prisma.expenseCategory.update({ where: { id }, data: { isActive: !cat.isActive } });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async restore(id: string) {
    return this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: null, isActive: true } });
  }
}

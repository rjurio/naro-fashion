import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';

// Default categories are seeded per tenant by ExpenseCategoriesSeeder
// (singleton) — lifecycle hooks never run on this request-scoped service.
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async findAll(params: { isActive?: boolean; includeDeleted?: boolean }) {
    return this.prisma.expenseCategory.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        ...(params.includeDeleted ? {} : { deletedAt: null }),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      },
      include: { _count: { select: { expenses: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!cat) throw new NotFoundException('Expense category not found');
    return cat;
  }

  async create(dto: CreateExpenseCategoryDto) {
    try {
      return await this.prisma.expenseCategory.create({ data: { ...dto, tenantId: this.tenantContext.requireId } });
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
    await this.findOne(id);
    return this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: null, isActive: true } });
  }
}

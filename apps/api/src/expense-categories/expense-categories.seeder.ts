import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_EXPENSE_CATEGORIES = [
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

/**
 * Gives every tenant that has no expense categories the default set.
 *
 * Previously ExpenseCategoriesService.onModuleInit seeded GLOBAL (tenantId
 * null) rows — but that service is request-scoped via TenantContext, so the
 * hook never ran, and every read/validation filters by tenantId so global rows
 * would have been invisible anyway. Singleton → the hook actually fires.
 * Tenants that already have categories (or deleted them) are left alone.
 */
@Injectable()
export class ExpenseCategoriesSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpenseCategoriesSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.seed();
    } catch (err) {
      this.logger.error(`Expense category seeding failed: ${(err as Error).message}`);
    }
  }

  async seed() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      const count = await this.prisma.expenseCategory.count({ where: { tenantId: t.id } });
      if (count > 0) continue;
      await this.prisma.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, tenantId: t.id })),
        skipDuplicates: true,
      });
      this.logger.log(`Seeded ${DEFAULT_EXPENSE_CATEGORIES.length} default expense categories for tenant ${t.id}`);
    }
  }
}

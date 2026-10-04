import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_PRODUCT_SIZES = [
  { name: 'XS', description: 'Extra Small', category: 'clothing', sortOrder: 10 },
  { name: 'S', description: 'Small', category: 'clothing', sortOrder: 20 },
  { name: 'M', description: 'Medium', category: 'clothing', sortOrder: 30 },
  { name: 'L', description: 'Large', category: 'clothing', sortOrder: 40 },
  { name: 'XL', description: 'Extra Large', category: 'clothing', sortOrder: 50 },
  { name: 'XXL', description: 'Double Extra Large', category: 'clothing', sortOrder: 60 },
  { name: 'XXXL', description: 'Triple Extra Large', category: 'clothing', sortOrder: 70 },
  { name: '36', category: 'clothing', sortOrder: 100 },
  { name: '38', category: 'clothing', sortOrder: 110 },
  { name: '40', category: 'clothing', sortOrder: 120 },
  { name: '42', category: 'clothing', sortOrder: 130 },
  { name: '44', category: 'clothing', sortOrder: 140 },
  { name: '46', category: 'clothing', sortOrder: 150 },
  { name: 'One Size', description: 'Free size / one size fits all', category: 'clothing', sortOrder: 200 },
];

/**
 * Seeds common sizes for any tenant whose size list is empty.
 *
 * Previously ProductSizesService.onModuleInit — never ran, because that service
 * is request-scoped via TenantContext and Nest skips lifecycle hooks on
 * request-scoped providers. Singleton → the hook fires.
 */
@Injectable()
export class ProductSizesSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductSizesSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.seed();
    } catch (err) {
      // Seeding failure should never break boot
      this.logger.error(`Product size seeding failed: ${(err as Error).message}`);
    }
  }

  async seed() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      const count = await this.prisma.productSize.count({
        where: { tenantId: t.id, deletedAt: null },
      });
      if (count > 0) continue;
      await this.prisma.productSize.createMany({
        data: DEFAULT_PRODUCT_SIZES.map((d) => ({ ...d, tenantId: t.id })),
        skipDuplicates: true,
      });
      this.logger.log(`Seeded ${DEFAULT_PRODUCT_SIZES.length} default sizes for tenant ${t.id}`);
    }
  }
}

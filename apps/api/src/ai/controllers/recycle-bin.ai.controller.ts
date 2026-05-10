import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { CategoriesService } from '../../categories/categories.service';
import { ProductSizesService } from '../../product-sizes/product-sizes.service';
import { SizeGuidesService } from '../../size-guides/size-guides.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

/**
 * Recycle-bin aggregator. Phase 1 supports the four entities with a
 * stable findDeleted() method on their existing service:
 *   - Product
 *   - Category
 *   - ProductSize
 *   - SizeGuide
 *
 * Other soft-deletable entities (Banner, Page, ChecklistTemplate,
 * ExpenseCategory, Role, AdminUser, ParallaxSection, PaymentMethod) need
 * additional accessors before they can be aggregated here. That's tracked
 * as Phase 4 work in IMPLEMENTATION_PLAN.md.
 */
@AiSecured()
@Controller('ai/recycle-bin')
export class RecycleBinAiController {
  constructor(
    private readonly runner: AiToolRunner,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly productSizes: ProductSizesService,
    private readonly sizeGuides: SizeGuidesService,
  ) {}

  private static readonly SUPPORTED_ENTITIES = [
    'Product',
    'Category',
    'ProductSize',
    'SizeGuide',
  ];

  // GET /api/v1/ai/recycle-bin?entity=Product
  // GET /api/v1/ai/recycle-bin                 → aggregate counts per entity
  @Get()
  list(@Query('entity') entity?: string) {
    return this.runner.run({
      tool: 'list_deleted_records',
      actionType: 'READ',
      input: { entity },
      targetResourceType: entity ?? 'RecycleBin',
      handler: async () => {
        if (!entity) {
          return this.aggregateCounts();
        }
        if (!RecycleBinAiController.SUPPORTED_ENTITIES.includes(entity)) {
          throw new BadRequestException(
            `Unsupported entity '${entity}'. Supported: ${RecycleBinAiController.SUPPORTED_ENTITIES.join(', ')}.`,
          );
        }
        const data = await this.fetchDeleted(entity);
        return { entity, data };
      },
    });
  }

  private async fetchDeleted(entity: string): Promise<unknown[]> {
    switch (entity) {
      case 'Product':
        return this.products.findDeleted();
      case 'Category':
        return this.categories.findDeleted();
      case 'ProductSize':
        return this.productSizes.findDeleted();
      case 'SizeGuide':
        return this.sizeGuides.findDeleted();
      default:
        return [];
    }
  }

  private async aggregateCounts() {
    const [productList, categoryList, sizeList, guideList] = await Promise.all([
      this.products.findDeleted(),
      this.categories.findDeleted(),
      this.productSizes.findDeleted(),
      this.sizeGuides.findDeleted(),
    ]);
    return {
      counts: {
        Product: productList?.length ?? 0,
        Category: Array.isArray(categoryList) ? categoryList.length : 0,
        ProductSize: sizeList?.length ?? 0,
        SizeGuide: guideList?.length ?? 0,
      },
      supportedEntities: RecycleBinAiController.SUPPORTED_ENTITIES,
    };
  }
}

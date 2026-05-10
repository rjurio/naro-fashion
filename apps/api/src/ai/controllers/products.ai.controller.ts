import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { QueryProductsDto } from '../../products/dto/query-products.dto';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import { CreateProductDraftAiDto } from '../dto/create-product-draft.ai.dto';

/**
 * Read-only AI tools for the products module. Phase 1 — no write tools.
 * Wraps existing ProductsService methods that already enforce tenant
 * scoping via TenantContext.
 */
@AiSecured()
@Controller('ai/products')
export class ProductsAiController {
  constructor(
    private readonly products: ProductsService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/products/search
  @Get('search')
  search(@Query() query: QueryProductsDto) {
    return this.runner.run({
      tool: 'search_products',
      actionType: 'READ',
      input: query,
      targetResourceType: 'Product',
      handler: () => this.products.findAllAdmin(query),
      message: (data: any) =>
        `Found ${data?.meta?.total ?? 0} product(s) (page ${data?.meta?.page ?? 1}/${data?.meta?.totalPages ?? 1}).`,
    });
  }

  // GET /api/v1/ai/products/:id
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.runner.run({
      tool: 'get_product',
      actionType: 'READ',
      input: { id },
      targetResourceType: 'Product',
      targetResourceId: id,
      handler: () => this.products.findById(id),
    });
  }

  // POST /api/v1/ai/products/draft  (Phase 2 — draft creation, no approval)
  //
  // Creates a Product with isActive: false. Pricing fields are forbidden by
  // the AI DTO (basePrice/compareAtPrice/rentalPricePerDay/etc. → 400). The
  // server forces price: 0 as a placeholder; operators MUST set the real
  // price + add at least one ProductVariant in the admin UI before publish.
  @Post('draft')
  createDraft(@Body() dto: CreateProductDraftAiDto) {
    return this.runner.run({
      tool: 'create_product_draft',
      actionType: 'CREATE',
      input: dto,
      targetResourceType: 'Product',
      handler: async () => {
        // Construct a payload satisfying ProductsService's CreateProductDto.
        // Pricing forced to 0; published forced to false. The DTO whitelist
        // already rejected anything pricing-related on the wire.
        const payload: any = {
          name: dto.name,
          nameSwahili: dto.nameSwahili,
          slug: dto.slug,
          description: dto.description ?? '',
          descriptionSwahili: dto.descriptionSwahili,
          categoryId: dto.categoryId,
          availabilityMode: dto.availabilityMode,
          sku: dto.sku,
          minimumStock: dto.minimumStock,
          supplierName: dto.supplierName,
          supplierContact: dto.supplierContact,
          minRentalDays: dto.minRentalDays,
          maxRentalDays: dto.maxRentalDays,
          bufferDaysOverride: dto.bufferDaysOverride,
          price: 0, // placeholder; operator must update before publishing
          published: false, // forced — drafts are never live
          isFeatured: false,
        };
        return this.products.create(payload);
      },
      message: (data: any) =>
        `Drafted product '${data?.name ?? '?'}' (id ${data?.id ?? '?'}, isActive=false). Set price + add at least one variant in the admin UI before publishing.`,
    });
  }
}

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { QueryProductsDto } from '../../products/dto/query-products.dto';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

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
}

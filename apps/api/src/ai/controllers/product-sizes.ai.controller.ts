import { Body, Controller, Get, Post } from '@nestjs/common';
import { ProductSizesService } from '../../product-sizes/product-sizes.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import { CreateSizeAiDto } from '../dto/create-size.ai.dto';

@AiSecured()
@Controller('ai/product-sizes')
export class ProductSizesAiController {
  constructor(
    private readonly sizes: ProductSizesService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/product-sizes
  @Get()
  list() {
    return this.runner.run({
      tool: 'list_sizes',
      actionType: 'READ',
      targetResourceType: 'ProductSize',
      handler: () => this.sizes.findAll(),
      message: (data: any) =>
        `Returned ${Array.isArray(data) ? data.length : 0} size(s).`,
    });
  }

  // POST /api/v1/ai/product-sizes  (Phase 2 — create a size)
  //
  // Sizes are admin-only entities (used in ProductVariant.size) and don't
  // render on the storefront until an admin builds a variant with that
  // label, so live creation is safe — no approval needed. The underlying
  // service catches P2002 (unique on (tenantId, name)) and throws 409.
  @Post()
  create(@Body() dto: CreateSizeAiDto) {
    return this.runner.run({
      tool: 'create_size',
      actionType: 'CREATE',
      input: dto,
      targetResourceType: 'ProductSize',
      handler: () => this.sizes.create(dto),
      message: (data: any) =>
        `Created size '${data?.name ?? '?'}' (id ${data?.id ?? '?'}).`,
    });
  }
}

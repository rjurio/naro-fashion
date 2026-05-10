import { Controller, Get } from '@nestjs/common';
import { ProductSizesService } from '../../product-sizes/product-sizes.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

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
}

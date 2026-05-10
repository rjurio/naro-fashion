import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from '../../categories/categories.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

@AiSecured()
@Controller('ai/categories')
export class CategoriesAiController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/categories
  @Get()
  list() {
    return this.runner.run({
      tool: 'list_categories',
      actionType: 'READ',
      targetResourceType: 'Category',
      handler: () => this.categories.findAll(),
      message: (data: any) =>
        `Returned ${Array.isArray(data) ? data.length : 0} top-level categories (3 levels deep).`,
    });
  }
}

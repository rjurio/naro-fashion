import { Controller, Get } from '@nestjs/common';
import { SizeGuidesService } from '../../size-guides/size-guides.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

@AiSecured()
@Controller('ai/size-guide')
export class SizeGuideAiController {
  constructor(
    private readonly guides: SizeGuidesService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/size-guide
  @Get()
  list() {
    return this.runner.run({
      tool: 'get_size_guide',
      actionType: 'READ',
      targetResourceType: 'SizeGuide',
      handler: () => this.guides.findAll(),
      message: (data: any) =>
        `Returned ${Array.isArray(data) ? data.length : 0} size guide(s).`,
    });
  }
}

import { Body, Controller, Get, Post } from '@nestjs/common';
import { SizeGuidesService } from '../../size-guides/size-guides.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import { CreateSizeGuideAiDto } from '../dto/create-size-guide.ai.dto';

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

  // POST /api/v1/ai/size-guide  (Phase 2 — draft size guide)
  //
  // The underlying SizeGuidesService.createDraft() forces isActive: false
  // and isDefault: false. Operator must activate the guide via the admin UI
  // before customers can see it.
  @Post()
  createDraft(@Body() dto: CreateSizeGuideAiDto) {
    return this.runner.run({
      tool: 'create_size_guide_entry',
      actionType: 'CREATE',
      input: {
        // Don't log the full markdown — keep light fields + length only.
        name: dto.name,
        nameSwahili: dto.nameSwahili,
        contentLength: dto.content.length,
        hasPdf: !!dto.pdfUrl,
      },
      targetResourceType: 'SizeGuide',
      handler: () => this.guides.createDraft(dto),
      message: (data: any) =>
        `Drafted size guide '${data?.name ?? '?'}' (id ${data?.id ?? '?'}, isActive=false). Activate it in the admin UI before customers see it.`,
    });
  }
}

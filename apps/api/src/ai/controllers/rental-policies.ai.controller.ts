import { Controller, Get } from '@nestjs/common';
import { RentalPoliciesService } from '../../rental-policies/rental-policies.service';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

@AiSecured()
@Controller('ai/rental-policies')
export class RentalPoliciesAiController {
  constructor(
    private readonly policies: RentalPoliciesService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/rental-policies
  @Get()
  get() {
    return this.runner.run({
      tool: 'get_rental_policies',
      actionType: 'READ',
      targetResourceType: 'RentalPolicy',
      handler: () => this.policies.get(),
    });
  }
}

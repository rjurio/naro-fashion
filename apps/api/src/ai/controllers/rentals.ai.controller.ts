import { Controller, Get, Param, Query } from '@nestjs/common';
import { RentalsService } from '../../rentals/rentals.service';
import { QueryRentalsDto } from '../../rentals/dto/query-rentals.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

@AiSecured()
@Controller('ai/rentals')
export class RentalsAiController {
  constructor(
    private readonly rentals: RentalsService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/rentals
  @Get()
  list(@Query() query: QueryRentalsDto) {
    return this.runner.run({
      tool: 'list_rentals',
      actionType: 'READ',
      input: query,
      targetResourceType: 'RentalOrder',
      handler: () => this.rentals.findAllAdmin(query),
      message: (data: any) =>
        `Found ${data?.meta?.total ?? 0} rental(s) (page ${data?.meta?.page ?? 1}/${data?.meta?.totalPages ?? 1}).`,
    });
  }

  // GET /api/v1/ai/rentals/:id
  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.runner.run({
      tool: 'get_rental',
      actionType: 'READ',
      input: { id },
      targetResourceType: 'RentalOrder',
      targetResourceId: id,
      handler: () => this.rentals.findOne(id, user),
    });
  }
}

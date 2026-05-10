import { Controller, Get, Param, Query } from '@nestjs/common';
import { OrdersService } from '../../orders/orders.service';
import { AdminQueryOrdersDto } from '../../orders/dto/query-orders.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';

@AiSecured()
@Controller('ai/orders')
export class OrdersAiController {
  constructor(
    private readonly orders: OrdersService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/orders
  @Get()
  list(@Query() query: AdminQueryOrdersDto) {
    return this.runner.run({
      tool: 'list_orders',
      actionType: 'READ',
      input: query,
      targetResourceType: 'Order',
      handler: () => this.orders.findAllAdmin(query),
      message: (data: any) =>
        `Found ${data?.meta?.total ?? 0} order(s) (page ${data?.meta?.page ?? 1}/${data?.meta?.totalPages ?? 1}).`,
    });
  }

  // GET /api/v1/ai/orders/:id
  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.runner.run({
      tool: 'get_order',
      actionType: 'READ',
      input: { id },
      targetResourceType: 'Order',
      targetResourceId: id,
      // findOne signature is (id, user) — admin user bypasses ownerScope
      // because AdminGuard already validated the caller is an admin.
      handler: () => this.orders.findOne(id, user),
    });
  }
}

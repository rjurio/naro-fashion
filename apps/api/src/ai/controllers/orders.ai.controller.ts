import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrdersService } from '../../orders/orders.service';
import { AdminQueryOrdersDto } from '../../orders/dto/query-orders.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AiSecured } from '../common/ai-controller.decorators';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import { AddOrderNoteAiDto } from '../dto/add-order-note.ai.dto';

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

  // POST /api/v1/ai/orders/:id/notes  (Phase 2 — append a timestamped note)
  //
  // Append-only: the underlying service writes
  //   `[<ISO> — <admin name>] <note>`
  // onto Order.notes. Reversible (admin can edit notes manually), so no
  // approval workflow is required.
  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() dto: AddOrderNoteAiDto,
    @CurrentUser() user: any,
  ) {
    return this.runner.run({
      tool: 'add_order_note',
      actionType: 'NOTE',
      // Don't log the full note body — could contain customer PII. Keep
      // length only; the actual text lives on Order.notes.
      input: { id, noteLength: dto.note.length },
      targetResourceType: 'Order',
      targetResourceId: id,
      handler: () => this.orders.addNote(id, dto.note, user),
      message: () => 'Note appended to order.',
    });
  }
}

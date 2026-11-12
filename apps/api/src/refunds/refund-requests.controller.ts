import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DecideRefundDto, ListRefundsQuery, PayRefundDto, ReasonDto, RefundRequestsService } from './refund-requests.service';

const REFUND_ROLES = ['refunds:approve', 'payments:manage', 'orders:refund', 'pos:refund', 'rentals:refund-request', 'pos:layaway-cancel'];

/**
 * Unified refund workflow (R1b): every request — rental, online order, POS
 * sale / exchange, layaway — is approved and paid out here. Requests are
 * CREATED by their own flows (POST /orders/:id/refunds, POST
 * /pos/sales/:id/refund, POST /pos/exchanges, POST /pos/layaways/:id/cancel,
 * POST /rental-money/rentals/:id/refund-requests).
 */
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
@Controller('refund-requests')
export class RefundRequestsController {
  constructor(private readonly refunds: RefundRequestsService) {}

  @Get()
  @RequiresPermission(...REFUND_ROLES)
  list(@Query() q: ListRefundsQuery) {
    return this.refunds.list(q);
  }

  @Get(':id')
  @RequiresPermission(...REFUND_ROLES)
  get(@Param('id') id: string) {
    return this.refunds.get(id);
  }

  @Patch(':id/approve')
  @RequiresPermission('refunds:approve')
  approve(@Param('id') id: string, @Body() dto: DecideRefundDto, @CurrentUser() user: any) {
    return this.refunds.approve(id, dto, user);
  }

  @Patch(':id/reject')
  @RequiresPermission('refunds:approve')
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: any) {
    return this.refunds.reject(id, dto, user);
  }

  @Patch(':id/pay')
  @RequiresPermission('payments:manage')
  pay(@Param('id') id: string, @Body() dto: PayRefundDto, @CurrentUser() user: any) {
    return this.refunds.pay(id, dto, user);
  }

  @Patch(':id/fail')
  @RequiresPermission('payments:manage')
  fail(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: any) {
    return this.refunds.fail(id, dto, user);
  }

  @Post(':id/retry')
  @RequiresPermission('orders:refund', 'pos:refund', 'pos:layaway-cancel')
  retry(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: any) {
    return this.refunds.retry(id, dto, user);
  }
}

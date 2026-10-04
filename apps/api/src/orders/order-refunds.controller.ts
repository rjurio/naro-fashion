import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrderRefundsService } from './order-refunds.service';
import { CreateOrderRefundDto } from './dto/create-order-refund.dto';

/**
 * Admin refund workflow for online orders. Both routes move/expose money, so
 * they require `orders:refund` (seeded in permissions.service.ts; SUPER_ADMIN
 * and platform admins bypass via PermissionGuard).
 */
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
@Controller('orders')
export class OrderRefundsController {
  constructor(private readonly refunds: OrderRefundsService) {}

  @Get(':id/refunds')
  @RequiresPermission('orders:refund')
  listRefunds(@Param('id') id: string) {
    return this.refunds.listRefunds(id);
  }

  @Post(':id/refunds')
  @RequiresPermission('orders:refund')
  createRefund(
    @Param('id') id: string,
    @Body() dto: CreateOrderRefundDto,
    @CurrentUser() user: any,
  ) {
    return this.refunds.createRefund(id, dto, user);
  }
}

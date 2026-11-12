import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateRentalRefundRequestDto,
  DecideLateFeeWaiverDto,
  FailRentalRefundDto,
  RequestLateFeeWaiverDto,
  PayRentalRefundDto,
  RejectRentalRefundDto,
  RentalMoneyService,
} from './rental-money.service';

/**
 * Rental money ledger + refund workflow (POS rental MVP, M1). Admin-only.
 *   request  rentals:refund-request
 *   approve / reject  refunds:approve (a different person from the requester)
 *   pay / fail  payments:manage (records the manual payout or its failure)
 */
@UseGuards(JwtAuthGuard, ModuleGuard, AdminGuard, PermissionGuard)
@RequiresModule('rentals')
@Controller('rental-money')
export class RentalMoneyController {
  constructor(private readonly money: RentalMoneyService) {}

  @Get('rentals/:id/ledger')
  @RequiresPermission('rentals:view')
  ledger(@Param('id') id: string) {
    return this.money.ledger(id);
  }

  // LF-2026-11 late-fee waivers: request (rentals:update-status), approve / reject (rentals:waive-late-fee, ≠ requester).
  @Post('rentals/:id/late-fee-waivers')
  @RequiresPermission('rentals:update-status')
  requestLateFeeWaiver(@Param('id') id: string, @Body() dto: RequestLateFeeWaiverDto, @CurrentUser() user: any) {
    return this.money.requestLateFeeWaiver(id, dto, user);
  }

  @Patch('late-fee-waivers/:id/approve')
  @RequiresPermission('rentals:waive-late-fee')
  approveLateFeeWaiver(@Param('id') id: string, @Body() dto: DecideLateFeeWaiverDto, @CurrentUser() user: any) {
    return this.money.approveLateFeeWaiver(id, dto, user);
  }

  @Patch('late-fee-waivers/:id/reject')
  @RequiresPermission('rentals:waive-late-fee')
  rejectLateFeeWaiver(@Param('id') id: string, @Body() dto: RejectRentalRefundDto, @CurrentUser() user: any) {
    return this.money.rejectLateFeeWaiver(id, dto, user);
  }

  @Post('rentals/:id/refund-requests')
  @RequiresPermission('rentals:refund-request')
  createRequest(@Param('id') id: string, @Body() dto: CreateRentalRefundRequestDto, @CurrentUser() user: any) {
    return this.money.createRequest(id, dto, user);
  }

  @Get('refund-requests')
  @RequiresPermission('rentals:refund-request', 'refunds:approve', 'payments:manage')
  list(@Query('status') status?: string) {
    return this.money.listRequests(status);
  }

  @Patch('refund-requests/:id/approve')
  @RequiresPermission('refunds:approve')
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.money.approve(id, user);
  }

  @Patch('refund-requests/:id/reject')
  @RequiresPermission('refunds:approve')
  reject(@Param('id') id: string, @Body() dto: RejectRentalRefundDto, @CurrentUser() user: any) {
    return this.money.reject(id, dto, user);
  }

  @Patch('refund-requests/:id/pay')
  @RequiresPermission('payments:manage')
  pay(@Param('id') id: string, @Body() dto: PayRentalRefundDto, @CurrentUser() user: any) {
    return this.money.pay(id, dto, user);
  }

  @Patch('refund-requests/:id/fail')
  @RequiresPermission('payments:manage')
  fail(@Param('id') id: string, @Body() dto: FailRentalRefundDto, @CurrentUser() user: any) {
    return this.money.fail(id, dto, user);
  }
}

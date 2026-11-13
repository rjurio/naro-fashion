import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReviewerTwoFactorGuard } from '../id-verification/reviewer-two-factor.guard';
import { PosRentalsReleaseGuard } from './pos-rentals-release.guard';
import {
  PosAddressDto,
  PosCreateRentalDto,
  PosCustomerDto,
  PosHandoverDto,
  PosIdInPersonDto,
  PosRentalPaymentDto,
  PosRentalQuoteDto,
  PosReturnDto,
  PosRentalsService,
} from './pos-rentals.service';

/**
 * Walk-in POS rentals (POS rental MVP, M3). Admin-only; every route has its
 * own permission. Separate from POS sales / layaways (/pos/*). Online only:
 * the admin app never queues these offline.
 *
 * NOT RELEASED until R5: PosRentalsReleaseGuard runs FIRST and answers 404
 * POS_RENTALS_NOT_RELEASED to every caller (SUPER_ADMIN and platform admins
 * included) while POS_RENTALS_RELEASED is false (pos-rental-release.ts).
 */
@UseGuards(PosRentalsReleaseGuard, JwtAuthGuard, ModuleGuard, AdminGuard, PermissionGuard)
@RequiresModule('rentals')
@Controller('pos-rentals')
export class PosRentalsController {
  constructor(private readonly pos: PosRentalsService) {}

  @Get('catalog')
  @RequiresPermission('rentals:create', 'rentals:view')
  catalog(@Query('q') q?: string) {
    return this.pos.catalog(q);
  }

  @Post('quote')
  @RequiresPermission('rentals:create', 'rentals:view')
  quote(@Body() dto: PosRentalQuoteDto) {
    return this.pos.quote(dto);
  }

  @Get('customers')
  @RequiresPermission('rentals:create')
  customers(@Query('q') q: string) {
    return this.pos.findCustomers(q);
  }

  @Post('customers')
  @RequiresPermission('rentals:create')
  createCustomer(@Body() dto: PosCustomerDto, @CurrentUser() user: any) {
    return this.pos.createCustomer(dto, user);
  }

  @Post('customers/:id/address')
  @RequiresPermission('rentals:create')
  addAddress(@Param('id') id: string, @Body() dto: PosAddressDto) {
    return this.pos.addAddress(id, dto);
  }

  @Post()
  @RequiresPermission('rentals:create')
  create(@Body() dto: PosCreateRentalDto, @CurrentUser() user: any) {
    return this.pos.create(dto, user);
  }

  @Get('lookup/:rentalNumber')
  @RequiresPermission('rentals:view')
  lookup(@Param('rentalNumber') rentalNumber: string) {
    return this.pos.lookup(rentalNumber);
  }

  @Get(':id')
  @RequiresPermission('rentals:view')
  detail(@Param('id') id: string) {
    return this.pos.detail(id);
  }

  @Post(':id/id-in-person')
  @UseGuards(ReviewerTwoFactorGuard)
  @RequiresPermission('id-verification:review')
  idInPerson(@Param('id') id: string, @Body() dto: PosIdInPersonDto, @CurrentUser() user: any) {
    return this.pos.verifyIdInPerson(id, dto, user);
  }

  @Post(':id/payments')
  @RequiresPermission('rentals:record-payment')
  pay(@Param('id') id: string, @Body() dto: PosRentalPaymentDto, @CurrentUser() user: any) {
    return this.pos.recordPayment(id, dto, user);
  }

  @Get(':id/agreement')
  @RequiresPermission('rentals:view')
  agreement(@Param('id') id: string) {
    return this.pos.agreement(id);
  }

  @Get(':id/receipts/:paymentId')
  @RequiresPermission('rentals:view')
  receipt(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.pos.receipt(id, paymentId);
  }

  @Post(':id/handover')
  @RequiresPermission('rentals:release')
  handover(@Param('id') id: string, @Body() dto: PosHandoverDto, @CurrentUser() user: any) {
    return this.pos.handover(id, dto, user);
  }

  @Post(':id/return')
  @RequiresPermission('rentals:update-status')
  recordReturn(@Param('id') id: string, @Body() dto: PosReturnDto, @CurrentUser() user: any) {
    return this.pos.recordReturn(id, dto, user);
  }
}

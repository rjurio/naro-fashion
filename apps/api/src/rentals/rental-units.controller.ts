import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateRentalUnitDto,
  CreateUnitBlockDto,
  DeactivateUnitTrackingDto,
  DecideUnitTrackingDto,
  RejectUnitTrackingDto,
  RentalUnitsService,
  RequestUnitTrackingDto,
  UpdateRentalUnitDto,
} from './rental-units.service';

/**
 * Physical rental units (POS rental MVP, M2 / R2). Admin-only; changes need
 * rentals:manage-inventory. Per-gown tracking switches on only through a
 * submitted count (rentals:manage-inventory) approved by a DIFFERENT person
 * holding rentals:approve-unit-tracking.
 */
@UseGuards(JwtAuthGuard, ModuleGuard, AdminGuard, PermissionGuard)
@RequiresModule('rentals')
@Controller('rental-units')
export class RentalUnitsController {
  constructor(private readonly units: RentalUnitsService) {}

  @Get()
  @RequiresPermission('rentals:view')
  list(@Query('productId') productId?: string) {
    return this.units.list(productId);
  }

  @Get('by-code/:code')
  @RequiresPermission('rentals:view')
  byCode(@Param('code') code: string) {
    return this.units.byCode(code);
  }

  @Post()
  @RequiresPermission('rentals:manage-inventory')
  create(@Body() dto: CreateRentalUnitDto) {
    return this.units.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('rentals:manage-inventory')
  update(@Param('id') id: string, @Body() dto: UpdateRentalUnitDto) {
    return this.units.update(id, dto);
  }

  @Post(':id/blocks')
  @RequiresPermission('rentals:manage-inventory')
  addBlock(@Param('id') id: string, @Body() dto: CreateUnitBlockDto, @CurrentUser() user: any) {
    return this.units.addBlock(id, dto, user);
  }

  @Delete('blocks/:blockId')
  @RequiresPermission('rentals:manage-inventory')
  removeBlock(@Param('blockId') blockId: string) {
    return this.units.removeBlock(blockId);
  }

  // ---------------------------------------------------------------- per-gown tracking
  @Get('products/:productId/tracking')
  @RequiresPermission('rentals:view')
  trackingStatus(@Param('productId') productId: string) {
    return this.units.trackingStatus(productId);
  }

  @Post('products/:productId/tracking/requests')
  @RequiresPermission('rentals:manage-inventory')
  requestTracking(@Param('productId') productId: string, @Body() dto: RequestUnitTrackingDto, @CurrentUser() user: any) {
    return this.units.requestTracking(productId, dto, user);
  }

  @Patch('tracking/requests/:id/approve')
  @RequiresPermission('rentals:approve-unit-tracking')
  approveTracking(@Param('id') id: string, @Body() dto: DecideUnitTrackingDto, @CurrentUser() user: any) {
    return this.units.approveTracking(id, dto, user);
  }

  @Patch('tracking/requests/:id/reject')
  @RequiresPermission('rentals:approve-unit-tracking')
  rejectTracking(@Param('id') id: string, @Body() dto: RejectUnitTrackingDto, @CurrentUser() user: any) {
    return this.units.rejectTracking(id, dto, user);
  }

  @Patch('tracking/requests/:id/cancel')
  @RequiresPermission('rentals:manage-inventory')
  cancelTracking(@Param('id') id: string, @CurrentUser() user: any) {
    return this.units.cancelTracking(id, user);
  }

  @Post('products/:productId/tracking/deactivate')
  @RequiresPermission('rentals:approve-unit-tracking')
  deactivateTracking(@Param('productId') productId: string, @Body() dto: DeactivateUnitTrackingDto, @CurrentUser() user: any) {
    return this.units.deactivateTracking(productId, dto, user);
  }
}

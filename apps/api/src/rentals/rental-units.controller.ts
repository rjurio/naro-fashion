import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateRentalUnitDto, CreateUnitBlockDto, RentalUnitsService, UpdateRentalUnitDto } from './rental-units.service';

/** Physical rental units (POS rental MVP, M2). Admin-only; changes need rentals:manage-inventory. */
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
}

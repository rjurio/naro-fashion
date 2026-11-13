import { Controller, Get, Post, Patch, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustStockDto, ApprovalThresholdsDto, DecideAdjustmentDto } from './dto/adjust-stock.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('inventory')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard, PermissionGuard)
@RequiresModule('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  getList(@Query('status') status?: string, @Query('search') search?: string) {
    return this.service.getInventoryList({ status, search });
  }

  @Get('low-stock')
  getLowStock() { return this.service.getLowStock(); }

  @Get('valuation')
  getValuation() { return this.service.getValuation(); }

  @Get(':productId/transactions')
  getTransactions(@Param('productId') productId: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('type') type?: string) {
    return this.service.getTransactions(productId, { page: page ? +page : 1, limit: limit ? +limit : 50, type });
  }

  // Security fix: every inventory WRITE needs inventory:manage (before, any
  // admin account — STAFF included — could change stock).
  @RequiresPermission('inventory:manage')
  @Patch(':productId/settings')
  updateSettings(@Param('productId') productId: string, @Body() dto: UpdateInventorySettingsDto) {
    return this.service.updateSettings(productId, dto);
  }

  @RequiresPermission('inventory:manage')
  @Post('adjust')
  adjustStock(@Body() dto: AdjustStockDto, @CurrentUser('id') performedBy: string) {
    return this.service.adjustStock(dto, performedBy);
  }

  // Round 25F E: write-offs and stock decreases above the owner's threshold
  // (every decrease while none is set) wait for a DIFFERENT approver.
  @RequiresPermission('inventory:manage', 'inventory:approve')
  @Get('adjustment-requests')
  listRequests(@Query('status') status?: string) {
    return this.service.listRequests(status);
  }

  @RequiresPermission('inventory:approve')
  @Patch('adjustment-requests/:id/approve')
  approveRequest(@Param('id') id: string, @Body() dto: DecideAdjustmentDto, @CurrentUser('id') actorId: string) {
    return this.service.approveRequest(id, dto, actorId);
  }

  @RequiresPermission('inventory:approve')
  @Patch('adjustment-requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Body() dto: DecideAdjustmentDto, @CurrentUser('id') actorId: string) {
    return this.service.rejectRequest(id, dto, actorId);
  }

  @RequiresPermission('inventory:manage')
  @Patch('adjustment-requests/:id/withdraw')
  withdrawRequest(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.service.withdrawRequest(id, actorId);
  }

  @RequiresPermission('inventory:manage', 'inventory:approve', 'settings:manage')
  @Get('approval-thresholds')
  getThresholds() {
    return this.service.getThresholds();
  }

  /** Owner policy: changing what needs a second person is a settings decision (settings:manage), audited. */
  @RequiresPermission('settings:manage')
  @Put('approval-thresholds')
  setThresholds(@Body() dto: ApprovalThresholdsDto, @CurrentUser('id') actorId: string) {
    return this.service.setThresholds(dto, actorId);
  }
}

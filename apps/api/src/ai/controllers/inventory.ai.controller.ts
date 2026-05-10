import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from '../../inventory/inventory.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { ModuleGuard } from '../../auth/guards/module.guard';
import { RequiresModule } from '../../auth/decorators/requires-module.decorator';
import { AiPermissionGuard } from '../guards/ai-permission.guard';
import { AiExceptionFilter } from '../filters/ai-exception.filter';
import { UseFilters } from '@nestjs/common';
import { AiToolRunner } from '../services/ai-tool-runner.service';

/**
 * Inventory AI tools — module-gated. Tenants without the `inventory`
 * module enabled get a 403 module_disabled error from ModuleGuard.
 *
 * AiSecured() can't apply ModuleGuard because @RequiresModule() metadata
 * is required and is per-controller, so we wire the full stack manually.
 */
@UseGuards(JwtAuthGuard, AdminGuard, AiPermissionGuard, ModuleGuard)
@UseFilters(AiExceptionFilter)
@RequiresModule('inventory')
@Controller('ai/inventory')
export class InventoryAiController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/inventory?status=&search=
  @Get()
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.runner.run({
      tool: 'get_inventory',
      actionType: 'READ',
      input: { status, search },
      targetResourceType: 'Inventory',
      handler: () => this.inventory.getInventoryList({ status, search }),
      message: (data: any) =>
        `Returned ${Array.isArray(data) ? data.length : 0} product(s) inventory rows.`,
    });
  }

  // GET /api/v1/ai/inventory/low-stock
  @Get('low-stock')
  lowStock() {
    return this.runner.run({
      tool: 'low_stock_report',
      actionType: 'READ',
      targetResourceType: 'Inventory',
      handler: () => this.inventory.getLowStock(),
      message: (data: any) =>
        `${Array.isArray(data) ? data.length : 0} product(s) at or below minimum stock.`,
    });
  }
}

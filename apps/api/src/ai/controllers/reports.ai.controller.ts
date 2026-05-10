import {
  Controller,
  Get,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../../analytics/analytics.service';
import { ReportsService } from '../../reports/reports.service';
import { OrdersService } from '../../orders/orders.service';
import { RentalsService } from '../../rentals/rentals.service';
import { InventoryService } from '../../inventory/inventory.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { ModuleGuard } from '../../auth/guards/module.guard';
import { RequiresModule } from '../../auth/decorators/requires-module.decorator';
import { AiPermissionGuard } from '../guards/ai-permission.guard';
import { AiExceptionFilter } from '../filters/ai-exception.filter';
import { AiToolRunner } from '../services/ai-tool-runner.service';

/**
 * Reports surface for the AI agent. The reports module is gated by
 * @RequiresModule('reports') in the existing controller; we mirror that
 * here so a tenant without reports enabled gets a 403 rather than data.
 */
@UseGuards(JwtAuthGuard, AdminGuard, AiPermissionGuard, ModuleGuard)
@UseFilters(AiExceptionFilter)
@RequiresModule('reports')
@Controller('ai/reports')
export class ReportsAiController {
  constructor(
    private readonly runner: AiToolRunner,
    private readonly analytics: AnalyticsService,
    private readonly reports: ReportsService,
    private readonly orders: OrdersService,
    private readonly rentals: RentalsService,
    private readonly inventory: InventoryService,
  ) {}

  // GET /api/v1/ai/reports/sales-summary
  @Get('sales-summary')
  salesSummary() {
    return this.runner.run({
      tool: 'sales_summary',
      actionType: 'READ',
      targetResourceType: 'Report',
      handler: () => this.analytics.getDashboard(),
    });
  }

  // GET /api/v1/ai/reports/rental-summary
  @Get('rental-summary')
  rentalSummary() {
    return this.runner.run({
      tool: 'rental_summary',
      actionType: 'READ',
      targetResourceType: 'Report',
      handler: () => this.reports.getRentalsByProduct({ page: 1, limit: 50 }),
    });
  }

  // GET /api/v1/ai/reports/inventory-summary
  @Get('inventory-summary')
  inventorySummary() {
    return this.runner.run({
      tool: 'inventory_summary',
      actionType: 'READ',
      targetResourceType: 'Report',
      handler: () => this.inventory.getValuation(),
    });
  }

  // GET /api/v1/ai/reports/popular-products
  @Get('popular-products')
  popularProducts() {
    return this.runner.run({
      tool: 'popular_products_report',
      actionType: 'READ',
      targetResourceType: 'Report',
      // The dashboard payload exposes `topProducts`. We expose only that
      // slice here so the agent doesn't get a giant blob just for the
      // top products.
      handler: async () => {
        const dash = (await this.analytics.getDashboard()) as any;
        return { topProducts: dash?.topProducts ?? [] };
      },
    });
  }

  // GET /api/v1/ai/reports/pending-orders
  @Get('pending-orders')
  pendingOrders() {
    return this.runner.run({
      tool: 'pending_orders_report',
      actionType: 'READ',
      targetResourceType: 'Report',
      handler: () =>
        this.orders.findAllAdmin({ status: 'PENDING', page: 1, limit: 50 } as any),
    });
  }

  // GET /api/v1/ai/reports/overdue-rentals
  @Get('overdue-rentals')
  overdueRentals() {
    return this.runner.run({
      tool: 'overdue_rentals_report',
      actionType: 'READ',
      targetResourceType: 'Report',
      handler: () => this.rentals.getOverdueRentals(),
      message: (data: any) =>
        `${Array.isArray(data) ? data.length : 0} overdue rental(s).`,
    });
  }
}

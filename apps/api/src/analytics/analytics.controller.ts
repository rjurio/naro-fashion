import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService, RevenuePeriod } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.analyticsService.getDashboard();
  }

  @Get('revenue')
  getRevenue(@Query('period') period: RevenuePeriod = 'daily') {
    return this.analyticsService.getRevenue(period);
  }

  @Get('sales')
  getSales() {
    return this.analyticsService.getSalesAnalytics();
  }

  @Get('rentals')
  getRentals() {
    return this.analyticsService.getRentalsAnalytics();
  }

  @Get('inventory')
  getInventory() {
    return this.analyticsService.getInventoryAnalytics();
  }

  @Get('customers')
  getCustomers() {
    return this.analyticsService.getCustomersAnalytics();
  }

  @Get('products')
  getProducts() {
    return this.analyticsService.getProductsAnalytics();
  }
}

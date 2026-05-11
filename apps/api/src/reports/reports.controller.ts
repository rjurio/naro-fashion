import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
@RequiresModule('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('rentals/by-product')
  getRentalsByProduct(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getRentalsByProduct({ page: page ? +page : 1, limit: limit ? +limit : 50 });
  }

  @Get('rentals/by-product/:productId')
  getRentalHistory(@Param('productId') productId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getRentalHistoryForProduct(productId, { page: page ? +page : 1, limit: limit ? +limit : 25 });
  }

  @Get('financials/income-statement')
  getIncomeStatement(@Query('period') period: string) {
    return this.service.getIncomeStatement(period);
  }

  @Get('financials/summary')
  getFinancialSummary(@Query('year') year?: string) {
    return this.service.getFinancialSummary(year ? +year : new Date().getFullYear());
  }

  @Get('financials/expense-breakdown')
  getExpenseBreakdown(@Query('period') period: string) {
    return this.service.getExpenseBreakdown(period);
  }

  @Get('financials/periods')
  getPeriods() { return this.service.getFinancialPeriods(); }

  @Post('financials/periods')
  createPeriod(@Body() body: any) { return this.service.createFinancialPeriod(body); }

  @Patch('financials/periods/:id/close')
  closePeriod(@Param('id') id: string, @CurrentUser('id') closedBy: string) {
    return this.service.closePeriod(id, closedBy);
  }
}

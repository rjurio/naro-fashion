import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';
import { eatYear } from './eat-time.util';

@Controller('reports')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard, PermissionGuard)
@RequiresModule('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('rentals/by-product')
  @RequiresPermission('reports:view')
  getRentalsByProduct(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getRentalsByProduct({ page: page ? +page : 1, limit: limit ? +limit : 50 });
  }

  @Get('rentals/by-product/:productId')
  @RequiresPermission('reports:view')
  getRentalHistory(@Param('productId') productId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getRentalHistoryForProduct(productId, { page: page ? +page : 1, limit: limit ? +limit : 25 });
  }

  @Get('financials/income-statement')
  @RequiresPermission('reports:view')
  getIncomeStatement(@Query('period') period: string) {
    return this.service.getIncomeStatement(period);
  }

  @Get('financials/summary')
  @RequiresPermission('reports:view')
  getFinancialSummary(@Query('year') year?: string) {
    return this.service.getFinancialSummary(year ? +year : eatYear());
  }

  @Get('financials/expense-breakdown')
  @RequiresPermission('reports:view')
  getExpenseBreakdown(@Query('period') period: string) {
    return this.service.getExpenseBreakdown(period);
  }

  @Get('financials/periods')
  @RequiresPermission('reports:view')
  getPeriods() { return this.service.getFinancialPeriods(); }

  // Creating/closing periods controls the expense period-lock, so both are
  // gated by 'finance:close' (SUPER_ADMIN bypasses in PermissionGuard).
  @Post('financials/periods')
  @RequiresPermission('finance:close')
  createPeriod(@Body() dto: CreateFinancialPeriodDto) { return this.service.createFinancialPeriod(dto); }

  @Patch('financials/periods/:id/close')
  @RequiresPermission('finance:close')
  closePeriod(@Param('id') id: string, @CurrentUser('id') closedBy: string) {
    return this.service.closePeriod(id, closedBy);
  }
}

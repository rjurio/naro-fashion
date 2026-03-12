import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
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
  closePeriod(@Param('id') id: string, @Request() req: any) {
    return this.service.closePeriod(id, req.user?.sub);
  }
}

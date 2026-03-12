import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
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

  @Patch(':productId/settings')
  updateSettings(@Param('productId') productId: string, @Body() dto: UpdateInventorySettingsDto) {
    return this.service.updateSettings(productId, dto);
  }

  @Post('adjust')
  adjustStock(@Body() dto: AdjustStockDto, @Request() req: any) {
    return this.service.adjustStock(dto, req.user?.sub);
  }
}

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PosService } from './pos.service';
import {
  OpenSessionDto,
  CloseSessionDto,
  CreatePosSaleDto,
  HoldSaleDto,
  QueryPosSalesDto,
  PosRefundDto,
  CreateLayawayDto,
  LayawayPaymentDto,
  CreateExchangeDto,
} from './dto';

@Controller('pos')
@UseGuards(JwtAuthGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  @Post('sessions/open')
  openSession(@CurrentUser('id') adminId: string, @Body() dto: OpenSessionDto) {
    return this.posService.openSession(adminId, dto);
  }

  @Post('sessions/close')
  closeSession(@CurrentUser('id') adminId: string, @Body() dto: CloseSessionDto) {
    return this.posService.closeSession(adminId, dto);
  }

  @Get('sessions/current')
  getCurrentSession(@CurrentUser('id') adminId: string) {
    return this.posService.getCurrentSession(adminId);
  }

  @Get('sessions')
  getSessions(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.posService.getSessions(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('sessions/:id/summary')
  getSessionSummary(@Param('id') id: string) {
    return this.posService.getSessionSummary(id);
  }

  // ============================================================
  // PRODUCT & CUSTOMER SEARCH
  // ============================================================

  @Get('products/search')
  searchProducts(@Query('q') query: string) {
    return this.posService.searchProducts(query);
  }

  @Get('products/barcode/:code')
  lookupBarcode(@Param('code') code: string) {
    return this.posService.lookupBarcode(code);
  }

  @Patch('products/:variantId/barcode')
  updateBarcode(
    @Param('variantId') variantId: string,
    @Body('barcode') barcode: string,
  ) {
    return this.posService.updateBarcode(variantId, barcode);
  }

  @Get('customers/search')
  searchCustomers(@Query('q') query: string) {
    return this.posService.searchCustomers(query);
  }

  @Post('customers/quick')
  quickCreateCustomer(@Body() data: { firstName: string; phone: string; lastName?: string; email?: string }) {
    return this.posService.quickCreateCustomer(data);
  }

  // ============================================================
  // SALES
  // ============================================================

  @Post('sales')
  createSale(@Body() dto: CreatePosSaleDto, @CurrentUser('id') cashierId: string) {
    return this.posService.createSale(dto, cashierId);
  }

  @Get('sales')
  getSales(@Query() query: QueryPosSalesDto) {
    return this.posService.getSales(query);
  }

  @Get('sales/:id')
  getSale(@Param('id') id: string) {
    return this.posService.getSale(id);
  }

  @Get('sales/:id/receipt')
  getReceipt(@Param('id') id: string) {
    return this.posService.getReceipt(id);
  }

  // ============================================================
  // HOLD / PARK
  // ============================================================

  @Post('held')
  holdSale(@CurrentUser('id') adminId: string, @Body() dto: HoldSaleDto) {
    return this.posService.holdSale(adminId, dto);
  }

  @Get('held')
  getHeldSales(@CurrentUser('id') adminId: string) {
    return this.posService.getHeldSales(adminId);
  }

  @Post('held/:id/resume')
  resumeHeldSale(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.posService.resumeHeldSale(id, adminId);
  }

  @Delete('held/:id')
  discardHeldSale(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.posService.discardHeldSale(id, adminId);
  }

  // ============================================================
  // REFUNDS
  // ============================================================

  @Post('sales/:id/refund')
  refundSale(
    @Param('id') id: string,
    @Body() dto: PosRefundDto,
    @CurrentUser('id') cashierId: string,
  ) {
    return this.posService.refundSale(id, dto, cashierId);
  }

  // ============================================================
  // LAYAWAY
  // ============================================================

  @Post('layaways')
  createLayaway(@Body() dto: CreateLayawayDto, @CurrentUser('id') cashierId: string) {
    return this.posService.createLayaway(dto, cashierId);
  }

  @Get('layaways')
  getLayaways(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.posService.getLayaways(status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get('layaways/:id')
  getLayaway(@Param('id') id: string) {
    return this.posService.getLayaway(id);
  }

  @Post('layaways/:id/payment')
  layawayPayment(
    @Param('id') id: string,
    @Body() dto: LayawayPaymentDto,
    @CurrentUser('id') cashierId: string,
  ) {
    return this.posService.layawayPayment(id, dto, cashierId);
  }

  @Post('layaways/:id/complete')
  completeLayaway(@Param('id') id: string, @CurrentUser('id') cashierId: string) {
    return this.posService.completeLayaway(id, cashierId);
  }

  @Post('layaways/:id/cancel')
  cancelLayaway(@Param('id') id: string) {
    return this.posService.cancelLayaway(id);
  }

  // ============================================================
  // EXCHANGE
  // ============================================================

  @Post('exchanges')
  createExchange(@Body() dto: CreateExchangeDto, @CurrentUser('id') cashierId: string) {
    return this.posService.createExchange(dto, cashierId);
  }

  @Get('exchanges')
  getExchanges(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.posService.getExchanges(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('exchanges/:id')
  getExchange(@Param('id') id: string) {
    return this.posService.getExchange(id);
  }

  // ============================================================
  // DAILY SUMMARY
  // ============================================================

  @Get('daily-summary')
  getDailySummary(@Query('date') date?: string) {
    return this.posService.getDailySummary(date);
  }
}

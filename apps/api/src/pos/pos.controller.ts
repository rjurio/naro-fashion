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
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
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
// PermissionGuard is a no-op on routes without @RequiresPermission; refunds and
// exchanges (which can pay cash out of the drawer) require 'pos:refund'.
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard, PermissionGuard)
@RequiresModule('pos')
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

  /**
   * Compact snapshot of every sellable product + active variant for the
   * admin's offline POS (search + barcode lookup while the API is
   * unreachable). Same guards/module as products/search; tenant-scoped.
   */
  @Get('catalog')
  getCatalog() {
    return this.posService.getCatalog();
  }

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
  createSale(@Body() dto: CreatePosSaleDto, @CurrentUser() user: any) {
    // The JWT user (role refreshed from the DB by the strategy) decides whether
    // non-cash tenders may be manually confirmed (payments:confirm-manual).
    return this.posService.createSale(dto, user.id, user);
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
  @RequiresPermission('pos:refund')
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
  createLayaway(@Body() dto: CreateLayawayDto, @CurrentUser() user: any) {
    return this.posService.createLayaway(dto, user.id, user);
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
    @CurrentUser() user: any,
  ) {
    return this.posService.layawayPayment(id, dto, user.id, user);
  }

  @Post('layaways/:id/complete')
  completeLayaway(@Param('id') id: string, @CurrentUser('id') cashierId: string) {
    return this.posService.completeLayaway(id, cashierId);
  }

  // R1b: was unpermissioned and unaudited. Paid instalments become an explicit refund request.
  @Post('layaways/:id/cancel')
  @RequiresPermission('pos:layaway-cancel')
  cancelLayaway(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser('id') actorId: string) {
    return this.posService.cancelLayaway(id, reason, actorId);
  }

  // ============================================================
  // EXCHANGE
  // ============================================================

  @Post('exchanges')
  @RequiresPermission('pos:refund')
  createExchange(@Body() dto: CreateExchangeDto, @CurrentUser() user: any) {
    return this.posService.createExchange(dto, user.id, user);
  }

  // ============================================================
  // PAYMENT REVERSAL (P0c) — a manually confirmed card / mobile-money
  // payment found invalid at reconciliation. Finance control: SUPER_ADMIN
  // by default (MANAGER excluded), audited.
  // ============================================================

  // Round 25F E: this route now only REQUESTS the reversal; a different
  // holder of payments:reverse approves it (and only then does it run).
  @Post('payments/:id/reverse')
  @RequiresPermission('payments:reverse')
  requestReversal(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.posService.requestReversal(id, reason, actorId);
  }

  @Get('reversal-requests')
  @RequiresPermission('payments:reverse')
  listReversalRequests(@Query('status') status?: string) {
    return this.posService.listReversalRequests(status);
  }

  @Patch('reversal-requests/:id/approve')
  @RequiresPermission('payments:reverse')
  approveReversal(@Param('id') id: string, @Body('note') note: string | undefined, @CurrentUser('id') actorId: string) {
    return this.posService.approveReversal(id, note, actorId);
  }

  @Patch('reversal-requests/:id/reject')
  @RequiresPermission('payments:reverse')
  rejectReversal(@Param('id') id: string, @Body('note') note: string | undefined, @CurrentUser('id') actorId: string) {
    return this.posService.rejectReversal(id, note, actorId);
  }

  @Patch('reversal-requests/:id/withdraw')
  @RequiresPermission('payments:reverse')
  withdrawReversal(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.posService.withdrawReversal(id, actorId);
  }

  // Round 25F E: independent review of manual card / mobile-money
  // confirmations (detection; changes no money). Managers hold reports:view.
  @Get('manual-confirmations')
  @RequiresPermission('reports:view')
  listManualConfirmations(@Query('filter') filter?: 'UNREVIEWED' | 'REVIEWED' | 'ALL') {
    return this.posService.listManualConfirmations(filter ?? 'UNREVIEWED');
  }

  @Post('manual-confirmations/:paymentId/review')
  @RequiresPermission('reports:view')
  reviewManualConfirmation(
    @Param('paymentId') paymentId: string,
    @Body('outcome') outcome: string,
    @Body('note') note: string | undefined,
    @CurrentUser('id') actorId: string,
  ) {
    return this.posService.reviewManualConfirmation(paymentId, outcome, note, actorId);
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

  /**
   * P0c: what THIS operator may confirm, so the POS can say so BEFORE money
   * is taken — and keep saying so offline (it caches the answer). The API
   * still enforces every payment; this is only for a clear explanation.
   */
  @Get('capabilities')
  getCapabilities(@CurrentUser() user: any) {
    return this.posService.getCapabilities(user);
  }
}

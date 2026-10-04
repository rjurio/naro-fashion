import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  Req,
  UseGuards,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Create a payment record (manual/admin use).
   */
  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payments:manage')
  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  /**
   * Initiate a payment through the resolved gateway (Selcom or ClickPesa).
   *
   * For MOBILE_MONEY: sends a USSD push to the customer's phone.
   * For CARD: returns a gateway URL for card checkout.
   *
   * The frontend should poll GET /payments/status/:transactionRef after calling this.
   */
  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  initiatePayment(@Body() dto: InitiatePaymentDto, @CurrentUser() user: any) {
    return this.paymentsService.initiateGatewayPayment(dto, user);
  }

  /**
   * Poll payment status. The frontend calls this every few seconds
   * after initiating a payment to check if it completed.
   */
  @UseGuards(JwtAuthGuard)
  @Get('status/:transactionRef')
  getPaymentStatus(
    @Param('transactionRef') transactionRef: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.pollPaymentStatus(transactionRef, user);
  }

  /**
   * Get all payments for an order.
   */
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  findByOrder(@Param('orderId') orderId: string, @CurrentUser() user: any) {
    return this.paymentsService.findByOrder(orderId, user);
  }

  /**
   * Get payment summary for an order (total due, total paid, balance).
   */
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId/summary')
  getPaymentSummary(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.getPaymentSummary(orderId, user);
  }

  /**
   * Get all payments for a rental order.
   */
  @UseGuards(JwtAuthGuard)
  @Get('rental/:rentalOrderId')
  findByRental(
    @Param('rentalOrderId') rentalOrderId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.findByRental(rentalOrderId, user);
  }

  /**
   * Update payment status (admin use) — e.g. manually mark COMPLETED, which
   * can flip the order to PAID, so it needs an explicit RBAC permission on
   * top of AdminGuard.
   */
  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payments:manage')
  @Patch(':id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.paymentsService.updateStatus(id, dto);
  }

  /**
   * Webhook endpoint for Selcom payment callbacks.
   *
   * Publicly accessible (no JWT) but protected by HMAC signature verification
   * over the RAW request bytes (`rawBody: true` in main.ts). Re-serialising the
   * parsed body (JSON.stringify) does not reproduce the bytes Selcom signed —
   * key order/whitespace/number formatting differ — so it either rejects
   * genuine callbacks or, worse, invites signing a different representation.
   * A missing raw body is treated as an invalid signature by the service.
   * Tenant resolved from TenantContext / X-Tenant-Id header.
   */
  @Public()
  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
    @Headers('digest') signature?: string,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : undefined;
    return this.paymentsService.handleWebhook(payload, rawBody, signature);
  }

  /**
   * Webhook endpoint for ClickPesa (Mixx by YAS) payment callbacks.
   *
   * ClickPesa cannot send an X-Tenant-Id header, so the tenant is encoded
   * in the URL path. Per-tenant credentials — including the checksumSecret
   * used to verify the HMAC — come from PaymentMethod.integrationParams.
   * ClickPesa's checksum is computed over the canonicalised parsed payload,
   * so the raw body is preferred but a re-serialisation is equivalent.
   */
  @Public()
  @Post('webhook/clickpesa/:tenantSlug')
  handleClickPesaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Param('tenantSlug') tenantSlug: string,
    @Body() payload: any,
    @Headers('x-clickpesa-signature') signature?: string,
  ) {
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(payload);
    return this.paymentsService.handleClickPesaWebhook({
      tenantSlug,
      payload,
      rawBody,
      signature,
    });
  }
}

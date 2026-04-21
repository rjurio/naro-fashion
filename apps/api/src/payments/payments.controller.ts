import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Create a payment record (manual/admin use).
   */
  @UseGuards(JwtAuthGuard)
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
  initiatePayment(@Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiateGatewayPayment(dto);
  }

  /**
   * Poll payment status. The frontend calls this every few seconds
   * after initiating a payment to check if it completed.
   */
  @UseGuards(JwtAuthGuard)
  @Get('status/:transactionRef')
  getPaymentStatus(@Param('transactionRef') transactionRef: string) {
    return this.paymentsService.pollPaymentStatus(transactionRef);
  }

  /**
   * Get all payments for an order.
   */
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  findByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.findByOrder(orderId);
  }

  /**
   * Get payment summary for an order (total due, total paid, balance).
   */
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId/summary')
  getPaymentSummary(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentSummary(orderId);
  }

  /**
   * Get all payments for a rental order.
   */
  @UseGuards(JwtAuthGuard)
  @Get('rental/:rentalOrderId')
  findByRental(@Param('rentalOrderId') rentalOrderId: string) {
    return this.paymentsService.findByRental(rentalOrderId);
  }

  /**
   * Update payment status (admin use).
   */
  @UseGuards(JwtAuthGuard)
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
   * Publicly accessible (no JWT) but protected by HMAC signature verification.
   * Tenant resolved from TenantContext / X-Tenant-Id header.
   */
  @Public()
  @Post('webhook')
  handleWebhook(
    @Body() payload: any,
    @Headers('digest') signature?: string,
  ) {
    const rawBody = JSON.stringify(payload);
    return this.paymentsService.handleWebhook(payload, rawBody, signature);
  }

  /**
   * Webhook endpoint for ClickPesa (Mixx by YAS) payment callbacks.
   *
   * ClickPesa cannot send an X-Tenant-Id header, so the tenant is encoded
   * in the URL path. Per-tenant credentials — including the checksumSecret
   * used to verify the HMAC — come from PaymentMethod.integrationParams.
   */
  @Public()
  @Post('webhook/clickpesa/:tenantSlug')
  handleClickPesaWebhook(
    @Param('tenantSlug') tenantSlug: string,
    @Body() payload: any,
    @Headers('x-clickpesa-signature') signature?: string,
  ) {
    const rawBody = JSON.stringify(payload);
    return this.paymentsService.handleClickPesaWebhook({
      tenantSlug,
      payload,
      rawBody,
      signature,
    });
  }
}

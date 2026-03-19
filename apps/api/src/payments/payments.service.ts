import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { SelcomProvider } from './selcom.provider';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly selcom: SelcomProvider,
    private readonly tenantContext: TenantContext,
  ) {}

  // ─── Payment record creation (existing) ───────────────────────────────

  async create(dto: CreatePaymentDto) {
    if (!dto.orderId && !dto.rentalOrderId) {
      throw new BadRequestException(
        'Either orderId or rentalOrderId must be provided',
      );
    }

    const tenantId = this.tenantContext.requireId;

    // Verify order/rental exists
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, tenantId },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
    }

    if (dto.rentalOrderId) {
      const rental = await this.prisma.rentalOrder.findFirst({
        where: { id: dto.rentalOrderId, tenantId },
      });
      if (!rental) {
        throw new NotFoundException('Rental order not found');
      }
    }

    const transactionRef =
      dto.transactionRef ||
      `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return this.prisma.payment.create({
      data: {
        tenantId,
        orderId: dto.orderId,
        rentalOrderId: dto.rentalOrderId,
        amount: dto.amount,
        method: dto.method,
        status: 'PENDING',
        transactionRef,
      },
      include: {
        order: { select: { id: true, orderNumber: true, total: true } },
        rentalOrder: {
          select: { id: true, rentalNumber: true, totalRentalPrice: true },
        },
      },
    });
  }

  // ─── Gateway payment initiation ───────────────────────────────────────

  /**
   * Initiate a payment through the Selcom gateway.
   *
   * 1. Creates a payment record in PENDING status
   * 2. Calls Selcom to initiate USSD push or card checkout
   * 3. Updates payment with gateway reference
   * 4. Returns payment record + gateway info for the frontend
   */
  async initiateGatewayPayment(dto: InitiatePaymentDto) {
    if (!dto.orderId && !dto.rentalOrderId) {
      throw new BadRequestException(
        'Either orderId or rentalOrderId must be provided',
      );
    }

    // For MOBILE_MONEY, phone number is required
    if (dto.method === 'MOBILE_MONEY' && !dto.phoneNumber) {
      throw new BadRequestException(
        'Phone number is required for mobile money payments',
      );
    }

    const tenantId = this.tenantContext.requireId;

    // Verify order/rental exists and get details
    let orderTotal = 0;
    let orderNumber = '';

    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, tenantId },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      orderTotal = Number(order.total);
      orderNumber = order.orderNumber;
    }

    if (dto.rentalOrderId) {
      const rental = await this.prisma.rentalOrder.findFirst({
        where: { id: dto.rentalOrderId, tenantId },
      });
      if (!rental) {
        throw new NotFoundException('Rental order not found');
      }
      orderTotal = Number(rental.totalRentalPrice);
      orderNumber = rental.rentalNumber;
    }

    // Validate amount does not exceed order total (allow partial payments)
    if (dto.amount > orderTotal && orderTotal > 0) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds order total (${orderTotal})`,
      );
    }

    // Generate a unique transaction reference
    const transactionRef = `NARO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        orderId: dto.orderId,
        rentalOrderId: dto.rentalOrderId,
        amount: dto.amount,
        method: dto.method,
        status: 'PENDING',
        transactionRef,
      },
      include: {
        order: { select: { id: true, orderNumber: true, total: true } },
        rentalOrder: {
          select: { id: true, rentalNumber: true, totalRentalPrice: true },
        },
      },
    });

    // Call Selcom to initiate the payment
    this.logger.log(
      `Initiating ${dto.method} payment for ${orderNumber}: ${dto.amount} TZS (ref: ${transactionRef})`,
    );

    const gatewayResponse = await this.selcom.initiatePayment({
      orderId: transactionRef,
      amount: dto.amount,
      phoneNumber: dto.phoneNumber,
      method: dto.method as 'MOBILE_MONEY' | 'CARD',
      buyerEmail: dto.buyerEmail,
      buyerName: dto.buyerName,
    });

    // Update payment with gateway response
    if (gatewayResponse.success) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PROCESSING',
          gatewayResponse: gatewayResponse.rawResponse ?? {
            transactionId: gatewayResponse.transactionId,
            reference: gatewayResponse.reference,
          },
        },
      });
    } else {
      // Gateway rejected — mark as failed
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          gatewayResponse: gatewayResponse.rawResponse ?? {
            error: gatewayResponse.message,
          },
        },
      });
    }

    return {
      paymentId: payment.id,
      transactionRef,
      status: gatewayResponse.success ? 'PROCESSING' : 'FAILED',
      gatewaySuccess: gatewayResponse.success,
      gatewayUrl: gatewayResponse.gatewayUrl,
      message: gatewayResponse.message,
      method: dto.method,
    };
  }

  // ─── Payment status polling ───────────────────────────────────────────

  /**
   * Check the status of a payment. The frontend polls this endpoint.
   *
   * If the payment is still PROCESSING, it also queries the Selcom API
   * for a real-time status update and syncs it to the database.
   */
  async pollPaymentStatus(transactionRef: string) {
    const tenantId = this.tenantContext.requireId;

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef, tenantId },
      include: {
        order: { select: { id: true, orderNumber: true } },
        rentalOrder: { select: { id: true, rentalNumber: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment with ref ${transactionRef} not found`,
      );
    }

    // If already in a terminal state, return immediately
    if (['COMPLETED', 'FAILED', 'REFUNDED'].includes(payment.status)) {
      return {
        paymentId: payment.id,
        transactionRef: payment.transactionRef,
        status: payment.status,
        amount: payment.amount,
        method: payment.method,
        orderId: payment.orderId,
        rentalOrderId: payment.rentalOrderId,
      };
    }

    // If still processing, check with the gateway
    const gatewayStatus =
      await this.selcom.checkPaymentStatus(transactionRef);

    if (
      gatewayStatus.success &&
      gatewayStatus.status !== 'PENDING'
    ) {
      // Update payment record with new status
      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: gatewayStatus.status,
          gatewayResponse: gatewayStatus.rawResponse ?? payment.gatewayResponse,
        },
      });

      // If completed, update order payment status
      if (gatewayStatus.status === 'COMPLETED' && payment.orderId) {
        await this.updateOrderPaymentStatus(payment.orderId);
      }
      if (gatewayStatus.status === 'COMPLETED' && payment.rentalOrderId) {
        await this.updateRentalPaymentStatus(payment.rentalOrderId);
      }

      return {
        paymentId: updatedPayment.id,
        transactionRef: updatedPayment.transactionRef,
        status: updatedPayment.status,
        amount: updatedPayment.amount,
        method: updatedPayment.method,
        orderId: updatedPayment.orderId,
        rentalOrderId: updatedPayment.rentalOrderId,
      };
    }

    // Still pending/processing
    return {
      paymentId: payment.id,
      transactionRef: payment.transactionRef,
      status: payment.status,
      amount: payment.amount,
      method: payment.method,
      orderId: payment.orderId,
      rentalOrderId: payment.rentalOrderId,
    };
  }

  // ─── Webhook handling (with signature verification) ───────────────────

  /**
   * Handle incoming webhook callbacks from Selcom.
   *
   * The controller passes the raw body + signature header so we can
   * verify authenticity before processing.
   */
  async handleWebhook(
    payload: {
      transactionRef?: string;
      order_id?: string;
      reference?: string;
      status?: string;
      payment_status?: string;
      result?: string;
      resultcode?: string;
      transid?: string;
      [key: string]: any;
    },
    rawBody?: string,
    signature?: string,
  ) {
    // Verify webhook signature if Selcom is configured
    if (rawBody && signature && this.selcom.configured) {
      const isValid = this.selcom.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        this.logger.warn('Webhook rejected: invalid signature');
        throw new ForbiddenException('Invalid webhook signature');
      }
    }

    // Extract the transaction reference — Selcom may use different field names
    const txnRef =
      payload.transactionRef ||
      payload.order_id ||
      payload.reference;

    if (!txnRef) {
      this.logger.warn('Webhook received without transaction reference');
      throw new BadRequestException(
        'Missing transaction reference in webhook payload',
      );
    }

    const tenantId = this.tenantContext.requireId;

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: txnRef, tenantId },
    });

    if (!payment) {
      this.logger.warn(`Webhook: payment not found for ref ${txnRef}`);
      throw new NotFoundException(
        `Payment with ref ${txnRef} not found`,
      );
    }

    // Map the status from the webhook
    const webhookStatus =
      payload.status ||
      payload.payment_status ||
      payload.result;

    const mappedStatus = this.mapWebhookStatus(webhookStatus);

    this.logger.log(
      `Webhook: updating payment ${payment.id} (ref: ${txnRef}) to ${mappedStatus}`,
    );

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: mappedStatus,
        gatewayResponse: payload,
      },
    });

    // Update order/rental payment status based on total paid
    if (mappedStatus === 'COMPLETED') {
      if (updated.orderId) {
        await this.updateOrderPaymentStatus(updated.orderId);
      }
      if (updated.rentalOrderId) {
        await this.updateRentalPaymentStatus(updated.rentalOrderId);
      }
    }

    return { received: true, paymentId: updated.id, status: updated.status };
  }

  // ─── Existing query methods ───────────────────────────────────────────

  async findByOrder(orderId: string) {
    const tenantId = this.tenantContext.requireId;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.payment.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRental(rentalOrderId: string) {
    const tenantId = this.tenantContext.requireId;

    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    return this.prisma.payment.findMany({
      where: { rentalOrderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, dto: UpdatePaymentDto) {
    const tenantId = this.tenantContext.requireId;

    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        status: dto.status,
        gatewayResponse: dto.gatewayResponse ?? undefined,
      },
      include: {
        order: { select: { id: true, orderNumber: true } },
        rentalOrder: { select: { id: true, rentalNumber: true } },
      },
    });

    // If payment completed and linked to an order, update order payment status
    if (dto.status === 'COMPLETED' && updated.orderId) {
      await this.updateOrderPaymentStatus(updated.orderId);
    }
    if (dto.status === 'COMPLETED' && updated.rentalOrderId) {
      await this.updateRentalPaymentStatus(updated.rentalOrderId);
    }

    return updated;
  }

  async getPaymentSummary(orderId: string) {
    const tenantId = this.tenantContext.requireId;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: { orderId, tenantId, status: 'COMPLETED' },
    });

    const totalPaid = payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const totalDue = Number(order.total);

    return {
      orderId,
      orderNumber: order.orderNumber,
      totalDue,
      totalPaid,
      balance: totalDue - totalPaid,
      isFullyPaid: totalPaid >= totalDue,
      payments,
    };
  }

  // ─── Internal helpers ─────────────────────────────────────────────────

  private mapWebhookStatus(status: string | undefined): string {
    if (!status) return 'PENDING';

    const normalized = status.toUpperCase();

    if (['COMPLETED', 'SUCCESSFUL', 'SUCCESS', 'PAID'].includes(normalized)) {
      return 'COMPLETED';
    }
    if (['FAILED', 'REJECTED', 'DECLINED'].includes(normalized)) {
      return 'FAILED';
    }
    if (['CANCELLED', 'EXPIRED'].includes(normalized)) {
      return 'FAILED';
    }
    if (['PROCESSING', 'PENDING'].includes(normalized)) {
      return 'PROCESSING';
    }

    return 'PENDING';
  }

  private async updateOrderPaymentStatus(orderId: string) {
    const tenantId = this.tenantContext.requireId;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) return;

    const completedPayments = await this.prisma.payment.findMany({
      where: { orderId, tenantId, status: 'COMPLETED' },
    });

    const totalPaid = completedPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const totalDue = Number(order.total);

    let paymentStatus = 'PENDING';
    if (totalPaid >= totalDue) {
      paymentStatus = 'PAID';
    } else if (totalPaid > 0) {
      paymentStatus = 'PARTIAL';
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus },
    });
  }

  /**
   * Update rental order status based on completed payments.
   *
   * RentalOrder uses a `status` field (not a separate `paymentStatus`).
   * When the down payment is received, move from pending statuses to CONFIRMED.
   */
  private async updateRentalPaymentStatus(rentalOrderId: string) {
    const tenantId = this.tenantContext.requireId;

    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId },
    });
    if (!rental) return;

    const completedPayments = await this.prisma.payment.findMany({
      where: { rentalOrderId, tenantId, status: 'COMPLETED' },
    });

    const totalPaid = completedPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const downPaymentDue = Number(rental.downPaymentAmount);

    // If the down payment has been received and the rental is still in a
    // pending state, advance it to CONFIRMED.
    const pendingStatuses = [
      'PENDING_ID_VERIFICATION',
      'PENDING_PAYMENT',
      'PENDING',
    ];

    if (totalPaid >= downPaymentDue && pendingStatuses.includes(rental.status)) {
      await this.prisma.rentalOrder.update({
        where: { id: rentalOrderId },
        data: { status: 'CONFIRMED' },
      });

      this.logger.log(
        `Rental ${rental.rentalNumber} confirmed — down payment of ${totalPaid} TZS received`,
      );
    }
  }
}

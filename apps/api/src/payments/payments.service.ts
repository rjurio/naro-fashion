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
import { PaymentProviderRegistry } from './payment-provider.registry';
import {
  PROVIDER_CODES,
  ProviderCode,
  ProviderCredentials,
} from './payment-provider.types';
import { ownerScope, isAdminUser } from '../auth/util/ownership';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
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
   * Initiate a payment through the resolved gateway (Selcom or ClickPesa).
   *
   * 1. Resolves the provider from dto.providerCode or the tenant's active PaymentMethod.
   * 2. Creates a payment record in PENDING status.
   * 3. Calls the provider to initiate USSD push or card checkout.
   * 4. Updates payment with gateway reference + provider code.
   * 5. Returns payment record + gateway info for the frontend.
   */
  async initiateGatewayPayment(dto: InitiatePaymentDto, user: any) {
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

    // Verify order/rental exists and get details. Customers can only pay for
    // their own orders/rentals; admins (incl. POS cashiers) can pay on behalf
    // of any customer in the tenant.
    let orderTotal = 0;
    let orderNumber = '';

    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, tenantId, ...ownerScope(user) },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      orderTotal = Number(order.total);
      orderNumber = order.orderNumber;
    }

    if (dto.rentalOrderId) {
      const rental = await this.prisma.rentalOrder.findFirst({
        where: { id: dto.rentalOrderId, tenantId, ...ownerScope(user) },
      });
      if (!rental) {
        throw new NotFoundException('Rental order not found');
      }
      orderTotal = Number(rental.totalRentalPrice);
      orderNumber = rental.rentalNumber;
    }

    if (dto.amount > orderTotal && orderTotal > 0) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds order total (${orderTotal})`,
      );
    }

    // Resolve which provider handles this request.
    const providerCode = await this.resolveProviderCode(
      tenantId,
      dto.method,
      dto.providerCode,
    );
    const provider = this.registry.resolve(providerCode);
    const creds = await this.loadTenantCredentials(tenantId, providerCode);

    const transactionRef = `NARO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        orderId: dto.orderId,
        rentalOrderId: dto.rentalOrderId,
        amount: dto.amount,
        method: dto.method,
        status: 'PENDING',
        transactionRef,
        providerCode,
      },
      include: {
        order: { select: { id: true, orderNumber: true, total: true } },
        rentalOrder: {
          select: { id: true, rentalNumber: true, totalRentalPrice: true },
        },
      },
    });

    this.logger.log(
      `Initiating ${dto.method} via ${providerCode} for ${orderNumber}: ${dto.amount} TZS (ref: ${transactionRef})`,
    );

    const gatewayResponse = await provider.initiatePayment(
      {
        orderId: transactionRef,
        amount: dto.amount,
        phoneNumber: dto.phoneNumber,
        method: dto.method as 'MOBILE_MONEY' | 'CARD',
        buyerEmail: dto.buyerEmail,
        buyerName: dto.buyerName,
      },
      creds,
    );

    if (gatewayResponse.success) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PROCESSING',
          providerTransactionId: gatewayResponse.transactionId ?? null,
          gatewayResponse: gatewayResponse.rawResponse ?? {
            transactionId: gatewayResponse.transactionId,
            reference: gatewayResponse.reference,
          },
        },
      });
    } else {
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
      providerCode,
    };
  }

  // ─── Payment status polling ───────────────────────────────────────────

  async pollPaymentStatus(transactionRef: string, user: any) {
    const tenantId = this.tenantContext.requireId;

    // Admins can poll any payment in the tenant; customers only their own
    // (joined through order.userId or rentalOrder.userId).
    const ownerFilter = isAdminUser(user)
      ? {}
      : {
          OR: [
            { order: { userId: user?.id } },
            { rentalOrder: { userId: user?.id } },
          ],
        };

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef, tenantId, ...ownerFilter },
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

    if (['COMPLETED', 'FAILED', 'REFUNDED'].includes(payment.status)) {
      return this.paymentResponse(payment);
    }

    // Dispatch to the right provider.
    const providerCode =
      (payment.providerCode as ProviderCode | null) ?? PROVIDER_CODES.SELCOM;
    const provider = this.registry.resolve(providerCode);
    const creds = await this.loadTenantCredentials(tenantId, providerCode);

    const gatewayStatus = await provider.checkPaymentStatus(
      transactionRef,
      creds,
    );

    if (
      gatewayStatus.success &&
      gatewayStatus.status !== 'PENDING' &&
      gatewayStatus.status !== 'PROCESSING'
    ) {
      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: gatewayStatus.status,
          lastPolledAt: new Date(),
          gatewayResponse:
            gatewayStatus.rawResponse ?? payment.gatewayResponse ?? undefined,
        },
      });

      if (gatewayStatus.status === 'COMPLETED' && payment.orderId) {
        await this.updateOrderPaymentStatus(payment.orderId, tenantId);
      }
      if (gatewayStatus.status === 'COMPLETED' && payment.rentalOrderId) {
        await this.updateRentalPaymentStatus(payment.rentalOrderId, tenantId);
      }

      return this.paymentResponse(updatedPayment);
    }

    // Still pending/processing — just update lastPolledAt for reconciliation.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { lastPolledAt: new Date() },
    });

    return this.paymentResponse(payment);
  }

  // ─── Webhook handling ─────────────────────────────────────────────────

  /**
   * Selcom webhook (legacy route; tenant comes from TenantContext).
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
    opts?: { tenantId?: string; providerCode?: ProviderCode },
  ) {
    const providerCode = opts?.providerCode ?? PROVIDER_CODES.SELCOM;
    const tenantId = opts?.tenantId ?? this.tenantContext.requireId;

    const provider = this.registry.resolve(providerCode);
    const creds = await this.loadTenantCredentials(tenantId, providerCode);

    // Verify webhook signature.
    if (rawBody) {
      const isValid = provider.verifyWebhookSignature(
        rawBody,
        signature,
        creds,
      );
      if (!isValid) {
        this.logger.warn(
          `Webhook rejected: invalid signature for ${providerCode}`,
        );
        throw new ForbiddenException('Invalid webhook signature');
      }
    }

    const txnRef = this.extractTransactionRef(payload, providerCode);

    if (!txnRef) {
      this.logger.warn('Webhook received without transaction reference');
      throw new BadRequestException(
        'Missing transaction reference in webhook payload',
      );
    }

    const payment = await this.prisma.payment.findFirst({
      where: { tenantId, OR: [{ transactionRef: txnRef }, { transactionRef: this.denormalizeClickPesaRef(txnRef) }] },
    });

    if (!payment) {
      this.logger.warn(`Webhook: payment not found for ref ${txnRef}`);
      throw new NotFoundException(`Payment with ref ${txnRef} not found`);
    }

    const webhookStatus =
      payload.status ||
      payload.payment_status ||
      payload.result ||
      payload.event;

    const mappedStatus = this.mapWebhookStatus(webhookStatus);

    this.logger.log(
      `Webhook (${providerCode}): updating payment ${payment.id} (ref: ${txnRef}) → ${mappedStatus}`,
    );

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: mappedStatus,
        providerCode: payment.providerCode ?? providerCode,
        providerTransactionId:
          payment.providerTransactionId ??
          payload.id ??
          payload.transid ??
          null,
        gatewayResponse: payload,
      },
    });

    if (mappedStatus === 'COMPLETED') {
      if (updated.orderId) {
        await this.updateOrderPaymentStatus(updated.orderId, tenantId);
      }
      if (updated.rentalOrderId) {
        await this.updateRentalPaymentStatus(updated.rentalOrderId, tenantId);
      }
    }

    return { received: true, paymentId: updated.id, status: updated.status };
  }

  /**
   * ClickPesa webhook entry point. Tenant resolved from URL slug.
   * Deduplicated via WebhookEvent (providerCode + eventId + type).
   */
  async handleClickPesaWebhook(args: {
    tenantSlug: string;
    payload: any;
    rawBody: string;
    signature: string | undefined;
  }) {
    const { tenantSlug, payload, rawBody, signature } = args;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    }
    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      throw new ForbiddenException(`Tenant ${tenantSlug} is not active`);
    }

    const providerCode: ProviderCode = PROVIDER_CODES.CLICKPESA_MIXX;
    const creds = await this.loadTenantCredentials(tenant.id, providerCode);
    const provider = this.registry.resolve(providerCode);

    // Checksum verification
    const checksum =
      payload?.checksum ?? (payload?.data && payload.data.checksum);
    const checksumValid = provider.verifyWebhookSignature(
      rawBody,
      typeof checksum === 'string' ? checksum : signature,
      creds,
    );

    // Persist the event first (idempotent).
    const eventType = String(payload?.event ?? 'UNKNOWN');
    const data = payload?.data ?? payload ?? {};
    const providerEventId = String(
      data?.id ?? data?.paymentReference ?? data?.orderReference ?? rawBody.length,
    );
    const orderReference = data?.orderReference ?? null;

    try {
      await this.prisma.webhookEvent.create({
        data: {
          tenantId: tenant.id,
          providerCode,
          providerEventId,
          eventType,
          orderReference,
          checksumValid,
          rawPayload: payload,
          processed: false,
        },
      });
    } catch (err: any) {
      // Unique constraint = duplicate delivery. Ack and move on.
      if (err?.code === 'P2002') {
        this.logger.log(
          `ClickPesa webhook duplicate (${eventType}/${providerEventId}) — ack`,
        );
        return { received: true, duplicate: true };
      }
      throw err;
    }

    if (!checksumValid) {
      this.logger.warn(
        `ClickPesa webhook: invalid checksum for event ${eventType}/${providerEventId}`,
      );
      throw new ForbiddenException('Invalid webhook checksum');
    }

    // Hand off to the shared handler with explicit tenantId.
    const result = await this.handleWebhook(
      {
        ...data,
        event: eventType,
      },
      undefined, // signature already verified above
      undefined,
      { tenantId: tenant.id, providerCode },
    );

    await this.prisma.webhookEvent.updateMany({
      where: {
        providerCode,
        providerEventId,
        eventType,
      },
      data: { processed: true },
    });

    return result;
  }

  // ─── Existing query methods ───────────────────────────────────────────

  async findByOrder(orderId: string, user: any) {
    const tenantId = this.tenantContext.requireId;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, ...ownerScope(user) },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.payment.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRental(rentalOrderId: string, user: any) {
    const tenantId = this.tenantContext.requireId;

    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId, ...ownerScope(user) },
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

    if (dto.status === 'COMPLETED' && updated.orderId) {
      await this.updateOrderPaymentStatus(updated.orderId, tenantId);
    }
    if (dto.status === 'COMPLETED' && updated.rentalOrderId) {
      await this.updateRentalPaymentStatus(updated.rentalOrderId, tenantId);
    }

    return updated;
  }

  async getPaymentSummary(orderId: string, user: any) {
    const tenantId = this.tenantContext.requireId;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, ...ownerScope(user) },
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

  /**
   * Figure out which provider runs a given (method, tenant) pair.
   * Preference: explicit dto.providerCode → tenant's single active mobile-money
   * PaymentMethod → SELCOM fallback.
   */
  private async resolveProviderCode(
    tenantId: string,
    method: string,
    explicitCode?: string,
  ): Promise<ProviderCode> {
    if (explicitCode && this.registry.has(explicitCode)) {
      return explicitCode as ProviderCode;
    }

    if (method !== 'MOBILE_MONEY') {
      // Cards: fall through to Selcom (the only card-capable provider today).
      return PROVIDER_CODES.SELCOM;
    }

    // Look for an active tenant PaymentMethod with a code the registry knows about.
    const methods = await this.prisma.paymentMethod.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        code: { in: this.registry.list() },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const clickpesa = methods.find(
      (m) => m.code === PROVIDER_CODES.CLICKPESA_MIXX,
    );
    if (clickpesa) return PROVIDER_CODES.CLICKPESA_MIXX;

    return PROVIDER_CODES.SELCOM;
  }

  /**
   * Load per-tenant credentials for a provider from PaymentMethod.integrationParams.
   * Returns undefined for providers that don't need per-tenant creds (Selcom today).
   */
  private async loadTenantCredentials(
    tenantId: string,
    providerCode: ProviderCode,
  ): Promise<ProviderCredentials | undefined> {
    if (providerCode === PROVIDER_CODES.SELCOM) {
      // Selcom reads from global env vars; no per-tenant creds needed.
      return undefined;
    }

    const pm = await this.prisma.paymentMethod.findFirst({
      where: {
        tenantId,
        code: providerCode,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!pm || !pm.integrationParams) {
      throw new BadRequestException(
        `No active PaymentMethod with code ${providerCode} configured for this tenant.`,
      );
    }

    return pm.integrationParams as ProviderCredentials;
  }

  private extractTransactionRef(
    payload: any,
    providerCode: ProviderCode,
  ): string | undefined {
    if (providerCode === PROVIDER_CODES.CLICKPESA_MIXX) {
      return (
        payload.orderReference ||
        payload.reference ||
        payload.order_id ||
        payload.transactionRef
      );
    }
    return (
      payload.transactionRef ||
      payload.order_id ||
      payload.reference ||
      payload.orderReference
    );
  }

  /**
   * ClickPesa strips non-alphanumerics from transaction refs, so "NARO-123..."
   * arrives back as "NARO123...". Undo that to look up our Payment row.
   */
  private denormalizeClickPesaRef(sanitized: string): string {
    const match = sanitized.match(/^NARO(\d+)(.+)$/);
    if (!match) return sanitized;
    return `NARO-${match[1]}-${match[2]}`;
  }

  private paymentResponse(payment: {
    id: string;
    transactionRef: string | null;
    status: string;
    amount: any;
    method: string;
    orderId: string | null;
    rentalOrderId: string | null;
  }) {
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

  private mapWebhookStatus(status: string | undefined): string {
    if (!status) return 'PENDING';

    const normalized = status.toUpperCase();

    if (
      [
        'COMPLETED',
        'SUCCESSFUL',
        'SUCCESS',
        'SETTLED',
        'PAID',
        'PAYMENT_RECEIVED',
      ].includes(normalized)
    ) {
      return 'COMPLETED';
    }
    if (
      ['FAILED', 'REJECTED', 'DECLINED', 'PAYMENT_FAILED'].includes(normalized)
    ) {
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

  private async updateOrderPaymentStatus(
    orderId: string,
    tenantId: string,
  ) {
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

  private async updateRentalPaymentStatus(
    rentalOrderId: string,
    tenantId: string,
  ) {
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

    const pendingStatuses = [
      'PENDING_ID_VERIFICATION',
      'PENDING_PAYMENT',
      'PENDING',
    ];

    if (
      totalPaid >= downPaymentDue &&
      pendingStatuses.includes(rental.status)
    ) {
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

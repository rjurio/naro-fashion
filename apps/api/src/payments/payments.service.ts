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
import {
  PaymentSettlementService,
  extractReportedAmount,
  mapGatewayStatus,
  sha256Hex,
} from './payment-settlement.service';
import { ownerScope, isAdminUser } from '../auth/util/ownership';

/** Order statuses that can never take a new payment. */
const UNPAYABLE_ORDER_STATUSES = ['CANCELLED', 'REFUNDED'];
/** Order payment statuses that mean "nothing more to collect". */
const UNPAYABLE_ORDER_PAYMENT_STATUSES = ['PAID', 'REFUNDED', 'CANCELLED'];
/**
 * Rental statuses that can never take a new payment. RETURNED / INSPECTION
 * stay payable so late fees can still be collected.
 */
const UNPAYABLE_RENTAL_STATUSES = ['CANCELLED', 'CLOSED', 'REJECTED', 'ID_REJECTED'];

/** Window in which a PENDING/PROCESSING payment is returned as a duplicate. */
const INFLIGHT_DUPLICATE_WINDOW_MS = 3 * 60 * 1000;
/** In-flight payments younger than this still count against the balance cap. */
const INFLIGHT_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly tenantContext: TenantContext,
    private readonly settlement: PaymentSettlementService,
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
   * 2. Under a per-order/rental advisory lock: validates the order/rental is
   *    payable, returns a recent in-flight payment as a duplicate, enforces
   *    the cumulative balance cap, and creates the payment in PENDING.
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
    if (dto.orderId && dto.rentalOrderId) {
      throw new BadRequestException(
        'Provide either orderId or rentalOrderId, not both',
      );
    }

    // For MOBILE_MONEY, phone number is required
    if (dto.method === 'MOBILE_MONEY' && !dto.phoneNumber) {
      throw new BadRequestException(
        'Phone number is required for mobile money payments',
      );
    }

    const tenantId = this.tenantContext.requireId;

    // Resolve which provider handles this request (throws early if the
    // tenant's provider isn't configured — before any row is written).
    const providerCode = await this.resolveProviderCode(
      tenantId,
      dto.method,
      dto.providerCode,
    );
    const provider = this.registry.resolve(providerCode);
    const creds = await this.loadTenantCredentials(tenantId, providerCode);

    const transactionRef = `NARO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const parentWhere = dto.orderId
      ? { orderId: dto.orderId }
      : { rentalOrderId: dto.rentalOrderId as string };
    const lockKey = dto.orderId
      ? `payment:order:${dto.orderId}`
      : `payment:rental:${dto.rentalOrderId}`;

    // Check-then-insert used to be racy: two concurrent submits both saw "no
    // in-flight payment" and both charged the customer. Serialize every
    // initiation for the same order/rental with a transaction-scoped advisory
    // lock (auto-released on commit/rollback), same pattern as rental booking.
    const prepared = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Verify order/rental exists and is payable. Customers can only pay for
      // their own orders/rentals; admins (incl. POS cashiers) can pay on
      // behalf of any customer in the tenant.
      let amountDue = 0;
      let orderNumber = '';

      if (dto.orderId) {
        const order = await tx.order.findFirst({
          where: { id: dto.orderId, tenantId, ...ownerScope(user) },
        });
        if (!order) {
          throw new NotFoundException('Order not found');
        }
        if (UNPAYABLE_ORDER_STATUSES.includes(order.status)) {
          throw new BadRequestException(
            `Order ${order.orderNumber} is ${order.status} and cannot be paid`,
          );
        }
        if (UNPAYABLE_ORDER_PAYMENT_STATUSES.includes(order.paymentStatus)) {
          throw new BadRequestException(
            `Order ${order.orderNumber} is already ${order.paymentStatus}`,
          );
        }
        amountDue = Number(order.total);
        orderNumber = order.orderNumber;
      } else {
        const rental = await tx.rentalOrder.findFirst({
          where: { id: dto.rentalOrderId, tenantId, ...ownerScope(user) },
        });
        if (!rental) {
          throw new NotFoundException('Rental order not found');
        }
        if (UNPAYABLE_RENTAL_STATUSES.includes(rental.status)) {
          throw new BadRequestException(
            `Rental ${rental.rentalNumber} is ${rental.status} and cannot be paid`,
          );
        }
        // Everything the customer can legitimately owe on a rental: the
        // rental price, the refundable damage deposit, and any late fee.
        amountDue =
          Number(rental.totalRentalPrice) +
          Number(rental.damageDeposit ?? 0) +
          Number(rental.lateFee ?? 0);
        orderNumber = rental.rentalNumber;
      }

      // Guard against duplicate in-flight payments on the same order/rental —
      // a double-click or double-submit would otherwise trigger two gateway
      // charges. If a RECENT PENDING/PROCESSING payment exists, return it so
      // the frontend polls that one.
      const inflight = await tx.payment.findFirst({
        where: {
          tenantId,
          ...parentWhere,
          status: { in: ['PENDING', 'PROCESSING'] },
          createdAt: { gte: new Date(Date.now() - INFLIGHT_DUPLICATE_WINDOW_MS) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (inflight) {
        return { duplicate: inflight, orderNumber } as const;
      }

      // Cumulative cap: COMPLETED + still-in-flight payments + this one may
      // never exceed what's owed. Previously only `amount <= total` was
      // checked per payment, so N payments of the full total all went through.
      const [completedAgg, inflightAgg] = await Promise.all([
        tx.payment.aggregate({
          _sum: { amount: true },
          where: { tenantId, ...parentWhere, status: 'COMPLETED' },
        }),
        tx.payment.aggregate({
          _sum: { amount: true },
          where: {
            tenantId,
            ...parentWhere,
            status: { in: ['PENDING', 'PROCESSING'] },
            createdAt: { gte: new Date(Date.now() - INFLIGHT_CAP_WINDOW_MS) },
          },
        }),
      ]);
      const alreadyCommitted =
        Number(completedAgg._sum.amount ?? 0) +
        Number(inflightAgg._sum.amount ?? 0);
      const remaining = Math.max(0, amountDue - alreadyCommitted);

      if (remaining <= 0) {
        throw new BadRequestException(
          `Nothing left to pay on ${orderNumber} (total ${amountDue}, already paid or in progress ${alreadyCommitted})`,
        );
      }
      if (dto.amount > remaining + 0.001) {
        throw new BadRequestException(
          `Payment amount (${dto.amount}) exceeds the outstanding balance (${remaining}) for ${orderNumber}`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          tenantId,
          ...parentWhere,
          amount: dto.amount,
          method: dto.method,
          status: 'PENDING',
          transactionRef,
          providerCode,
        },
      });

      return { payment, orderNumber } as const;
    });

    if ('duplicate' in prepared && prepared.duplicate) {
      const inflight = prepared.duplicate;
      this.logger.warn(
        `Duplicate payment initiation blocked for ${prepared.orderNumber} — returning in-flight ref ${inflight.transactionRef}`,
      );
      return {
        paymentId: inflight.id,
        transactionRef: inflight.transactionRef,
        status: inflight.status,
        gatewaySuccess: inflight.status === 'PROCESSING',
        gatewayUrl: undefined,
        message: 'A payment for this order is already in progress. Please wait for it to complete or poll its status.',
        method: dto.method,
        providerCode: inflight.providerCode ?? undefined,
        duplicate: true,
      };
    }

    const { payment, orderNumber } = prepared as Extract<
      typeof prepared,
      { payment: unknown }
    >;

    this.logger.log(
      `Initiating ${dto.method} via ${providerCode} for ${orderNumber}: ${dto.amount} TZS (ref: ${transactionRef})`,
    );

    let gatewayResponse;
    try {
      gatewayResponse = await provider.initiatePayment(
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
    } catch (err) {
      // Provider refused outright (e.g. Selcom unconfigured in production):
      // fail the row so it doesn't hold the balance cap for 24h.
      await this.prisma.payment.updateMany({
        where: { id: payment.id, tenantId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          gatewayResponse: {
            error: err instanceof Error ? err.message : String(err),
          },
        },
      });
      throw err;
    }

    // Conditional on PENDING so a webhook that raced ahead of this response
    // (already COMPLETED the payment) is never overwritten.
    if (gatewayResponse.success) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, tenantId, status: 'PENDING' },
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
      await this.prisma.payment.updateMany({
        where: { id: payment.id, tenantId, status: 'PENDING' },
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

    // Dispatch to the right provider. Gateway-initiated payments always carry
    // providerCode; null only on legacy rows, which predate the registry and
    // were all Selcom.
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
      // Same settlement path as webhooks + reconciliation: amount check,
      // never-downgrade CAS, shared order/rental roll-up.
      const result = await this.settlement.applyGatewayResult({
        payment,
        tenantId,
        status: mapGatewayStatus(gatewayStatus.status),
        reportedAmount: gatewayStatus.collectedAmount ?? null,
        gatewayResponse: gatewayStatus.rawResponse ?? undefined,
        extraData: { lastPolledAt: new Date() },
        source: `poll:${providerCode}`,
      });

      return this.paymentResponse({ ...payment, status: result.status });
    }

    // Still pending/processing — just update lastPolledAt for reconciliation.
    await this.prisma.payment.updateMany({
      where: { id: payment.id, tenantId },
      data: { lastPolledAt: new Date() },
    });

    return this.paymentResponse(payment);
  }

  // ─── Webhook handling ─────────────────────────────────────────────────

  /**
   * Shared webhook handler. The Selcom route (tenant from TenantContext)
   * calls it with the RAW request body; signature verification is mandatory
   * — a missing raw body is rejected rather than silently skipping the check.
   * The ClickPesa route verifies its checksum itself and passes
   * `signatureVerified: true`.
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
    opts?: {
      tenantId?: string;
      providerCode?: ProviderCode;
      signatureVerified?: boolean;
    },
  ) {
    const providerCode = opts?.providerCode ?? PROVIDER_CODES.SELCOM;
    const tenantId = opts?.tenantId ?? this.tenantContext.requireId;

    const provider = this.registry.resolve(providerCode);
    const creds = await this.loadTenantCredentials(tenantId, providerCode);

    // Verify webhook signature — mandatory unless the caller already did.
    if (!opts?.signatureVerified) {
      if (typeof rawBody !== 'string') {
        this.logger.warn(
          `Webhook rejected: no raw body available to verify ${providerCode} signature`,
        );
        throw new ForbiddenException('Invalid webhook signature');
      }
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

    // Scope by provider: a (validly signed) Selcom callback must never be
    // able to settle a ClickPesa payment — or a manual/POS row — that happens
    // to share a ref. Only ClickPesa strips hyphens from refs.
    const refs =
      providerCode === PROVIDER_CODES.CLICKPESA_MIXX
        ? Array.from(new Set([txnRef, this.denormalizeClickPesaRef(txnRef)]))
        : [txnRef];

    const payment = await this.prisma.payment.findFirst({
      where: { tenantId, providerCode, transactionRef: { in: refs } },
    });

    if (!payment) {
      this.logger.warn(
        `Webhook (${providerCode}): payment not found for ref ${txnRef}`,
      );
      throw new NotFoundException(`Payment with ref ${txnRef} not found`);
    }

    const webhookStatus =
      payload.status ||
      payload.payment_status ||
      payload.result ||
      payload.event;

    const result = await this.settlement.applyGatewayResult({
      payment,
      tenantId,
      status: mapGatewayStatus(webhookStatus),
      reportedAmount: extractReportedAmount(payload),
      gatewayResponse: payload,
      extraData: {
        providerTransactionId:
          payment.providerTransactionId ??
          payload.id ??
          payload.transid ??
          null,
      },
      source: `webhook:${providerCode}`,
    });

    return { received: true, paymentId: payment.id, status: result.status };
  }

  /**
   * ClickPesa webhook entry point. Tenant resolved from URL slug.
   * Deduplicated via WebhookEvent (tenant + providerCode + eventId + type).
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

    const eventType = String(payload?.event ?? 'UNKNOWN');
    const data = payload?.data ?? payload ?? {};
    // Fallback id is a content hash, never the body length (two different
    // events of equal length would collide and the second be dropped).
    const providerEventId = String(
      data?.id ?? data?.paymentReference ?? data?.orderReference ?? sha256Hex(rawBody),
    );
    const orderReference = data?.orderReference ?? null;

    // Reject invalid checksums BEFORE writing the idempotency row. Otherwise an
    // attacker who guesses/observes an orderReference could POST an unsigned
    // junk webhook, which would persist the dedup row (processed:false); the
    // genuine ClickPesa callback then collides on the unique key, is acked as a
    // duplicate, and the real completion is never processed via the webhook.
    if (!checksumValid) {
      this.logger.warn(
        `ClickPesa webhook: invalid checksum for event ${eventType}/${providerEventId} — rejected, no dedup row written`,
      );
      throw new ForbiddenException('Invalid webhook checksum');
    }

    // Persist the (verified) event for idempotency. The unique key is
    // (tenantId, providerCode, providerEventId, eventType), so one tenant's
    // event ids can never collide with — and suppress — another tenant's.
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

    // Hand off to the shared handler with explicit tenantId.
    const result = await this.handleWebhook(
      {
        ...data,
        event: eventType,
      },
      undefined,
      undefined,
      { tenantId: tenant.id, providerCode, signatureVerified: true },
    );

    await this.prisma.webhookEvent.updateMany({
      where: {
        tenantId: tenant.id,
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

    if (dto.status === 'COMPLETED') {
      // Shared roll-up: never flips a CANCELLED order to PAID, and advances
      // rentals only via the real workflow (ID_VERIFIED → DOWN_PAYMENT_PAID).
      await this.settlement.settleParents(updated, tenantId);
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
   * Refs are `NARO-<13-digit Date.now()>-<4 digits>`; the old greedy
   * `(\d+)(.+)` split at the wrong place ("NARO-<17 digits>-<1 digit>").
   */
  denormalizeClickPesaRef(sanitized: string): string {
    const match = sanitized.match(/^NARO(\d{13})(\d+)$/);
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
}

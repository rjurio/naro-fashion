import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import {
  GatewayRefundResult,
  PROVIDER_CODES,
  ProviderCredentials,
} from '../payments/payment-provider.types';
import { CreateOrderRefundDto, ORDER_REFUND_METHODS } from './dto/create-order-refund.dto';
import {
  PARTIALLY_REFUNDED,
  REFUNDABLE_PAYMENT_STATUSES,
  REFUNDED,
  REFUND_PENDING,
} from './order-lifecycle.util';

/** Marker stored in Payment.gatewayResponse.kind for order refunds. */
export const ORDER_REFUND_KIND = 'ORDER_REFUND';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Next Order.paymentStatus after a refund of `amount` out of `refundable`.
 *  - everything collected now refunded → REFUNDED
 *  - otherwise REFUND_PENDING stays REFUND_PENDING (cancelled order, money
 *    still owed back), any other state → PARTIALLY_REFUNDED.
 */
export function nextPaymentStatusAfterRefund(
  current: string,
  refundable: number,
  amount: number,
): string {
  if (round2(refundable - amount) <= 0.001) return REFUNDED;
  return current === REFUND_PENDING ? REFUND_PENDING : PARTIALLY_REFUNDED;
}

/**
 * Admin refund workflow for ONLINE orders (`POST/GET /orders/:id/refunds`).
 *
 * A refund is a Payment row with status 'REFUNDED' and a POSITIVE amount on
 * the order — the same representation POS refunds use, so
 * ReportsService.getIncomeStatement (gross − Σ REFUNDED) and the POS drawer
 * maths stay consistent. COMPLETED collection rows are never modified.
 *
 * Gateways: neither Selcom nor ClickPesa has an integrated refund API, so
 * `method: 'GATEWAY'` returns 400 today and admins record the refund they
 * made by mobile money / bank / cash. `PaymentProvider.refund()` is the hook
 * for a real gateway reversal later.
 */
@Injectable()
export class OrderRefundsService {
  private readonly logger = new Logger(OrderRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /** Collected (COMPLETED) and refunded (REFUNDED) totals for one order. */
  private async balances(
    db: Pick<Prisma.TransactionClient, 'payment'>,
    tenantId: string,
    orderId: string,
  ) {
    const [completed, refunded] = await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        where: { tenantId, orderId, status: 'COMPLETED' },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: { tenantId, orderId, status: 'REFUNDED' },
      }),
    ]);
    const totalCollected = round2(Number(completed._sum.amount ?? 0));
    const totalRefunded = round2(Number(refunded._sum.amount ?? 0));
    return {
      totalCollected,
      totalRefunded,
      refundable: round2(Math.max(0, totalCollected - totalRefunded)),
    };
  }

  private serializeRefund(p: any) {
    const g = (p.gatewayResponse && typeof p.gatewayResponse === 'object' ? p.gatewayResponse : {}) as Record<string, any>;
    return {
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      reference: p.transactionRef ?? null,
      providerCode: p.providerCode ?? null,
      note: g.note ?? g.reason ?? null,
      refundedBy: g.refundedBy ?? g.cashierId ?? null,
      refundedByName: g.refundedByName ?? null,
      kind: g.kind ?? (g.posSessionId !== undefined || g.cashierId ? 'POS_REFUND' : null),
      createdAt: p.createdAt,
    };
  }

  async listRefunds(orderId: string) {
    const tenantId = this.tenantContext.requireId;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, orderNumber: true, paymentStatus: true, channel: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const [rows, bal] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, orderId, status: 'REFUNDED' },
        orderBy: { createdAt: 'desc' },
      }),
      this.balances(this.prisma, tenantId, orderId),
    ]);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      ...bal,
      canRefund:
        order.channel !== 'POS' &&
        REFUNDABLE_PAYMENT_STATUSES.includes(order.paymentStatus) &&
        bal.refundable > 0,
      refunds: rows.map((r) => this.serializeRefund(r)),
    };
  }

  /** Credentials for a gateway refund — undefined when none are configured. */
  private async loadCreds(
    db: Pick<Prisma.TransactionClient, 'paymentMethod'>,
    tenantId: string,
    providerCode: string,
  ): Promise<ProviderCredentials | undefined> {
    if (providerCode === PROVIDER_CODES.SELCOM) return undefined; // global env creds
    const pm = await db.paymentMethod.findFirst({
      where: { tenantId, code: providerCode, deletedAt: null },
      select: { integrationParams: true },
    });
    return (pm?.integrationParams as ProviderCredentials | null) ?? undefined;
  }

  async createRefund(orderId: string, dto: CreateOrderRefundDto, user: any) {
    const tenantId = this.tenantContext.requireId;
    const performedById: string | undefined = user?.id;
    const performedByName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || null;

    const amount = round2(Number(dto.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than 0');
    }
    if (!ORDER_REFUND_METHODS.includes(dto.method)) {
      throw new BadRequestException(`method must be one of ${ORDER_REFUND_METHODS.join(', ')}`);
    }
    const reference = dto.reference?.trim() ? dto.reference.trim() : null;
    const note = dto.note?.trim() ? dto.note.trim() : null;

    let result: {
      payment: any;
      before: { paymentStatus: string; totalRefunded: number; refundable: number };
      after: { paymentStatus: string; totalRefunded: number; refundable: number };
      orderNumber: string;
    };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          // Serialize every refund of this order: the cap read and the refund
          // insert must not interleave with a concurrent refund (two admins
          // double-clicking would otherwise both pass the cap).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refund:order:' || ${orderId}::text))`;

          const order = await tx.order.findFirst({
            where: { id: orderId, tenantId },
            select: { id: true, orderNumber: true, paymentStatus: true, channel: true, status: true },
          });
          if (!order) throw new NotFoundException('Order not found');
          if (order.channel === 'POS') {
            throw new BadRequestException('POS sales are refunded from the POS screen (returns restock items and pay out of the drawer).');
          }
          if (!REFUNDABLE_PAYMENT_STATUSES.includes(order.paymentStatus)) {
            throw new BadRequestException(
              `Order ${order.orderNumber} has payment status ${order.paymentStatus}; only REFUND_PENDING, PAID, PARTIAL or PARTIALLY_REFUNDED orders can be refunded.`,
            );
          }

          const bal = await this.balances(tx, tenantId, orderId);
          if (bal.refundable <= 0) {
            throw new BadRequestException(`Nothing left to refund on ${order.orderNumber} (collected ${bal.totalCollected}, already refunded ${bal.totalRefunded}).`);
          }
          if (amount > bal.refundable + 0.001) {
            throw new BadRequestException(
              `Refund amount (${amount}) exceeds the refundable balance (${bal.refundable}) for ${order.orderNumber}.`,
            );
          }

          if (reference) {
            const clash = await tx.payment.findFirst({
              where: { tenantId, transactionRef: reference },
              select: { id: true },
            });
            if (clash) throw new ConflictException(`Reference "${reference}" is already used by another payment.`);
          }

          // Resolve the gateway BEFORE any write so an unsupported provider
          // never leaves a half-recorded refund.
          let providerCode: string | null = null;
          let sourcePayment: { transactionRef: string | null; providerTransactionId: string | null } | null = null;
          if (dto.method === 'GATEWAY') {
            const src = await tx.payment.findFirst({
              where: { tenantId, orderId, status: 'COMPLETED', providerCode: { not: null } },
              orderBy: { createdAt: 'desc' },
              select: { providerCode: true, transactionRef: true, providerTransactionId: true },
            });
            if (!src?.providerCode || !this.registry.has(src.providerCode)) {
              throw new BadRequestException(
                'This order has no completed gateway payment to refund through; record a manual refund.',
              );
            }
            providerCode = src.providerCode;
            sourcePayment = src;
          }

          const nextStatus = nextPaymentStatusAfterRefund(order.paymentStatus, bal.refundable, amount);

          // CAS on the paymentStatus we validated: an admin cancel (PAID →
          // REFUND_PENDING) racing this refund must not be clobbered.
          const flipped = await tx.order.updateMany({
            where: { id: orderId, tenantId, paymentStatus: order.paymentStatus },
            data: { paymentStatus: nextStatus },
          });
          if (flipped.count !== 1) {
            throw new ConflictException('Order was updated by someone else. Please refresh and try again.');
          }

          let payment = await tx.payment.create({
            data: {
              tenantId,
              orderId,
              amount,
              method: dto.method,
              status: 'REFUNDED',
              transactionRef: reference,
              providerCode,
              gatewayResponse: {
                kind: ORDER_REFUND_KIND,
                refundedBy: performedById ?? null,
                refundedByName: performedByName,
                note,
              },
            },
          });

          // Gateway call LAST: if it is unsupported or fails, throwing rolls
          // back the status flip and the refund row above.
          if (dto.method === 'GATEWAY' && providerCode && sourcePayment) {
            const provider = this.registry.resolve(providerCode);
            const creds = await this.loadCreds(tx, tenantId, providerCode);
            const gw: GatewayRefundResult = await provider.refund(
              {
                transactionRef: sourcePayment.transactionRef,
                providerTransactionId: sourcePayment.providerTransactionId,
                amount,
                currency: 'TZS',
                reason: note ?? undefined,
              },
              creds,
            );
            if (!gw.supported) {
              throw new BadRequestException(
                `Gateway refunds are not available for ${providerCode}; record a manual refund.`,
              );
            }
            if (!gw.success) {
              throw new BadRequestException(`Gateway refund failed: ${gw.reason ?? 'unknown error'}`);
            }
            await tx.payment.updateMany({
              where: { id: payment.id, tenantId },
              data: {
                providerTransactionId: gw.refundReference ?? null,
                gatewayResponse: {
                  kind: ORDER_REFUND_KIND,
                  refundedBy: performedById ?? null,
                  refundedByName: performedByName,
                  note,
                  gateway: gw.rawResponse ?? null,
                },
              },
            });
            payment = (await tx.payment.findFirst({ where: { id: payment.id, tenantId } })) ?? payment;
          }

          const totalRefundedAfter = round2(bal.totalRefunded + amount);
          return {
            payment,
            orderNumber: order.orderNumber,
            before: {
              paymentStatus: order.paymentStatus,
              totalRefunded: bal.totalRefunded,
              refundable: bal.refundable,
            },
            after: {
              paymentStatus: nextStatus,
              totalRefunded: totalRefundedAfter,
              refundable: round2(Math.max(0, bal.refundable - amount)),
            },
          };
        },
        { maxWait: 10000, timeout: 30000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Reference "${reference}" is already used by another payment.`);
      }
      throw err;
    }

    await this.auditService.log('REFUND', 'Order', orderId, {
      orderNumber: result.orderNumber,
      paymentId: result.payment.id,
      amount,
      method: dto.method,
      reference,
      note,
      before: result.before,
      after: result.after,
    });
    this.logger.log(
      `Order ${result.orderNumber}: refund ${amount} TZS via ${dto.method} recorded (${result.before.paymentStatus} → ${result.after.paymentStatus})`,
    );

    return {
      refund: this.serializeRefund(result.payment),
      orderId,
      paymentStatus: result.after.paymentStatus,
      totalRefunded: result.after.totalRefunded,
      refundable: result.after.refundable,
    };
  }
}

import { rentalBalances } from '../rentals/rental-ledger';
import { Injectable, Logger } from '@nestjs/common';
import { hasApprovedId } from '../id-verification/id-approval';
import { freezeSnapshot } from '../rentals/checklist/checklist-core';
import { requestCancellationRefunds, SYSTEM_REQUESTER } from '../rentals/cancellation';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single source of truth for applying a gateway-reported payment outcome
 * (webhook, client poll, or reconciliation cron) and rolling it up into the
 * parent Order / RentalOrder.
 *
 * Before this existed the same logic lived in three places (handleWebhook,
 * pollPaymentStatus, PaymentsReconciliationService) and had drifted: the cron
 * still wrote the non-workflow rental status 'CONFIRMED' and skipped the
 * collected-amount check entirely, and every path did an unconditional
 * `payment.update` that could downgrade a COMPLETED payment back to PENDING.
 *
 * Deliberately does NOT depend on the request-scoped TenantContext — the
 * reconciliation cron runs outside a request — so every method takes an
 * explicit tenantId and scopes every query by it.
 */

/** Internal payment statuses a gateway outcome can move a payment to. */
export type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** Payment statuses that must never be overwritten by a gateway signal. */
export const FINAL_PAYMENT_STATUSES = ['COMPLETED', 'REFUNDED'];

/** Order states that must never be flipped to PAID automatically. */
const CLOSED_ORDER_STATUSES = ['CANCELLED', 'REFUNDED'];
// Once a refund is underway the refund workflow owns paymentStatus — a late
// gateway settlement must not overwrite REFUND_PENDING/PARTIALLY_REFUNDED with
// PAID/PARTIAL (it's logged for manual review instead).
const CLOSED_ORDER_PAYMENT_STATUSES = ['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'];

/**
 * Map a raw gateway/webhook status string to an internal status.
 * Returns null for a missing or unrecognised status — callers must IGNORE
 * those instead of writing a default (the old code mapped unknown → PENDING
 * and overwrote whatever the payment had, including COMPLETED).
 */
export function mapGatewayStatus(
  status: string | undefined | null,
): SettlementStatus | null {
  if (!status || typeof status !== 'string') return null;
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
    [
      'FAILED',
      'REJECTED',
      'DECLINED',
      'PAYMENT_FAILED',
      'CANCELLED',
      'EXPIRED',
    ].includes(normalized)
  ) {
    return 'FAILED';
  }
  if (['PROCESSING', 'PENDING'].includes(normalized)) {
    return 'PROCESSING';
  }
  return null;
}

/**
 * Pull the gateway-reported collected amount out of a webhook payload or a
 * status-query response. Returns null when no usable amount is present.
 */
export function extractReportedAmount(payload: any): number | null {
  if (payload == null) return null;
  const source = Array.isArray(payload) ? payload[0] : payload;
  if (source == null || typeof source !== 'object') return null;
  const raw =
    source.collectedAmount ??
    source.amount ??
    source.totalAmount ??
    source?.data?.collectedAmount ??
    source?.data?.amount;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** sha256 hex digest — used as a stable fallback webhook event id. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Decide the effective status for a gateway COMPLETED signal given the amount
 * the gateway says it collected. The expected amount is the server-stored
 * `payment.amount` — the exact amount we asked the gateway to collect, which
 * `initiateGatewayPayment` caps against the outstanding balance (order total /
 * rental total minus COMPLETED + in-flight payments) under an advisory lock.
 * A short collection is held as PROCESSING for manual review, never credited.
 */
export function assessCollectedAmount(args: {
  status: SettlementStatus;
  reportedAmount: number | null;
  expectedAmount: number;
}): { status: SettlementStatus; amountShort: boolean } {
  const { status, reportedAmount, expectedAmount } = args;
  const amountShort =
    status === 'COMPLETED' &&
    reportedAmount != null &&
    !Number.isNaN(reportedAmount) &&
    reportedAmount + 0.001 < expectedAmount;
  return { status: amountShort ? 'PROCESSING' : status, amountShort };
}

export interface SettlementPayment {
  id: string;
  status: string;
  amount: Prisma.Decimal | number | string;
  orderId: string | null;
  rentalOrderId: string | null;
}

export interface ApplyGatewayResultArgs {
  payment: SettlementPayment;
  tenantId: string;
  /** Already-mapped status, or null when the gateway status was unknown. */
  status: SettlementStatus | null;
  reportedAmount: number | null;
  gatewayResponse?: any;
  /** Extra columns to write alongside the status (providerCode, lastPolledAt…). */
  extraData?: Prisma.PaymentUpdateManyMutationInput;
  /** Label for logs: 'webhook:SELCOM', 'poll', 'reconcile', … */
  source: string;
}

export interface ApplyGatewayResult {
  applied: boolean;
  status: string;
  amountShort: boolean;
}

@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply a gateway outcome to a payment with a compare-and-swap update so a
   * late/duplicate/spoofed signal can never downgrade a COMPLETED or REFUNDED
   * payment:
   *   - → COMPLETED is allowed from anything except COMPLETED/REFUNDED (a
   *     payment the cron age-FAILED can still complete if the gateway later
   *     confirms it — the customer's money did arrive).
   *   - → FAILED / PROCESSING is allowed only from PENDING/PROCESSING.
   * Unknown statuses (null) are ignored.
   */
  async applyGatewayResult(
    args: ApplyGatewayResultArgs,
  ): Promise<ApplyGatewayResult> {
    const { payment, tenantId, status, reportedAmount, source } = args;

    if (!status) {
      this.logger.warn(
        `[${source}] payment ${payment.id}: unrecognised gateway status — ignored (current: ${payment.status})`,
      );
      if (args.extraData && Object.keys(args.extraData).length > 0) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, tenantId },
          data: args.extraData,
        });
      }
      return { applied: false, status: payment.status, amountShort: false };
    }

    const expectedAmount = Number(payment.amount);
    const { status: effectiveStatus, amountShort } = assessCollectedAmount({
      status,
      reportedAmount,
      expectedAmount,
    });

    if (amountShort) {
      this.logger.warn(
        `[${source}] AMOUNT MISMATCH on payment ${payment.id} — gateway collected ${reportedAmount} but ${expectedAmount} was expected. Holding as PROCESSING for review, NOT completing.`,
      );
    }

    const allowedFrom: Prisma.StringFilter =
      effectiveStatus === 'COMPLETED'
        ? { notIn: FINAL_PAYMENT_STATUSES }
        : { in: ['PENDING', 'PROCESSING'] };

    // Provider evidence: the ONLY place a payment becomes PROVIDER_CONFIRMED
    // (payments/payment-confirmation.ts). Only stamped when the gateway's own
    // payload is being written, so no existing record is ever replaced.
    const settlementStamp =
      effectiveStatus === 'COMPLETED' && !amountShort
        ? { _settlement: { providerVerified: true, source, at: new Date().toISOString() } }
        : {};
    const gatewayResponse =
      args.gatewayResponse === undefined
        ? undefined
        : effectiveStatus === 'COMPLETED' && !amountShort
          ? {
              ...(typeof args.gatewayResponse === 'object' &&
              args.gatewayResponse !== null &&
              !Array.isArray(args.gatewayResponse)
                ? args.gatewayResponse
                : { response: args.gatewayResponse }),
              ...settlementStamp,
            }
          : amountShort
          ? {
              ...(typeof args.gatewayResponse === 'object' &&
              args.gatewayResponse !== null &&
              !Array.isArray(args.gatewayResponse)
                ? args.gatewayResponse
                : { response: args.gatewayResponse }),
              _amountMismatch: { reportedAmount, expectedAmount },
            }
          : args.gatewayResponse;

    const res = await this.prisma.payment.updateMany({
      where: { id: payment.id, tenantId, status: allowedFrom },
      data: {
        ...(args.extraData ?? {}),
        status: effectiveStatus,
        ...(gatewayResponse !== undefined && { gatewayResponse }),
      },
    });

    if (res.count === 0) {
      this.logger.warn(
        `[${source}] payment ${payment.id}: refusing ${payment.status} → ${effectiveStatus} (would overwrite a final/terminal status)`,
      );
      if (args.extraData && Object.keys(args.extraData).length > 0) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, tenantId },
          data: args.extraData,
        });
      }
      return { applied: false, status: payment.status, amountShort };
    }

    this.logger.log(
      `[${source}] payment ${payment.id}: ${payment.status} → ${effectiveStatus}`,
    );

    if (effectiveStatus === 'COMPLETED') {
      await this.settleParents(payment, tenantId);
    }

    return { applied: true, status: effectiveStatus, amountShort };
  }

  /** Roll a completed payment up into its order and/or rental. */
  async settleParents(
    payment: Pick<SettlementPayment, 'orderId' | 'rentalOrderId'>,
    tenantId: string,
  ) {
    if (payment.orderId) {
      await this.updateOrderPaymentStatus(payment.orderId, tenantId);
    }
    if (payment.rentalOrderId) {
      await this.updateRentalPaymentStatus(payment.rentalOrderId, tenantId);
    }
  }

  /** Sum of COMPLETED payment amounts for an order or rental. */
  async sumCompleted(
    where: { orderId?: string; rentalOrderId?: string },
    tenantId: string,
  ): Promise<number> {
    const agg = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: { ...where, tenantId, status: 'COMPLETED' },
    });
    return Number(agg._sum.amount ?? 0);
  }

  /**
   * Recompute Order.paymentStatus from COMPLETED payments. Never flips a
   * CANCELLED/REFUNDED order to PAID — a gateway completion landing on a
   * cancelled order is logged for manual review (refund) instead.
   */
  async updateOrderPaymentStatus(orderId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) return;

    const totalPaid = await this.sumCompleted({ orderId }, tenantId);
    const totalDue = Number(order.total);

    if (
      CLOSED_ORDER_STATUSES.includes(order.status) ||
      CLOSED_ORDER_PAYMENT_STATUSES.includes(order.paymentStatus)
    ) {
      this.logger.warn(
        `REVIEW: order ${order.orderNumber} is ${order.status}/${order.paymentStatus} but has ${totalPaid} TZS in COMPLETED payments — NOT changing paymentStatus; refund/reconcile manually.`,
      );
      return;
    }

    let paymentStatus = 'PENDING';
    if (totalPaid >= totalDue) {
      paymentStatus = 'PAID';
    } else if (totalPaid > 0) {
      paymentStatus = 'PARTIAL';
    }

    await this.prisma.order.updateMany({
      where: { id: orderId, tenantId },
      data: { paymentStatus },
    });
  }

  /**
   * Advance a rental once its down payment is covered. Uses the real workflow
   * state DOWN_PAYMENT_PAID and only advances a rental whose National ID is
   * already verified (ID_VERIFIED) — the old cron copy wrote the non-workflow
   * status 'CONFIRMED' straight from PENDING_ID_VERIFICATION, bypassing the
   * mandatory ID check and breaking RentalsService's forward-only guard. If
   * the customer paid before verification, the payment is recorded and an
   * admin advances the rental after approving the ID.
   */
  /**
   * Under the booking's refund lock: if the booking is (now) CANCELLED, raise
   * refund requests for money received and not yet claimed, and flag it
   * REFUND_DUE when money is held. Returns true when the booking is
   * cancelled (the caller then stops: a cancelled booking is never advanced).
   */
  private async raiseLateCancellationRefunds(rental: any, tenantId: string, totalPaid: number): Promise<boolean> {
    try {
      const out = await this.prisma.$transaction(async (tx: any) => {
        const created = await requestCancellationRefunds(
          tx, tenantId, rental.id, SYSTEM_REQUESTER.LATE_PAYMENT, rental.cancellationReason ?? 'LATE_PAYMENT');
        const current = await tx.rentalOrder.findFirst({ where: { id: rental.id, tenantId }, select: { status: true } });
        const cancelled = current?.status === 'CANCELLED';
        if (cancelled && (totalPaid > 0 || created.length > 0)) {
          await tx.rentalOrder.updateMany({
            where: { id: rental.id, tenantId, status: 'CANCELLED', OR: [{ holdState: null }, { holdState: { not: 'REFUND_DUE' } }] },
            data: { holdState: 'REFUND_DUE', holdExpiresAt: null },
          });
        }
        return { created, cancelled };
      });
      if (out.cancelled && totalPaid > 0) {
        this.logger.warn(`REVIEW: rental ${rental.rentalNumber} is CANCELLED but has ${totalPaid} TZS of COMPLETED payments — refund review.`);
      }
      if (out.created.length) {
        this.logger.warn(`Rental ${rental.rentalNumber}: late payment on a cancelled booking -> refund request(s) ${out.created.map((c: any) => `${c.component} ${c.amount}`).join(', ')}`);
      }
      return out.cancelled;
    } catch (e: any) {
      this.logger.error(`Rental ${rental.rentalNumber}: could not raise the late-payment refund request: ${e?.message ?? e}`);
      return rental.status === 'CANCELLED';
    }
  }

  async updateRentalPaymentStatus(rentalOrderId: string, tenantId: string) {
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId },
    });
    if (!rental) return;

    const totalPaid = await this.sumCompleted({ rentalOrderId }, tenantId);
    const downPaymentDue = Number(rental.downPaymentAmount);
    // Rental money ledger: only RENTAL_FEE money (incl. unallocated online
    // payments, applied fee first) counts towards the down payment — a
    // deposit payment never confirms a booking.
    const rows = await this.prisma.payment.findMany({
      where: { rentalOrderId, tenantId },
      select: { amount: true, status: true, component: true },
    });
    const ledger = rentalBalances(rental, rows);
    const feePaid = ledger.collected.RENTAL_FEE;

    // Money on a CANCELLED booking (e.g. a gateway payment that completed after
    // the hold expiry job released it) is never re-opened automatically: it
    // becomes a full refund REQUEST (round 25C F) and the booking is flagged
    // REFUND_DUE for finance.
    //
    // Round 25D E: the status read above may be stale. A cancellation can be
    // committing at this very moment, having counted the money BEFORE this
    // payment completed; it then raises no request for it, and this check
    // would see the old status and raise none either. So the check always
    // runs under the booking's refund lock and re-reads the status there
    // (requestCancellationRefunds does both): whichever side comes second
    // requests exactly the money not yet claimed. Idempotent on replays.
    if (await this.raiseLateCancellationRefunds(rental, tenantId, totalPaid)) return;

    const confirmable = ['ID_VERIFIED', 'DOWN_PAYMENT_PAID'].includes(rental.status);
    if (confirmable && ledger.downPaymentCovered) {
      // Owner rule 2026-11-12: never confirm without an APPROVED National ID,
      // whatever the rental's status says (it may have been set by hand).
      if (!(await hasApprovedId(this.prisma, tenantId, rental.userId))) {
        this.logger.warn(
          `REVIEW: rental ${rental.rentalNumber} has its down payment (${totalPaid} TZS) but the customer has no approved National ID — not confirmed.`,
        );
        return;
      }
      // The whole rental fee received → FULLY_PAID; else the down payment → DOWN_PAYMENT_PAID.
      const target = ledger.feeFullyPaid ? 'FULLY_PAID' : 'DOWN_PAYMENT_PAID';
      if (target === rental.status) return;
      const res = await this.prisma.rentalOrder.updateMany({
        where: { id: rentalOrderId, tenantId, status: rental.status },
        data: { status: target },
      });
      if (res.count > 0) {
        this.logger.log(
          `Rental ${rental.rentalNumber}: ${feePaid} TZS of the rental fee received (down payment ${downPaymentDue}) — advanced to ${target}`,
        );
        // R3: the booking is confirmed → its checklist is fixed now (template
        // edits after this never change it). Best effort; the hand-over gate
        // refuses a booking without one.
        try {
          await freezeSnapshot(this.prisma, tenantId, rentalOrderId, null);
        } catch (e: any) {
          this.logger.warn(`R3: checklist snapshot for rental ${rental.rentalNumber} not frozen at confirmation: ${e?.message ?? e}`);
        }
      }
    }
  }
}

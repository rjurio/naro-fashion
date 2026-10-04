import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import {
  PROVIDER_CODES,
  ProviderCode,
  ProviderCredentials,
} from './payment-provider.types';
import {
  PaymentSettlementService,
  mapGatewayStatus,
} from './payment-settlement.service';

/**
 * Runs every 30s to finalize PROCESSING ClickPesa payments that may be waiting
 * on a delayed webhook. For each candidate Payment:
 *   1. Load tenant credentials from PaymentMethod.integrationParams.
 *   2. Query ClickPesa for the current status.
 *   3. If terminal (COMPLETED/FAILED), apply it through the shared
 *      PaymentSettlementService (amount check, never-downgrade CAS, single
 *      order/rental roll-up — the same code the webhook and poll paths use).
 *   4. If still PROCESSING after CLICKPESA_RECONCILE_CUTOFF_MINUTES, mark FAILED
 *      (conditionally — never over a payment a webhook completed meanwhile).
 *
 * Throttled per-payment via lastPolledAt to avoid hammering the gateway.
 */
@Injectable()
export class PaymentsReconciliationService {
  private readonly logger = new Logger(PaymentsReconciliationService.name);
  private readonly pollIntervalSeconds: number;
  private readonly cutoffMinutes: number;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly configService: ConfigService,
    private readonly settlement: PaymentSettlementService,
  ) {
    this.pollIntervalSeconds = Number(
      this.configService.get<string>(
        'CLICKPESA_POLL_INTERVAL_SECONDS',
        '30',
      ),
    );
    this.cutoffMinutes = Number(
      this.configService.get<string>(
        'CLICKPESA_RECONCILE_CUTOFF_MINUTES',
        '5',
      ),
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileClickPesa() {
    // Guard against overlapping runs if a query is slow.
    if (this.running) return;
    this.running = true;

    try {
      const pollCutoff = new Date(
        Date.now() - this.pollIntervalSeconds * 1000,
      );
      const expiryCutoff = new Date(
        Date.now() - this.cutoffMinutes * 60 * 1000,
      );

      const candidates = await this.prisma.payment.findMany({
        where: {
          providerCode: PROVIDER_CODES.CLICKPESA_MIXX,
          status: 'PROCESSING',
          OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: pollCutoff } }],
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });

      if (candidates.length === 0) return;

      this.logger.debug(
        `Reconciling ${candidates.length} PROCESSING ClickPesa payment(s)`,
      );

      for (const payment of candidates) {
        try {
          await this.reconcileOne(payment, expiryCutoff);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Reconcile failed for payment ${payment.id}: ${msg}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  async reconcileOne(
    payment: {
      id: string;
      tenantId: string | null;
      transactionRef: string | null;
      orderId: string | null;
      rentalOrderId: string | null;
      createdAt: Date;
      providerCode: string | null;
      status: string;
      amount: Prisma.Decimal | number | string;
    },
    expiryCutoff: Date,
  ) {
    if (!payment.tenantId || !payment.transactionRef) return;
    const tenantId = payment.tenantId;

    // Ask the gateway for a DEFINITIVE status FIRST — before any age-based
    // decision. The old code force-FAILED any payment past the cutoff before
    // ever calling the gateway, so a customer who took longer than the cutoff
    // (5 min) to enter their Mobile-Money PIN — routine in TZ — had their
    // payment failed even though it later completed, and the money was lost
    // to reconciliation unless a webhook happened to arrive.
    const providerCode = (payment.providerCode as ProviderCode) ?? PROVIDER_CODES.CLICKPESA_MIXX;
    const creds = await this.loadCreds(tenantId, providerCode);

    let gatewayChecked = false;
    if (creds) {
      const provider = this.registry.resolve(providerCode);
      const status = await provider.checkPaymentStatus(
        payment.transactionRef,
        creds,
      );
      await this.prisma.payment.updateMany({
        where: { id: payment.id, tenantId },
        data: { lastPolledAt: new Date() },
      });

      if (status.success) {
        gatewayChecked = true;
        // Terminal status from the gateway is authoritative — apply via the
        // shared settlement path and stop.
        if (status.status !== 'PROCESSING' && status.status !== 'PENDING') {
          await this.settlement.applyGatewayResult({
            payment,
            tenantId,
            status: mapGatewayStatus(status.status),
            reportedAmount: status.collectedAmount ?? null,
            gatewayResponse: status.rawResponse ?? undefined,
            source: 'reconcile',
          });
          return;
        }
        // Gateway still says PROCESSING/PENDING — fall through to the age check.
      }
    }

    // Only NOW consider the age cutoff: fail a payment on timeout ONLY when the
    // gateway did not confirm completion (still pending, or couldn't be polled
    // — e.g. Selcom, which reconciles via webhook). Never on age alone before a
    // status check. Conditional on PENDING/PROCESSING so a webhook that landed
    // while we were polling is never downgraded.
    if (payment.createdAt < expiryCutoff) {
      const res = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          tenantId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: {
          status: 'FAILED',
          lastPolledAt: new Date(),
          gatewayResponse: { timeout: true, cutoff: expiryCutoff, gatewayChecked },
        },
      });
      if (res.count > 0) {
        this.logger.log(
          `Reconcile: payment ${payment.id} timed out after ${this.cutoffMinutes}m (gatewayChecked=${gatewayChecked}) → FAILED`,
        );
      }
    }
  }

  private async loadCreds(
    tenantId: string,
    providerCode: ProviderCode,
  ): Promise<ProviderCredentials | undefined> {
    if (providerCode === PROVIDER_CODES.SELCOM) return undefined;
    const pm = await this.prisma.paymentMethod.findFirst({
      where: {
        tenantId,
        code: providerCode,
        isActive: true,
        deletedAt: null,
      },
    });
    return (pm?.integrationParams as ProviderCredentials) ?? undefined;
  }
}

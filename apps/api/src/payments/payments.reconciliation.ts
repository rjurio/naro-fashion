import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import {
  PROVIDER_CODES,
  ProviderCode,
  ProviderCredentials,
} from './payment-provider.types';

/**
 * Runs every 30s to finalize PROCESSING ClickPesa payments that may be waiting
 * on a delayed webhook. For each candidate Payment:
 *   1. Load tenant credentials from PaymentMethod.integrationParams.
 *   2. Query ClickPesa for the current status.
 *   3. If terminal (COMPLETED/FAILED), update the Payment + parent order/rental.
 *   4. If still PROCESSING after CLICKPESA_RECONCILE_CUTOFF_MINUTES, mark FAILED.
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

  private async reconcileOne(
    payment: {
      id: string;
      tenantId: string | null;
      transactionRef: string | null;
      orderId: string | null;
      rentalOrderId: string | null;
      createdAt: Date;
      providerCode: string | null;
    },
    expiryCutoff: Date,
  ) {
    if (!payment.tenantId || !payment.transactionRef) return;

    // Too old to keep waiting on → mark FAILED.
    if (payment.createdAt < expiryCutoff) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          lastPolledAt: new Date(),
          gatewayResponse: { timeout: true, cutoff: expiryCutoff },
        },
      });
      this.logger.log(
        `Reconcile: payment ${payment.id} timed out after ${this.cutoffMinutes}m → FAILED`,
      );
      return;
    }

    const providerCode = (payment.providerCode as ProviderCode) ?? PROVIDER_CODES.CLICKPESA_MIXX;
    const creds = await this.loadCreds(payment.tenantId, providerCode);
    if (!creds) {
      this.logger.warn(
        `Reconcile: no credentials for tenant ${payment.tenantId} / ${providerCode}`,
      );
      return;
    }

    const provider = this.registry.resolve(providerCode);
    const status = await provider.checkPaymentStatus(
      payment.transactionRef,
      creds,
    );

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { lastPolledAt: new Date() },
    });

    if (!status.success) return;

    if (status.status === 'PROCESSING' || status.status === 'PENDING') return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: status.status,
        gatewayResponse: status.rawResponse ?? undefined,
      },
    });

    this.logger.log(
      `Reconcile: payment ${payment.id} (${payment.transactionRef}) → ${status.status}`,
    );

    if (status.status === 'COMPLETED') {
      if (payment.orderId) {
        await this.updateOrderPaymentStatus(
          payment.orderId,
          payment.tenantId,
        );
      }
      if (payment.rentalOrderId) {
        await this.updateRentalPaymentStatus(
          payment.rentalOrderId,
          payment.tenantId,
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
    if (totalPaid >= totalDue) paymentStatus = 'PAID';
    else if (totalPaid > 0) paymentStatus = 'PARTIAL';

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
    }
  }
}

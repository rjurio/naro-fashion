import { assertPayerIndependent } from './separation';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { OrderRefundsService } from '../orders/order-refunds.service';
import { PosService } from '../pos/pos.service';
import { RentalMoneyService } from '../rentals/rental-money.service';
import { OPEN_REFUND_STATUSES, PAYOUT_METHODS, PayoutMethod, payoutProblems, REFUND_KINDS, REFUND_SUBJECTS } from './refund-rules';

export class PayRefundDto {
  @IsIn(PAYOUT_METHODS as unknown as string[]) method!: PayoutMethod;
  /** Mobile money / bank: the payout reference (required, unique per shop). */
  @IsOptional() @IsString() @MaxLength(64) reference?: string;
  /** Required when paying back by a different method than the customer used (e.g. a card sale). */
  @IsOptional() @IsString() @MaxLength(500) verificationNote?: string;
}
export class DecideRefundDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class ListRefundsQuery {
  @IsOptional() @IsIn(REFUND_SUBJECTS as unknown as string[]) subject?: string;
  @IsOptional() @IsString() status?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const normRef = (r?: string | null) => (r && r.trim() ? r.trim().toUpperCase().replace(/\s+/g, '') : null);

/**
 * The ONE refund workflow for every subject (R1b). Rental requests keep their
 * tested service (RentalMoneyService) and are delegated to it; order, POS-sale
 * and layaway requests are handled here with exactly the same rules:
 *  - approve / reject: `refunds:approve`, never the requester (403 SELF_APPROVAL);
 *  - pay: `payments:manage`, never the requester (403 PAYOUT_BY_REQUESTER);
 *    claimed APPROVED → PAYING (compare-and-swap) so a double click or a
 *    second payer can't pay twice; the payout row is linked one-to-one
 *    (Payment.refundRequestId unique); cash leaves the PAYER's own open shift;
 *  - fail: the payout row is REVERSED and the money is owed again (never
 *    shown as refunded);
 *  - retry: a FAILED request is re-paid through a NEW request (same rules).
 * Everything is shop-scoped (tenantId) and audited with the acting admin.
 */
@Injectable()
export class RefundRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly orderRefunds: OrderRefundsService,
    private readonly pos: PosService,
    private readonly rentalMoney: RentalMoneyService,
  ) {}

  private get tenantId() {
    return this.tenantContext.requireId;
  }

  private include = {
    order: { select: { id: true, orderNumber: true, channel: true, paymentStatus: true } },
    layaway: { select: { id: true, layawayNumber: true, status: true, financialDisposition: true } },
    rentalOrder: { select: { id: true, rentalNumber: true, status: true } },
    payout: { select: { id: true, amount: true, method: true, status: true, transactionRef: true, createdAt: true } },
  } as const;

  async list(q: ListRefundsQuery) {
    return this.prisma.refundRequest.findMany({
      where: { tenantId: this.tenantId, ...(q.subject ? { subject: q.subject } : {}), ...(q.status ? { status: q.status } : {}) },
      include: this.include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(id: string) {
    const r = await this.prisma.refundRequest.findFirst({ where: { id, tenantId: this.tenantId }, include: this.include });
    if (!r) throw new NotFoundException('Refund request not found');
    return r;
  }

  // ------------------------------------------------------------ approve / reject
  async approve(id: string, dto: DecideRefundDto, actor: { id: string }) {
    const r = await this.get(id);
    if (r.subject === 'RENTAL') return this.rentalMoney.approve(id, actor);
    if (r.requestedById === actor.id) {
      await this.audit.log('REFUND_APPROVAL_DENIED', 'RefundRequest', id, { reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'A refund must be approved by a different person than the one who requested it.' });
    }
    const res = await this.prisma.refundRequest.updateMany({
      where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
    });
    if (res.count !== 1) throw new ConflictException('The request is no longer waiting for approval. Reload.');
    await this.audit.log('REFUND_APPROVED', 'RefundRequest', id, { subject: r.subject, kind: r.kind, amount: Number(r.amount), note: dto.note });
    return this.get(id);
  }

  async reject(id: string, dto: ReasonDto, actor: { id: string }) {
    const r = await this.get(id);
    if (r.subject === 'RENTAL') return this.rentalMoney.reject(id, { reason: dto.reason }, actor);
    const res = await this.prisma.refundRequest.updateMany({
      where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
      data: { status: 'REJECTED', rejectedById: actor.id, rejectionReason: dto.reason },
    });
    if (res.count !== 1) throw new ConflictException('The request is no longer waiting for approval. Reload.');
    if (r.layawayId) {
      await this.prisma.layaway.updateMany({ where: { id: r.layawayId, tenantId: this.tenantId }, data: { financialDisposition: 'REFUND_REJECTED' } });
    }
    if (r.kind === REFUND_KINDS.POS_RETURN) {
      // The goods held in the shop are handed back to the customer (they were never restocked).
      await this.prisma.refundRequest.updateMany({
        where: { id, tenantId: this.tenantId },
        data: { lines: { ...((r.lines as any) ?? {}), goodsDisposition: 'HAND_BACK_TO_CUSTOMER' } as any },
      });
    }
    await this.audit.log('REFUND_REJECTED', 'RefundRequest', id, { subject: r.subject, kind: r.kind, amount: Number(r.amount), reason: dto.reason });
    return this.get(id);
  }

  // ------------------------------------------------------------ pay
  /** Methods the customer actually paid with (for the "same method" rule). */
  private async originalMethods(r: { orderId: string | null; layawayId: string | null }) {
    const rows = await this.prisma.payment.findMany({
      where: { tenantId: this.tenantId, status: 'COMPLETED', ...(r.orderId ? { orderId: r.orderId } : { layawayId: r.layawayId ?? '__none__' }) },
      select: { method: true },
    });
    return [...new Set(rows.map((p) => p.method))];
  }

  async pay(id: string, dto: PayRefundDto, actor: { id: string }) {
    const r = await this.get(id);
    if (r.subject === 'RENTAL') {
      // Cash leaves the payer's own open shift (RentalMoneyService checks it belongs to them).
      const s = dto.method === 'CASH'
        ? await this.prisma.posSession.findFirst({ where: { adminUserId: actor.id, status: 'OPEN', tenantId: this.tenantId }, select: { id: true } })
        : null;
      return this.rentalMoney.pay(id, { method: dto.method, reference: dto.reference, sessionId: s?.id }, actor);
    }
    if (r.requestedById === actor.id) {
      await this.audit.log('REFUND_PAYOUT_DENIED', 'RefundRequest', id, { reason: 'PAYOUT_BY_REQUESTER' });
      throw new ForbiddenException({ statusCode: 403, code: 'PAYOUT_BY_REQUESTER', message: 'The person who requested a refund cannot also pay it out.' });
    }
    // Round 25E D (G2): nor the person who approved it.
    await assertPayerIndependent(r as any, actor.id, this.audit);
    if (r.status !== 'APPROVED') throw new ConflictException('Only an APPROVED request can be paid. Reload.');
    const reference = normRef(dto.reference);
    const problems = payoutProblems({ method: dto.method, reference, originalMethods: await this.originalMethods(r), verificationNote: dto.verificationNote });
    if (problems.length) throw new BadRequestException({ statusCode: 400, code: 'PAYOUT_INVALID', problems, message: `Payout refused: ${problems.join('; ')}.` });

    // Claim: only one payer, only once.
    const claim = await this.prisma.refundRequest.updateMany({ where: { id, tenantId: this.tenantId, status: 'APPROVED' }, data: { status: 'PAYING' } });
    if (claim.count !== 1) throw new ConflictException('This refund is already being paid or was changed. Reload.');
    try {
      let paymentId: string;
      let paid = Number(r.amount);
      if (r.subject === 'ORDER') {
        const out: any = await this.orderRefunds.executeRefund(
          r.orderId!, { amount: paid, method: dto.method, reference: reference ?? undefined, note: r.reason } as any, actor, id,
        );
        paymentId = out.refund.id;
      } else if (r.kind === REFUND_KINDS.POS_RETURN) {
        const l: any = r.lines ?? {};
        const out = await this.pos.executeSaleRefund(
          r.orderId!, { items: l.items, refundMethod: dto.method, reason: l.reason ?? r.reason, note: l.note ?? undefined } as any, actor.id, id, reference,
        );
        paymentId = out.paymentId;
        paid = Number(out.refundAmount);
        await this.prisma.refundRequest.updateMany({
          where: { id, tenantId: this.tenantId },
          data: {
            lines: {
              ...l,
              goodsDisposition: (l.items ?? []).every((x: any) => x.condition === 'DAMAGED') ? 'DAMAGED_NOT_RESTOCKED'
                : (l.items ?? []).some((x: any) => x.condition === 'DAMAGED') ? 'PARTLY_RESTOCKED' : 'RESTOCKED',
            } as any,
          },
        });
      } else {
        paymentId = await this.moneyOnlyPayout(r, dto.method, reference, dto.verificationNote ?? null, actor.id);
      }
      await this.prisma.refundRequest.updateMany({
        where: { id, tenantId: this.tenantId, status: 'PAYING' },
        data: { status: 'PAID', paidById: actor.id, paidAt: new Date(), payoutMethod: dto.method, payoutReference: reference, amount: paid },
      });
      if (r.layawayId) await this.prisma.layaway.updateMany({ where: { id: r.layawayId, tenantId: this.tenantId }, data: { financialDisposition: 'REFUNDED' } });
      await this.audit.log('REFUND_PAID', 'RefundRequest', id, {
        subject: r.subject, kind: r.kind, amount: paid, method: dto.method, reference, paymentId, verificationNote: dto.verificationNote ?? null,
      });
      return this.get(id);
    } catch (e: any) {
      await this.prisma.refundRequest.updateMany({ where: { id, tenantId: this.tenantId, status: 'PAYING' }, data: { status: 'APPROVED' } });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That payout reference is already used. Nothing was paid.');
      }
      throw e;
    }
  }

  /** Exchange differences, layaway cancellations and retries: a linked payout row, nothing else. */
  private async moneyOnlyPayout(r: any, method: string, reference: string | null, verificationNote: string | null, payerId: string): Promise<string> {
    const tenantId = this.tenantId;
    let sessionId: string | null = null;
    if (method === 'CASH') {
      const s = await this.prisma.posSession.findFirst({ where: { adminUserId: payerId, status: 'OPEN', tenantId }, select: { id: true } });
      if (!s) throw new BadRequestException('A cash payout needs your OPEN POS shift (the cash leaves your drawer).');
      sessionId = s.id;
    }
    return this.prisma.$transaction(async (tx) => {
      const key = r.orderId ? `refund:order:${r.orderId}` : `refund:layaway:${r.layawayId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const target = r.orderId ? { orderId: r.orderId } : { layawayId: r.layawayId };
      const [inAgg, outAgg] = await Promise.all([
        tx.payment.aggregate({ where: { tenantId, ...target, status: 'COMPLETED' }, _sum: { amount: true } }),
        tx.payment.aggregate({ where: { tenantId, ...target, status: 'REFUNDED' }, _sum: { amount: true } }),
      ]);
      const room = r2(Number(inAgg._sum.amount ?? 0) - Number(outAgg._sum.amount ?? 0));
      if (Number(r.amount) > room + 0.001) {
        throw new ConflictException(`Only ${room} TZS is still held for this ${r.orderId ? 'sale' : 'layaway'}; nothing paid.`);
      }
      const row = await tx.payment.create({
        data: {
          tenantId, ...target, amount: Number(r.amount), method, status: 'REFUNDED', transactionRef: reference, refundRequestId: r.id,
          gatewayResponse: { kind: r.kind, payerId, posSessionId: sessionId, exchangeNumber: r.exchangeNumber ?? null, verificationNote } as any,
        },
      });
      return row.id;
    });
  }

  // ------------------------------------------------------------ fail / retry
  async fail(id: string, dto: ReasonDto, actor: { id: string }) {
    const r = await this.get(id);
    if (r.subject === 'RENTAL') return this.rentalMoney.fail(id, { reason: dto.reason }, actor);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.refundRequest.updateMany({
        where: { id, tenantId: this.tenantId, status: 'PAID' },
        data: { status: 'FAILED', failedById: actor.id, failedAt: new Date(), failureReason: dto.reason },
      });
      if (res.count !== 1) throw new ConflictException('Only a PAID refund can be marked as failed. Reload.');
      await tx.payment.updateMany({ where: { tenantId: this.tenantId, refundRequestId: id, status: 'REFUNDED' }, data: { status: 'REVERSED' } });
      // The money is owed again: never shown as refunded.
      if (r.orderId) await tx.order.updateMany({ where: { id: r.orderId, tenantId: this.tenantId }, data: { paymentStatus: 'REFUND_PENDING' } });
      if (r.layawayId) await tx.layaway.updateMany({ where: { id: r.layawayId, tenantId: this.tenantId }, data: { financialDisposition: 'REFUND_FAILED' } });
    });
    await this.audit.log('REFUND_FAILED', 'RefundRequest', id, { subject: r.subject, kind: r.kind, amount: Number(r.amount), reason: dto.reason });
    return this.get(id);
  }

  async retry(id: string, dto: ReasonDto, actor: { id: string }) {
    const r = await this.get(id);
    if (r.subject === 'RENTAL') throw new BadRequestException('Rental refunds are re-requested from the rental (Refund request).');
    if (r.status !== 'FAILED') throw new ConflictException('Only a FAILED refund can be retried.');
    const created = await this.prisma.$transaction(async (tx) => {
      const key = r.orderId ? `refund:order:${r.orderId}` : `refund:layaway:${r.layawayId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const already = await tx.refundRequest.findFirst({ where: { tenantId: this.tenantId, retryOfId: id, status: { in: [...OPEN_REFUND_STATUSES, 'PAID'] } } });
      if (already) throw new ConflictException('This failed refund already has a retry.');
      return tx.refundRequest.create({
        data: {
          tenantId: this.tenantId, subject: r.subject, kind: r.subject === 'ORDER' ? REFUND_KINDS.ORDER_REFUND : REFUND_KINDS.RETRY,
          orderId: r.orderId, layawayId: r.layawayId, amount: r.amount, reason: dto.reason, status: 'REQUESTED',
          requestedById: actor.id, retryOfId: id,
        },
      });
    });
    if (r.layawayId) await this.prisma.layaway.updateMany({ where: { id: r.layawayId, tenantId: this.tenantId }, data: { financialDisposition: 'REFUND_REQUESTED' } });
    await this.audit.log('REFUND_REQUESTED', 'RefundRequest', created.id, { subject: r.subject, kind: 'RETRY', retryOf: id, amount: Number(r.amount) });
    return this.get(created.id);
  }
}
